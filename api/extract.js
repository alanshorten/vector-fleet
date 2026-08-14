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
// field the client sends — including a `system` prompt override — is
// dropped by construction, never forwarded.
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

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

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
    decoded = await admin.auth(app).verifyIdToken(idToken);
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
  if (!VALID_ROLES.has(decoded.role)) {
    return res.status(403).json({ error: 'Your account is not authorised to use extraction.' });
  }

  // ---- build a strict, allowlisted upstream request -----------------------
  // Never forward the client's raw body to Anthropic — only these three
  // fields, each validated. This is what actually stops the "arbitrary
  // model / arbitrary token limit / arbitrary system-prompt override" abuse
  // path, independent of the auth check above.
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
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

  try {
    const result = await callAnthropic(anthropicRequest);
    const { httpStatus, ...body } = result;
    return res.status(httpStatus).json(body);
  } catch (err) {
    console.error('extract: request to Anthropic failed', err);
    return res.status(502).json({ error: err.message });
  }
}
