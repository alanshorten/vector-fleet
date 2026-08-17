// api/extract.js — Server-side AI extraction proxy
//
// SECURITY (remediated 2026-08, Phase 1B — see security-remediation-roadmap.md):
// This endpoint forwards a request to Anthropic using TailiQ's own API key.
// It previously had no authentication at all — CORS doesn't help, since a
// direct HTTP client bypasses it entirely — so anyone who found the URL
// could use it as a free, arbitrary-model, arbitrary-token-limit Claude
// proxy at TailiQ's expense. It now requires a valid Firebase ID token from
// a signed-in TailiQ user with a recognised role (any role — even Viewer
// needs extraction for tech-spec/document flows), and only forwards a
// strict, allowlisted subset of the client's request to Anthropic: model
// (from a fixed allowlist), max_tokens (capped), and messages. Any other
// field the client sends — including a `system` prompt override — is now
// explicitly rejected rather than silently dropped (see ALLOWED_BODY_KEYS
// below), so a caller gets a clear 400 instead of a request that quietly
// ignores fields it thought it was sending.
//
// ABUSE LIMITS (2026-08, see claude_abuse-limits-build-spec.md): auth alone
// doesn't stop a valid-but-compromised (or just careless) credential from
// running up cost or flooding the endpoint. Four independent guardrails,
// all sized well above real usage so legitimate users never see them:
//   1A. Request body size cap (5MB, hard reject, 413)
//   1B. Per-user daily call cap (50/day UTC, soft limit, 429)
//   1C. Per-user concurrency cap (1 in-flight call, hard reject, 429)
//   1D. Strict body-key allowlist (hard reject, 400) — closes the gap where
//       unknown fields, including a client-supplied `system` prompt, were
//       previously ignored rather than rejected.
//
// Was 60s. Dense multi-engine LLP documents (e.g. combined LH+RH sheets) can push the
// model's own reasoning + response time to 50-57s on their own, right against a 60s
// ceiling — Vercel was killing the function outright on the slower attempts before it
// could even return our own "could not extract" error, surfacing instead as a raw
// FUNCTION_INVOCATION_TIMEOUT platform error. Raised to 300s for real headroom. If this
// gets silently clamped back down, it means the Vercel plan's own function-duration cap
// is lower than this — check the plan tier, not this file, in that case.
export const maxDuration = 300;

// Allow both the legacy Vercel URL and the new tailiq.app domain while we're
// mid-transition. Drop the .vercel.app entry in a future cleanup session
// once app.tailiq.app is confirmed solid for everything.
const ALLOWED_ORIGINS = [
  'https://vector-fleet.vercel.app',
  'https://app.tailiq.app',
];

const admin = require('firebase-admin');
const { callAnthropic } = require('./_lib/anthropicCall');

function getApp() {
  if (admin.apps.length) return admin.app();
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

// Every model any client caller of this endpoint actually uses, as of
// Phase 1B (extraction.js, PhotosAndSpecs.jsx, UploadView.jsx, pots.js,
// llpCatalogueImport.js, email-ingest.js). Add a model here deliberately
// when a new one is needed — never widen this to accept whatever the
// client sends.
const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
]);

// The largest legitimate request today (avionics LRU extraction) asks for
// 8000. Capped a little above that for headroom without leaving the cap
// effectively unbounded.
const MAX_TOKENS_CAP = 8000;

const VALID_ROLES = new Set(['admin', 'editor', 'viewer', 'dataEntry']);

// ---- 1D: strict top-level body key allowlist -------------------------------
// Only these three fields are ever read from the client body. Anything else
// — including a `system` prompt override attempt — is a hard 400, not a
// silent drop. This is what actually stops the "arbitrary system prompt"
// abuse path as a documented, testable behaviour rather than an implicit
// side-effect of only destructuring three keys below.
const ALLOWED_BODY_KEYS = new Set(['model', 'max_tokens', 'messages']);

// ---- 1A: request body size cap ---------------------------------------------
// The largest legitimate payload is a PDF's base64-encoded page text or a
// multi-engine LLP document for extraction — a few hundred KB at most. 5MB
// is extremely generous headroom; well-behaved client code never approaches
// this. Checked against Content-Length first (cheapest, catches the request
// before Vercel finishes buffering/parsing the body), then re-verified
// against the actual parsed body size as a belt-and-braces check in case
// Content-Length was absent, wrong, or the client used chunked encoding.
const MAX_BODY_BYTES = 5 * 1024 * 1024;

// Fallback tenant for callers whose token predates the tenantId claim
// (Phase 3). New tokens always carry tenantId; this only matters for a
// brief transition window right after that rollout.
const FALLBACK_TENANT_ID = 'maverick';

// ---- 1C: per-user concurrency lock ------------------------------------------
// No legitimate UI flow fires two extraction calls for the same user at
// once. A Firestore-transaction-guarded lock document prevents a second
// call from starting while one is in flight. The TTL fallback (120s, well
// above the function's own 300s maxDuration is intentionally NOT symmetric
// with maxDuration — see note below) exists so a crashed/killed function
// invocation that never reaches its `finally` can't wedge a user out
// indefinitely.
//
// Note on TTL vs maxDuration: real extraction calls can legitimately run
// close to 300s (see the maxDuration comment above). A 120s lock TTL means
// a second request could, in the worst case, slip past a still-legitimately-
// running first request in the last ~180s of an unusually slow call. That's
// an acceptable trade — the alternative (a TTL near 300s) risks a genuinely
// stuck lock blocking a user for 5 minutes on every crash. The hard 300s
// function timeout plus the try/finally release below means the lock is
// removed correctly in the overwhelming majority of cases; the TTL is only
// a backstop for the rare case where the function is killed hard enough to
// skip `finally` (e.g. an OOM kill), not the primary correctness mechanism.
const LOCK_TTL_MS = 120000;

async function acquireExtractionLock(fsdb, tenantId, uid) {
  const ref = fsdb.collection('tenants').doc(tenantId).collection('extractionLocks').doc(uid);
  return fsdb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    if (snap.exists) {
      const startedAt = snap.data().startedAt || 0;
      if (now - startedAt < LOCK_TTL_MS) {
        return false; // still locked by an in-flight call
      }
      // Past TTL — treat as abandoned (crashed invocation) and reclaim it.
    }
    tx.set(ref, { startedAt: now, uid });
    return true;
  });
}

async function releaseExtractionLock(fsdb, tenantId, uid) {
  try {
    await fsdb.collection('tenants').doc(tenantId).collection('extractionLocks').doc(uid).delete();
  } catch (err) {
    // Non-fatal: worst case is the TTL fallback clears it 120s later.
    console.error('extract: failed to release concurrency lock', err);
  }
}

// ---- 1B: per-user daily call cap --------------------------------------------
// Peak legitimate usage is 6-8 calls during heavy onboarding (~7x headroom
// below this cap). Counter is keyed by uid + UTC date string so it resets
// naturally at midnight UTC with no cron/reaper needed for correctness —
// only for storage hygiene (see expiresAt below).
const DAILY_CALL_CAP = 50;

async function checkAndIncrementDailyUsage(fsdb, tenantId, uid) {
  const dateStr = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
  const ref = fsdb.collection('tenants').doc(tenantId).collection('extractionUsage').doc(`${uid}_${dateStr}`);
  return fsdb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? (snap.data().count || 0) : 0;
    if (count >= DAILY_CALL_CAP) return false;
    // expiresAt is written for a Firestore TTL policy to reap old counter
    // docs (configure a TTL policy on the `extractionUsage` collection
    // group's `expiresAt` field in the Firebase console — this field alone
    // does nothing without that policy, but is harmless to write regardless
    // and correctness never depends on the reap actually happening).
    tx.set(ref, {
      count: count + 1,
      uid,
      date: dateStr,
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    }, { merge: true });
    return true;
  });
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // ---- 1A: body size cap, checked as early as possible -------------------
  const contentLength = Number(req.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request body too large.' });
  }

  // ---- auth: any signed-in TailiQ user with a recognised role ------------
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    return res.status(401).json({ error: 'Missing authentication token.' });
  }

  let app, decoded;
  try {
    app = getApp();
  } catch (err) {
    console.error('extract: Firebase Admin init failed', err);
    return res.status(500).json({ error: 'Server configuration error.' });
  }
  try {
    // security-remediation-roadmap.md Phase 3 Session 6 (3C / M-01, Layer 1):
    // checkRevoked=true rejects a token that's been invalidated by
    // set-role.js's revokeRefreshTokens() call, even if the token itself
    // hasn't naturally expired yet (up to an hour otherwise).
    decoded = await admin.auth(app).verifyIdToken(idToken, true);
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
  if (!VALID_ROLES.has(decoded.role)) {
    return res.status(403).json({ error: 'Your account is not authorised to use extraction.' });
  }
  try {
    const callerRecord = await admin.auth(app).getUser(decoded.uid);
    if (callerRecord.disabled) {
      return res.status(403).json({ error: 'Your account has been disabled. Contact an admin.' });
    }
  } catch (err) {
    return res.status(401).json({ error: 'Your account could not be verified. Please sign in again.' });
  }

  const tenantId = decoded.tenantId || FALLBACK_TENANT_ID;

  // ---- build a strict, allowlisted upstream request -----------------------
  // Never forward the client's raw body to Anthropic — only these three
  // fields, each validated. This is what actually stops the "arbitrary
  // model / arbitrary token limit / arbitrary system-prompt override" abuse
  // path, independent of the auth check above.
  const body = (req.body && typeof req.body === 'object') ? req.body : {};

  // 1A (belt-and-braces): re-check size against the actual parsed body in
  // case Content-Length was missing/wrong/chunked.
  let approxBodyBytes = 0;
  try {
    approxBodyBytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
  } catch { /* non-serializable body will fail validation below anyway */ }
  if (approxBodyBytes > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request body too large.' });
  }

  // 1D: hard-reject any field outside the allowlist, including `system`.
  const unknownKeys = Object.keys(body).filter(k => !ALLOWED_BODY_KEYS.has(k));
  if (unknownKeys.length) {
    return res.status(400).json({ error: `Unsupported field(s): ${unknownKeys.join(', ')}` });
  }

  if (!ALLOWED_MODELS.has(body.model)) {
    return res.status(400).json({ error: 'Unsupported model.' });
  }
  const maxTokens = Number(body.max_tokens);
  if (!Number.isFinite(maxTokens) || maxTokens < 1 || maxTokens > MAX_TOKENS_CAP) {
    return res.status(400).json({ error: `max_tokens must be a number between 1 and ${MAX_TOKENS_CAP}.` });
  }
  if (!Array.isArray(body.messages) || !body.messages.length) {
    return res.status(400).json({ error: 'messages is required.' });
  }
  const anthropicRequest = {
    model: body.model,
    max_tokens: maxTokens,
    messages: body.messages,
  };

  // ---- 1B: daily cap ---------------------------------------------------
  let fsdb;
  try {
    fsdb = admin.firestore(app);
  } catch (err) {
    console.error('extract: Firestore init failed', err);
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  let underDailyCap;
  try {
    underDailyCap = await checkAndIncrementDailyUsage(fsdb, tenantId, decoded.uid);
  } catch (err) {
    console.error('extract: daily usage check failed', err);
    return res.status(500).json({ error: 'Server error while checking usage limits.' });
  }
  if (!underDailyCap) {
    return res.status(429).json({
      error: 'daily_limit',
      message: "You've reached the daily extraction limit. This resets at midnight UTC.",
    });
  }

  // ---- 1C: concurrency cap ----------------------------------------------
  let lockAcquired;
  try {
    lockAcquired = await acquireExtractionLock(fsdb, tenantId, decoded.uid);
  } catch (err) {
    console.error('extract: concurrency lock check failed', err);
    return res.status(500).json({ error: 'Server error while checking request status.' });
  }
  if (!lockAcquired) {
    return res.status(429).json({
      error: 'concurrent_limit',
      message: 'An extraction is already in progress. Please wait for it to complete.',
    });
  }

  try {
    const result = await callAnthropic(anthropicRequest);
    const { httpStatus, ...responseBody } = result;
    return res.status(httpStatus).json(responseBody);
  } catch (err) {
    console.error('extract: request to Anthropic failed', err);
    return res.status(502).json({ error: err.message });
  } finally {
    // Must clear on failure/timeout too, not just success — this is why the
    // release lives in `finally` rather than after the try block.
    await releaseExtractionLock(fsdb, tenantId, decoded.uid);
  }
}