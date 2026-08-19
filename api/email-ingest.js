// VectorIQ — Email Ingestion Webhook (V1 gate item, Section 12 of roadmap)
// POST /api/email-ingest?key={EMAIL_INGEST_SECRET}  <-  SendGrid Inbound Parse
//
// SECURITY (remediated 2026-08, see security-remediation-roadmap.md Phase 1A):
// The recipient address (`to`/`envelope`) is caller-controlled — a raw HTTP
// client can set it to whatever it wants, so it was never a real trust
// boundary even though the company-slug check below still exists as a
// routing signal. The actual auth boundary is now a high-entropy shared
// secret passed as `?key=` on the webhook URL, checked before anything else
// runs. Configure SendGrid Inbound Parse to POST to
// `https://app.tailiq.app/api/email-ingest?key={EMAIL_INGEST_SECRET}` and set
// EMAIL_INGEST_SECRET in Vercel env vars.
//
// H-02 fix: the line above used to say SendGrid's Inbound Parse "does not
// support request signing the way their Event Webhook does" — that's out
// of date. SendGrid now supports ECDSA request signing for Inbound Parse
// (Twilio SendGrid docs, "Securing your Inbound Parse Webhooks") via a
// security policy attached to the Parse webhook, delivered as the
// X-Twilio-Email-Event-Webhook-Signature / -Timestamp headers, same
// mechanism as the Event Webhook. verifyInboundParseSignature() below
// implements it and is enforced whenever SENDGRID_INBOUND_PARSE_PUBLIC_KEY
// is set. It's additive on top of the ?key= shared secret, not a
// replacement — set up steps (create a security policy in the SendGrid
// console, attach it to this Parse webhook, copy the returned public_key
// into that env var) are outside this repo and still need doing in the
// SendGrid dashboard; until the env var is set this layer logs a warning
// and does not block, so the endpoint keeps working exactly as before on
// the shared-secret + sender-authentication-alignment controls alone.
//
// High-severity warnings (S/N change, delta mismatch, gap detected) still
// hold a report back in `pendingReports` for human review rather than
// auto-applying — unchanged from before this fix. (An earlier draft of
// this fix staged EVERY report regardless of warnings, as a second layer
// of defense against a leaked secret — reverted after review: the
// Dashboard review card doesn't show the actual extracted values, only
// MSN/period/filename/warnings, so reviewing a report with no warnings
// gave a human nothing to evaluate and was pure friction. The existing
// warning-based gate already provides genuinely reviewable content for the
// cases that matter; the shared secret above is what actually closes the
// unauthenticated-access hole.)
//
// ABUSE LIMITS (2026-08, see claude_abuse-limits-build-spec.md): a valid
// shared secret (or a leaked one) shouldn't be able to flood this endpoint,
// balloon a single email into unbounded storage/AI cost, or replay the same
// email indefinitely via SendGrid's own retry behaviour. Five independent
// guardrails, all well above real usage (real utilisation report emails
// have 1-6 attachments and a handful of forwards per day, not per hour):
//   2A. Attachment count cap (10/email, excess logged and discarded)
//   2B. Aggregate attachment size cap (25MB/email, hard reject)
//   2C. Field size limits (from/to/subject/etc, truncated before use)
//   2D. Idempotency via Message-ID hash (24h dedup, silent ack)
//   2E. Per-sender rate limit (20/hour, silent ack-and-skip)
// All five preserve this endpoint's existing convention of always
// responding HTTP 200 to SendGrid (even on rejection) — SendGrid retries
// non-2xx responses, and a retry storm on a rejected/duplicate/rate-limited
// email is exactly the failure mode these limits exist to prevent. The
// `ok`/`reason` fields in the body carry the real outcome for our own logs.
//
// Single-company build (per roadmap: "build single-company first, extend
// when second organisation onboards"). companyId/role multi-tenancy hasn't
// been backfilled yet (TECH_DEBT 2.3) — the company-slug check is a routing
// aid only, not a security control. Once Phase 3 (tenant isolation) lands,
// the asset-matching query below should also be scoped to the resolved
// tenant rather than querying the whole `assets` collection.
//
// Parse and discard: the raw attachment is never written anywhere. Only
// the structured JSON that comes back from Claude (via /api/extract, the
// same endpoint and prompt the manual Upload flow uses) is ever persisted,
// and only after it has been run through Brain 1's merge/delta logic below
// — there is no path from this endpoint to an arbitrary Firestore write.
//
// Reuses, rather than re-derives:
//   - api/_lib/anthropicCall.js for the actual Claude call + response
//     parsing (so any future fix there — e.g. the reasoning-prelude fix in
//     TECH_DEBT 0.2 — automatically applies here too). Prior to Phase 1B
//     this called back into /api/extract over HTTP; that endpoint now
//     requires a Firebase user ID token this server-to-server caller
//     doesn't have, so the shared logic was extracted into a plain module
//     both endpoints import directly — no HTTP round-trip, no auth mismatch.
//   - calculations/utilisation.js (Brain 1) for the merge/delta logic,
//     loaded the same way techSpecBuilder.js is shared between index.html
//     and share.html, just with a tiny Node-compatible `window` shim
//     instead of a <script> tag, since Brain 1 attaches itself to
//     `window.processUtilisationReport` and has zero other dependencies.
//
// Document type: every inbound email is treated as a monthly utilisation
// report (the recurring, airline-mailed case). LLP / APU LLP sheets are
// infrequent, MRO-issued, manually-triggered uploads that don't fit a
// recurring mailbox pattern and stay on the manual Upload flow.

export const maxDuration = 60;
export const config = { api: { bodyParser: false } };

const Busboy = require('busboy');
const ExcelJS = require('exceljs');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');
const { callAnthropic } = require('./_lib/anthropicCall');
const {
  ExcelLimitError,
  checkZipStructure,
  withTimeout,
  checkWorksheetCount,
  checkSheetBounds,
  PARSE_TIMEOUT_MS,
} = require('./_lib/excelLimits');
const { maskEmail } = require('./_lib/logRedact');

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // matches the 10MB limit on the manual Upload flow

// ---- 2A / 2B: attachment count + aggregate size caps -----------------------
// Real utilisation report emails have 1-6 attachments. 10 is generous
// headroom; anything beyond that is logged and discarded rather than
// buffered at all (see parseMultipart below — excess file streams are
// drained and dropped, never held in memory).
const MAX_ATTACHMENTS = 10;
// Just inside SendGrid's own 30MB platform limit, so a legitimate email
// that SendGrid itself would accept never trips this.
const MAX_AGGREGATE_BYTES = 25 * 1024 * 1024;

// ---- 2C: field size limits --------------------------------------------------
const FIELD_LIMITS = { from: 256, to: 256, subject: 512, default: 1024 };
function capField(value, limit) {
  const s = (value == null) ? '' : String(value);
  return s.length > limit ? s.slice(0, limit) : s;
}

// ---- 2D: idempotency window --------------------------------------------------
const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;

// ---- 2E: per-sender rate limit -----------------------------------------------
const RATE_LIMIT_PER_HOUR = 20;

// Build Group A (tenant onboarding, 19 Aug 2026): TENANT_ID is no longer a
// hardcoded constant. The recipient's local-part (companySlug below) IS the
// tenantId — api/create-tenant.js's tenantSlug becomes both the Firestore
// tenant doc ID and the tenantId custom claim, using the exact same slug
// convention, so "does a live tenant exist at this slug" is now a genuine
// per-request lookup rather than a single-tenant assumption. This endpoint
// reads and writes the Firestore Admin SDK directly, bypassing db.js, so its
// tenant-rooted paths are threaded through by hand (tenantId parameter) as
// they were when TENANT_ID was a constant.

// ---- Firebase Admin (same pattern as api/share/[token].js) ----------------
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

// ---- Brain 1 (utilisation.js), loaded with a window shim -------------------
// utilisation.js is a self-contained IIFE that does `window.processUtilisationReport = ...`
// at the end. It has no other dependency on browser globals (its own
// comment block notes it deliberately duplicates parseHHMM rather than
// depending on load order), so a bare `{}` for `window` is sufficient.
let _processUtilisationReport = null;
function getProcessUtilisationReport() {
  if (_processUtilisationReport) return _processUtilisationReport;
  const code = fs.readFileSync(path.join(process.cwd(), 'calculations', 'utilisation.js'), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  if (!sandbox.window.processUtilisationReport) {
    throw new Error('Brain 1 (calculations/utilisation.js) did not expose processUtilisationReport — check the file deployed correctly.');
  }
  _processUtilisationReport = sandbox.window.processUtilisationReport;
  return _processUtilisationReport;
}

// ---- multipart parsing (SendGrid Inbound Parse posts multipart/form-data) --
// Fields of interest: `envelope` (JSON string with the real to/from, more
// reliable than the human-readable `to`/`from` headers which can contain
// display names or multiple recipients), `subject`, `headers` (raw header
// block, used for Message-ID extraction — see 2D), and one file field per
// attachment (`attachment1`, `attachment2`, ...) plus a JSON `attachment-info`
// field describing them. We only need the file bytes + filename/mimetype,
// so we read every file field generically rather than relying on exact
// SendGrid field naming, in case that varies by plan/config.
//
// 2A/2B: attachments beyond MAX_ATTACHMENTS are drained (stream.resume())
// and dropped without ever entering memory — count and aggregate byte caps
// are both enforced here, at parse time, rather than after the fact, so a
// malicious or malformed email can't force us to buffer more than the caps
// allow regardless of what it claims in attachment-info.
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = [];
    let totalBytes = 0;
    let acceptedCount = 0;
    let discardedCount = 0;
    let aggregateExceeded = false;
    const bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_ATTACHMENT_BYTES } });

    // H-02 fix: capture the exact raw bytes of the request body alongside
    // Busboy's parse, for verifyInboundParseSignature() below — SendGrid's
    // signature is computed over the raw, unparsed multipart body, so it
    // has to be captured before/independent of Busboy's own parsing. Capped
    // at the same aggregate limit (plus multipart framing headroom) as
    // attachments already are, so this doesn't add a new unbounded-memory
    // path; a body that blows the cap already gets aggregateExceeded=true
    // and is rejected below regardless of signature status.
    const rawChunks = [];
    let rawBytes = 0;
    const RAW_BODY_CAP = MAX_AGGREGATE_BYTES + 1024 * 1024;
    req.on('data', (chunk) => {
      rawBytes += chunk.length;
      if (rawBytes <= RAW_BODY_CAP) rawChunks.push(chunk);
    });

    bb.on('field', (name, val) => { fields[name] = val; });

    bb.on('file', (name, stream, info) => {
      if (acceptedCount >= MAX_ATTACHMENTS) {
        discardedCount++;
        stream.resume(); // drain without buffering — never held in memory
        return;
      }
      acceptedCount++;
      const chunks = [];
      let truncated = false;
      let fileBytes = 0;
      stream.on('data', (chunk) => {
        fileBytes += chunk.length;
        totalBytes += chunk.length;
        if (totalBytes > MAX_AGGREGATE_BYTES) {
          // Stop buffering this and all subsequent chunks once the
          // aggregate cap is blown — the whole email gets rejected below,
          // so there's no point holding the bytes.
          aggregateExceeded = true;
          return;
        }
        chunks.push(chunk);
      });
      stream.on('limit', () => { truncated = true; });
      stream.on('end', () => {
        files.push({
          field: name,
          filename: info.filename || '',
          mimeType: info.mimeType || '',
          buffer: Buffer.concat(chunks),
          bytes: fileBytes,
          truncated,
        });
      });
    });

    bb.on('error', reject);
    bb.on('finish', () => resolve({
      fields, files, totalBytes, discardedCount, aggregateExceeded,
      rawBody: Buffer.concat(rawChunks),
    }));
    req.pipe(bb);
  });
}

// H-02 fix: optional additional layer on top of the ?key= shared secret —
// verifies SendGrid's ECDSA Inbound Parse signature when a security policy
// has been configured in the SendGrid console and its public key stored in
// SENDGRID_INBOUND_PARSE_PUBLIC_KEY (see the header comment for setup
// steps). Same scheme as SendGrid's Event Webhook signing: SHA-256 over
// `timestamp + rawBody`, DER-encoded ECDSA signature, P-256 SPKI public
// key. Returns true (pass), false (fail — reject), or null (not
// configured — caller treats null as "skip, rely on the shared secret
// alone" rather than blocking legitimate mail before this layer has been
// set up SendGrid-side).
function verifyInboundParseSignature(rawBody, req) {
  const publicKeyRaw = process.env.SENDGRID_INBOUND_PARSE_PUBLIC_KEY || '';
  if (!publicKeyRaw) return null;
  const signature = req.headers['x-twilio-email-event-webhook-signature'];
  const timestamp = req.headers['x-twilio-email-event-webhook-timestamp'];
  if (!signature || !timestamp) return false;
  try {
    const pem = publicKeyRaw.includes('BEGIN PUBLIC KEY')
      ? publicKeyRaw
      : `-----BEGIN PUBLIC KEY-----\n${publicKeyRaw.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`;
    const publicKey = crypto.createPublicKey(pem);
    const payload = Buffer.concat([Buffer.from(String(timestamp), 'utf8'), rawBody]);
    return crypto.verify('sha256', payload, publicKey, Buffer.from(signature, 'base64'));
  } catch (err) {
    console.error('email-ingest: inbound parse signature verification errored', err);
    return false;
  }
}

// ---- attachment type detection ---------------------------------------------
function isPDF(att) {
  return att.mimeType === 'application/pdf' || /\.pdf$/i.test(att.filename);
}
function isExcel(att) {
  return att.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    att.mimeType === 'application/vnd.ms-excel' ||
    /\.xlsx$/i.test(att.filename) || /\.xls$/i.test(att.filename);
}

// ---- ExcelJS CSV helper (xlsx remediation, 2026-08 — see
// claude_xlsx-remediation-option-d-build-handoff.md) --------------------------
// SheetJS (xlsx) 0.18.5 has an unpatched prototype-pollution CVE with no
// npm fix; this endpoint parses genuinely untrusted internet-facing input
// (any sender who can reach reports.tailiq.app), so it moved to ExcelJS,
// which has no direct sheet_to_csv equivalent — built here by hand. Mirrors
// the old SheetJS output closely enough for this file's use (feeding CSV
// text to Claude for extraction, not round-tripping data back to a sheet).
//
// Item 3 (18 Aug review): checkSheetBounds (api/_lib/excelLimits.js) rejects
// a pathologically wide/tall sheet before iterating its rows/cells — this is
// internet-facing input, same reasoning as the CVE move above.
function sheetToCsv(worksheet) {
  checkSheetBounds(worksheet);
  const rows = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const cells = [];
    for (let i = 1; i <= row.cellCount; i++) {
      let val = String(unwrapCellValue(row.getCell(i).value));
      if (/[,\n"]/.test(val)) val = '"' + val.replace(/"/g, '""') + '"';
      cells.push(val);
    }
    rows.push(cells.join(','));
  });
  return rows.join('\n');
}

// Recursive unwrap so a formula cell's cached result (or a hyperlink's text,
// or rich text) is resolved down to a primitive. Bug fix (2026-08-18, found
// via a real workbook with un-cached cross-sheet formulas): a formula cell
// with NO cached result (never recalculated by whatever last saved the
// file, or errored) has no 'result'/'text'/'richText' key at all — falling
// through to String(val) on the raw {formula:...} object produced the
// literal text "[object Object]" in the CSV sent to Claude, which broke
// its JSON response (SyntaxError at JSON.parse). Any object shape we don't
// recognise is now treated as blank, matching how SheetJS effectively
// behaved before (it also only ever had a cached value to show, never a
// live recalculation).
function unwrapCellValue(val) {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object') {
    if (val.result !== undefined) return unwrapCellValue(val.result); // formula cell with a cached result
    if (val.text !== undefined) return unwrapCellValue(val.text);     // rich text / hyperlink
    if (val.richText) return val.richText.map(rt => rt.text).join('');
    return ''; // formula with no cached result, a formula error, or any other unrecognised shape — blank, never stringified
  }
  return typeof val === 'string' ? val : String(val);
}

// ---- the exact utilisation-report extraction prompt, copied verbatim from
// index.html's UploadView (uploadType==="util" branch) — single source of
// truth would be better, but index.html has no module boundary to import
// from, so this is duplicated text rather than duplicated logic. If that
// prompt is ever edited in index.html, mirror the change here.
const UTIL_PROMPT = "Extract ALL data from this aircraft utilisation report. This report has separate columns for ENGINE Position 1, ENGINE Position 2, and APU — they are three distinct components, each with their own S/N, TSN, CSN, and FH/FC figures. Do not confuse the APU column with an engine position. Some aircraft only have data for ONE engine position in this report — the single engine may be reported under EITHER Position 1 OR Position 2, so check both columns rather than assuming Position 1 is always populated. Whichever position column is blank or absent, set that entire engine value to null (either \"engine1\" or \"engine2\", whichever is blank) — do not copy APU figures or any other column into a blank engine position, and do not invent placeholder values. All TSN and FH values must be formatted as HH:MM strings. Return ONLY valid JSON, no markdown:\n{\"month_year\":\"e.g. May 2026\",\"operator\":\"string\",\"msn\":\"string\",\"registration\":\"string\",\"airframe\":{\"fh_period\":\"HH:MM\",\"fc_period\":number,\"tsn\":\"HH:MM\",\"csn\":number},\"engine1\":{\"model\":\"string\",\"sn\":\"string\",\"tsn\":\"HH:MM\",\"csn\":number,\"fh_period\":\"HH:MM\",\"fc_period\":number} or null if Position 1 is blank in the report,\"engine2\":{\"model\":\"string\",\"sn\":\"string\",\"tsn\":\"HH:MM\",\"csn\":number,\"fh_period\":\"HH:MM\",\"fc_period\":number} or null if Position 2 is blank in the report,\"apu\":{\"sn\":\"string\",\"tsn\":\"HH:MM\",\"csn\":number},\"landing_gear\":{\"nose\":{\"pn\":\"string\",\"sn\":\"string\",\"csn\":number},\"left\":{\"pn\":\"string\",\"sn\":\"string\",\"csn\":number},\"right\":{\"pn\":\"string\",\"sn\":\"string\",\"csn\":number}},\"removals\":[{\"component\":\"engine or landing_gear or apu\",\"sn\":\"string\",\"position\":\"string\",\"date\":\"string\",\"reason\":\"string\",\"tsn_at_removal\":\"HH:MM\",\"csn_at_removal\":number,\"mro\":\"string\"}]}";

// ---- recipient -> companyId -------------------------------------------------
// SendGrid's `envelope` field, when present, is the most reliable source:
// {"to":["acme@reports.tailiq.app"],"from":"ops@airline.com"}. Falls back
// to the `to` header field if envelope is missing for any reason.
function extractRecipient(fields) {
  if (fields.envelope) {
    try {
      const env = JSON.parse(fields.envelope);
      if (Array.isArray(env.to) && env.to.length) return env.to[0];
    } catch { /* fall through to `to` field */ }
  }
  return fields.to || '';
}
function companySlugFromRecipient(recipientAddress) {
  const match = /^([^@]+)@/.exec((recipientAddress || '').trim());
  return match ? match[1].toLowerCase() : null;
}

// ---- Build Group A: sender verification against a tenant's approvedSenders
// allowlist, plus SPF/DKIM pass check. Both must pass — a known sender whose
// mail is spoofed (auth fails) is rejected exactly the same as an unknown
// sender whose mail is genuinely authenticated. Neither check alone is
// sufficient: an allowlist match on a spoofable envelope `from` header means
// nothing without authentication behind it, and a passing SPF/DKIM result
// only proves the sending domain is genuine, not that TailiQ actually wants
// mail from it.
function extractEmailAddress(raw) {
  const m = /<([^>]+)>/.exec(raw || '');
  const addr = (m ? m[1] : (raw || '')).trim().toLowerCase();
  return addr;
}
function extractEnvelopeSender(fields, fallback) {
  if (fields.envelope) {
    try {
      const env = JSON.parse(fields.envelope);
      if (env.from) return extractEmailAddress(env.from);
    } catch { /* fall through */ }
  }
  return extractEmailAddress(fallback);
}
function senderDomain(email) {
  const at = (email || '').lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1) : '';
}
async function isSenderApproved(fsdb, tenantId, senderEmail) {
  if (!senderEmail) return false;
  const domain = senderDomain(senderEmail);
  const snap = await fsdb.collection('tenants').doc(tenantId).collection('approvedSenders').get();
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const value = (data.value || '').toLowerCase();
    if (data.type === 'email' && value === senderEmail) return true;
    if (data.type === 'domain' && value && domain === value) return true;
  }
  return false;
}
// SendGrid Inbound Parse sends SPF/DKIM verification results as separate
// multipart fields (`SPF`, `dkim`) rather than trustworthy request headers —
// e.g. SPF: "pass"/"neutral"/"fail", dkim: "{@domain.com : pass}". Lenient
// substring match on "pass" covers both shapes without needing to parse
// dkim's per-domain object-literal-looking format precisely.
// H-02 fix: the previous version accepted ANY passing SPF or DKIM result,
// with no check that the authenticated domain had anything to do with the
// envelope sender this message claims to be from. That let an attacker
// spoof an allowlisted envelope MAIL FROM (which isSenderApproved() alone
// can't detect — it's just a header comparison), then attach a DKIM
// signature that validly authenticates a completely different,
// attacker-controlled domain, and still sail through because *some*
// signature on the message happened to pass.
//
// SendGrid's SPF field already reports the result of authenticating the
// envelope MAIL FROM domain specifically (RFC 7208) — a pass there is
// aligned to `envelopeDomain` by construction, no separate identity to
// compare. DKIM is different: SendGrid's `dkim` field can report results
// for signatures across MULTIPLE domains on one message (its own shape is
// roughly "{@domain-a.com : pass; @domain-b.com : neutral}"), so a pass
// entry has to be extracted per-domain and compared against the envelope
// sender's domain before it counts as authenticating that sender. This is
// a DMARC-style relaxed alignment check (subdomains of the envelope
// domain are accepted, matching how DMARC itself treats alignment).
function extractPassedDkimDomains(dkimField) {
  const domains = [];
  const re = /@([a-z0-9.-]+)\s*:\s*pass\b/gi;
  let m;
  while ((m = re.exec(dkimField || '')) !== null) domains.push(m[1].toLowerCase());
  return domains;
}
function domainAligned(candidate, expected) {
  if (!candidate || !expected) return false;
  return candidate === expected || candidate.endsWith('.' + expected);
}
function senderAuthAligned(fields, envelopeSender) {
  const envelopeDomain = senderDomain(envelopeSender);
  if (!envelopeDomain) return false;
  const spfPass = (fields.SPF || fields.spf || '').toLowerCase().includes('pass');
  const dkimDomains = extractPassedDkimDomains(fields.dkim || fields.DKIM || '');
  const dkimAligned = dkimDomains.some((d) => domainAligned(d, envelopeDomain));
  return spfPass || dkimAligned;
}

// ---- 2D: Message-ID extraction + hashing ------------------------------------
// SendGrid Inbound Parse exposes the raw header block as a `headers` field
// (not a dedicated Message-ID field). Falls back to a hash of
// from+subject+recipient+attachment-info if no Message-ID header is present
// at all (rare, but some malformed/relayed mail omits it) — that fallback
// is intentionally coarser (won't catch a genuine resend with new content
// under the same subject) but still catches the common case this guards
// against: SendGrid's own retry storms on a single delivery attempt.
function extractMessageId(fields) {
  if (fields.headers) {
    const m = /^Message-ID:\s*(.+)$/im.exec(fields.headers);
    if (m) return m[1].trim();
  }
  return null;
}
function dedupKeyFor(fields, recipient, envelopeSender) {
  const messageId = extractMessageId(fields);
  // H-02 fix: fall back to the authenticated envelope sender, not the
  // spoofable display `from` header, so dedup can't be trivially bypassed
  // by varying the display name/address on otherwise-identical replays.
  const basis = messageId || `${envelopeSender || fields.from || ''}|${fields.subject || ''}|${recipient}|${fields['attachment-info'] || ''}`;
  return crypto.createHash('sha256').update(basis).digest('hex');
}

// ---- call the shared Anthropic caller (single source of truth for the
// Claude call + response parsing — see file header) -------------------------
async function callExtract(messageContent) {
  const result = await callAnthropic({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    messages: [{ role: 'user', content: messageContent }]
  });
  const rawParsed = result.ok ? result.data : JSON.parse((result.raw || '').replace(/```json|```/g, '').trim());
  return Array.isArray(rawParsed) ? rawParsed[rawParsed.length - 1] : rawParsed;
}

async function writeNotification(fsdb, payload) {
  try {
    await fsdb.collection('notifications').add({
      type: 'email-ingest',
      createdAt: new Date().toISOString(),
      ...payload
    });
  } catch (err) {
    // Notification failure must never fail the whole request — the asset
    // write (if any) has already succeeded by the time this runs.
    console.error('email-ingest: failed to write notification', err);
  }
}

// ---- review-queue severity classification (Section 12a) -------------------
// Brain 1's warning strings already encode severity via their leading
// glyph — "⚠" (⚠) for things that should hold a report back pending
// review (S/N change, delta mismatch, gap detected), vs "ℹ"/"🔧"
// (ℹ/🔧) for informational notes (same-month merge, removal log) that are
// fine to apply immediately. No Brain 1 changes needed — this just reads
// the same warning text the manual Upload flow already shows.
function hasHighSeverityWarning(warnings) {
  return (warnings || []).some(function (w) { return w.indexOf('⚠') === 0; });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  // ---- shared-secret auth gate (Phase 1A) --------------------------------
  // This must run before any body parsing. Fail closed and silent, same
  // posture as the company-slug rejection below — an unauthenticated
  // caller learns nothing from the response about why it was rejected.
  const expectedSecret = process.env.EMAIL_INGEST_SECRET || '';
  const providedSecret = (req.query && req.query.key) || '';
  if (!expectedSecret || providedSecret !== expectedSecret) {
    console.error('email-ingest: rejected — missing or invalid webhook secret');
    return res.status(200).json({ ok: false, reason: 'unauthorized' });
  }

  let app, fsdb;
  try {
    app = getApp();
    fsdb = admin.firestore(app);
  } catch (err) {
    console.error('email-ingest: Firebase Admin init failed', err);
    return res.status(200).json({ ok: false, reason: 'init_error' });
  }

  let fields, files, discardedCount, aggregateExceeded, rawBody;
  try {
    ({ fields, files, discardedCount, aggregateExceeded, rawBody } = await parseMultipart(req));
  } catch (err) {
    console.error('email-ingest: multipart parse failed', err);
    // Malformed body isn't something SendGrid can usefully retry past —
    // ack it so it doesn't keep hammering us with the same bad payload.
    return res.status(200).json({ ok: false, reason: 'parse_error' });
  }

  // H-02 fix: enforce the ECDSA Inbound Parse signature once it's been set
  // up SendGrid-side (see verifyInboundParseSignature). Fails closed only
  // when the key IS configured and the signature is missing/invalid; while
  // unconfigured it logs once and falls through to the existing controls.
  const sigResult = verifyInboundParseSignature(rawBody, req);
  if (sigResult === false) {
    console.error('email-ingest: rejected — Inbound Parse signature missing or invalid');
    return res.status(200).json({ ok: false, reason: 'bad_signature' });
  } else if (sigResult === null) {
    console.warn('email-ingest: Inbound Parse signature verification not configured (SENDGRID_INBOUND_PARSE_PUBLIC_KEY unset) — relying on shared secret + sender alignment only');
  }

  // ---- 2C: field size limits, applied before any further use --------------
  const fromAddress = capField(fields.from, FIELD_LIMITS.from);
  const subject = capField(fields.subject, FIELD_LIMITS.subject);
  const recipientRaw = capField(extractRecipient(fields), FIELD_LIMITS.to);
  const companySlug = companySlugFromRecipient(recipientRaw);

  // Build Group A (19 Aug 2026): the recipient's local-part IS the tenantId
  // — resolved by checking a live tenant doc exists at that slug, rather
  // than comparing against a single EXPECTED_COMPANY_SLUG env var. Fail
  // closed and silent either way — no retry storm, no information leakage
  // about why a given slug was rejected.
  const tenantId = companySlug;
  let tenantExists = false;
  if (tenantId) {
    try {
      const tenantSnap = await fsdb.collection('tenants').doc(tenantId).get();
      tenantExists = tenantSnap.exists && tenantSnap.data()?.status === 'active';
    } catch (err) {
      console.error('email-ingest: tenant lookup failed', err);
    }
  }
  if (!tenantId || !tenantExists) {
    console.error('email-ingest: rejected — recipient did not resolve to a known, active tenant', { recipient: maskEmail(recipientRaw) });
    return res.status(200).json({ ok: false, reason: 'company_not_recognised' });
  }

  // ---- sender verification (Build Group A) ---------------------------------
  // Both checks must pass: the envelope sender must be on this tenant's
  // approvedSenders allowlist, AND SendGrid's own SPF/DKIM verification must
  // report a pass for this delivery. See the helper functions above for why
  // neither check alone is sufficient.
  const envelopeSender = extractEnvelopeSender(fields, fromAddress);
  let senderApproved = false;
  try {
    senderApproved = await isSenderApproved(fsdb, tenantId, envelopeSender);
  } catch (err) {
    console.error('email-ingest: approvedSenders lookup failed', err);
  }
  const authPassed = senderAuthAligned(fields, envelopeSender);
  if (!senderApproved || !authPassed) {
    console.warn('email-ingest: rejected — sender not approved or not authenticated', {
      tenantId, sender: maskEmail(envelopeSender), senderApproved, authPassed,
    });
    return res.status(200).json({ ok: false, reason: 'sender_not_approved' });
  }

  // ---- 2A: log (but don't fail on) discarded excess attachments -----------
  if (discardedCount > 0) {
    console.warn('email-ingest: discarded attachments beyond the per-email cap', {
      companySlug, from: maskEmail(fromAddress), subject, discardedCount, cap: MAX_ATTACHMENTS,
    });
  }

  // ---- 2B: aggregate size cap ----------------------------------------------
  if (aggregateExceeded) {
    await writeNotification(fsdb, {
      status: 'error', companySlug, from: fromAddress, subject,
      warnings: [`Total attachment size exceeded the ${MAX_AGGREGATE_BYTES / (1024 * 1024)}MB per-email limit and was not processed.`],
    });
    return res.status(200).json({ ok: false, reason: 'aggregate_too_large' });
  }

  // ---- 2E: per-sender rate limit -------------------------------------------
  // H-02 fix: key the rate limit on the authenticated envelope identity,
  // not the display `from` header — the display From is attacker-chosen
  // and trivially varied to dodge a per-sender limit keyed on it.
  try {
    const underRateLimit = await checkAndIncrementSenderRate(fsdb, tenantId, envelopeSender);
    if (!underRateLimit) {
      console.warn('email-ingest: rejected — sender exceeded hourly rate limit', { from: maskEmail(envelopeSender) });
      return res.status(200).json({ ok: false, reason: 'rate_limited' });
    }
  } catch (err) {
    // Fail open on the rate-limit check itself — a Firestore hiccup here
    // shouldn't block a legitimate report. The other four guardrails still
    // apply regardless.
    console.error('email-ingest: rate limit check failed, proceeding', err);
  }

  // ---- 2D: idempotency / replay protection ---------------------------------
  const dedupKey = dedupKeyFor(fields, recipientRaw, envelopeSender);
  try {
    const isNew = await claimDedupKey(fsdb, tenantId, dedupKey);
    if (!isNew) {
      console.warn('email-ingest: duplicate delivery skipped', { from: maskEmail(fromAddress), subject, dedupKey });
      return res.status(200).json({ ok: true, status: 'duplicate_skipped' });
    }
  } catch (err) {
    // Fail open — a Firestore hiccup on the dedup check shouldn't drop a
    // legitimate, non-duplicate report. Worst case on failure is an
    // occasional double-process, which the S/N-change/delta-mismatch
    // review gate downstream already surfaces for human review anyway.
    console.error('email-ingest: dedup check failed, proceeding', err);
  }

  // Pick the first supported attachment. Multiple-attachment emails are
  // logged but only the first recognised PDF/Excel file is processed —
  // matches the manual Upload flow, which is also one-file-at-a-time.
  const candidates = files.filter(f => isPDF(f) || isExcel(f));
  if (!candidates.length) {
    await writeNotification(fsdb, {
      status: 'no_attachment', companySlug, from: fromAddress, subject,
      warnings: ['No PDF or Excel attachment found on this email.']
    });
    return res.status(200).json({ ok: false, reason: 'no_attachment' });
  }
  const attachment = candidates[0];
  const skippedExtra = files.length > 1 && candidates.length > 1;

  if (attachment.truncated || attachment.buffer.length > MAX_ATTACHMENT_BYTES) {
    await writeNotification(fsdb, {
      status: 'error', companySlug, from: fromAddress, subject,
      fileName: attachment.filename,
      warnings: ['Attachment exceeds the 10MB size limit and was not processed.']
    });
    return res.status(200).json({ ok: false, reason: 'attachment_too_large' });
  }

  // ---- build the Claude message content for this attachment type --------
  let messageContent;
  try {
    if (isPDF(attachment)) {
      messageContent = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: attachment.buffer.toString('base64') } },
        { type: 'text', text: UTIL_PROMPT }
      ];
    } else {
      // Item 3 (18 Aug review): this is genuinely untrusted internet-facing
      // input (any sender who can reach reports.tailiq.app) — ZIP structure
      // pre-check and a load timeout before the expensive full parse, same
      // ceilings as api/parse-excel.js (api/_lib/excelLimits.js).
      await checkZipStructure(attachment.buffer);
      const workbook = new ExcelJS.Workbook();
      await withTimeout(
        workbook.xlsx.load(attachment.buffer),
        PARSE_TIMEOUT_MS,
        'This file took too long to parse and was rejected.'
      );
      checkWorksheetCount(workbook);
      // Real airline monthly reports arrive as a running multi-sheet archive
      // (one sheet per month, e.g. "1124", "1224", "0125", ...), not a
      // single-sheet file — confirmed against a real production attachment,
      // 2026-08-18. Concatenating every sheet (the original behaviour,
      // inherited unchanged from the pre-ExcelJS SheetJS code) overwhelmed
      // the single-report extraction schema with tens of thousands of
      // tokens of near-identical historical data and reliably broke
      // Claude's JSON output (SyntaxError on parse). Only the LAST sheet
      // (most recent month, by tab order) is extracted now — same
      // "default to last sheet" convention UploadView.jsx already uses for
      // manual uploads, just without a human in the loop to override it
      // here.
      const sheet = workbook.worksheets[workbook.worksheets.length - 1];
      if (!sheet) throw new Error('Excel file has no sheets.');
      const csvText = 'Sheet: ' + sheet.name + '\n' + sheetToCsv(sheet);
      messageContent = [
        { type: 'text', text: 'The following is the contents of an Excel spreadsheet (sheet: ' + sheet.name + ') exported as CSV. This is the most recent month\'s data.\n\n' + csvText + '\n\n' + UTIL_PROMPT }
      ];
    }
  } catch (err) {
    console.error('email-ingest: could not read attachment', err);
    // ExcelLimitError messages are already safe, specific, user-facing text
    // (api/_lib/excelLimits.js) — surface them directly rather than the
    // generic fallback below.
    const warning = err instanceof ExcelLimitError
      ? err.message
      : 'Could not read the attached file. It may be corrupted or an unsupported variant of PDF/Excel.';
    await writeNotification(fsdb, {
      status: 'error', companySlug, from: fromAddress, subject,
      fileName: attachment.filename,
      warnings: [warning]
    });
    return res.status(200).json({ ok: false, reason: 'unreadable_attachment' });
  }

  // ---- Claude extraction (via /api/extract — see file header) ------------
  let parsed;
  try {
    parsed = await callExtract(messageContent);
  } catch (err) {
    console.error('email-ingest: extraction failed', err);
    await writeNotification(fsdb, {
      status: 'error', companySlug, from: fromAddress, subject,
      fileName: attachment.filename,
      warnings: ['The AI could not extract structured data from this attachment. Check it is a recognisable utilisation report.']
    });
    return res.status(200).json({ ok: false, reason: 'extraction_failed' });
  }

  // ---- match to an existing asset by MSN (same logic as confirmSave) -----
  let previousAsset = null;
  try {
    const msn = parsed.msn ? parsed.msn.toString().replace(/^0+/, '') : '';
    const snap = await fsdb.collection('tenants').doc(tenantId).collection('assets').get();
    const assets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    previousAsset = assets.find(a => a.msn?.toString().replace(/^0+/, '') === msn) || null;
  } catch (err) {
    console.error('email-ingest: asset lookup failed', err);
    await writeNotification(fsdb, {
      status: 'error', companySlug, from: fromAddress, subject,
      fileName: attachment.filename,
      warnings: ['Could not look up existing aircraft records. Please check Firestore connectivity.']
    });
    return res.status(200).json({ ok: false, reason: 'lookup_failed' });
  }

  // ---- Brain 1: merge / delta logic — identical to the manual Upload flow -
  let result;
  try {
    const processUtilisationReport = getProcessUtilisationReport();
    result = processUtilisationReport({ newReport: parsed, previousAsset });
  } catch (err) {
    console.error('email-ingest: Brain 1 processing failed', err);
    await writeNotification(fsdb, {
      status: 'error', companySlug, from: fromAddress, subject,
      fileName: attachment.filename,
      warnings: ['Internal error while processing the extracted report: ' + (err.message || 'unknown error')]
    });
    return res.status(200).json({ ok: false, reason: 'processing_failed' });
  }

  const msnForLog = (parsed.msn || '').toString().replace(/^0+/, '');
  const baseLog = {
    companySlug, from: fromAddress, subject,
    fileName: attachment.filename,
    msn: msnForLog,
    period: parsed.month_year || null,
    skippedExtraAttachments: skippedExtra
  };

  try {
    if (result.historyOnly) {
      // Out-of-order / duplicate-period / unparseable-period upload — saved
      // to history only, live asset state is never touched. Mirrors
      // confirmSave's handling of result.historyOnly exactly.
      await fsdb.collection('tenants').doc(tenantId).collection('utilisation').add({
        ...result.utilisationRecord,
        asset_id: String(result.utilisationRecord.asset_id),
        created_at: new Date().toISOString()
      });
      await writeNotification(fsdb, { ...baseLog, status: 'history_only', warnings: result.warnings });
      return res.status(200).json({ ok: true, status: 'history_only' });
    }

    // ---- Review queue gate (Section 12a) -----------------------------------
    // High-severity warnings (S/N change, delta mismatch, gap detected) hold
    // the report back from going live, same way out-of-order uploads already
    // never touch live state. The full merge result (already computed by
    // Brain 1 above) is staged in `pendingReports` rather than discarded, so
    // Apply in the review queue is just "write what we already calculated" —
    // no re-parsing, no re-running Brain 1, no risk of a different result
    // between now and review.
    if (hasHighSeverityWarning(result.warnings)) {
      await fsdb.collection('tenants').doc(tenantId).collection('pendingReports').add({
        ...baseLog,
        status: 'pending_review',
        warnings: result.warnings,
        isNewAsset: result.isNewAsset,
        mergedAsset: result.mergedAsset,
        utilisationRecord: result.utilisationRecord,
        createdAt: new Date().toISOString()
      });
      await writeNotification(fsdb, { ...baseLog, status: 'pending_review', warnings: result.warnings });
      return res.status(200).json({ ok: true, status: 'pending_review' });
    }

    const { _dbId, _updatedAt, ...assetData } = result.mergedAsset;
    await fsdb.collection('tenants').doc(tenantId).collection('assets').doc(String(result.mergedAsset.id)).set({
      ...assetData,
      updatedAt: new Date().toISOString()
    });
    await fsdb.collection('tenants').doc(tenantId).collection('utilisation').add({
      ...result.utilisationRecord,
      asset_id: String(result.utilisationRecord.asset_id),
      created_at: new Date().toISOString()
    });

    await writeNotification(fsdb, {
      ...baseLog,
      status: result.isNewAsset ? 'created' : 'updated',
      warnings: result.warnings
    });

    return res.status(200).json({ ok: true, status: result.isNewAsset ? 'created' : 'updated', msn: msnForLog });
  } catch (err) {
    console.error('email-ingest: Firestore write failed', err);
    await writeNotification(fsdb, { ...baseLog, status: 'error', warnings: ['Failed to save to Firestore: ' + (err.message || 'unknown error')] });
    return res.status(200).json({ ok: false, reason: 'write_failed' });
  }
};

// ---- 2D helper: claim a dedup key (returns true if this is a new, unseen
// delivery; false if already processed within the TTL window) --------------
async function claimDedupKey(fsdb, tenantId, dedupKey) {
  const ref = fsdb.collection('tenants').doc(tenantId).collection('emailIngestDedup').doc(dedupKey);
  return fsdb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return false;
    tx.set(ref, {
      createdAt: new Date().toISOString(),
      // Written for a Firestore TTL policy on this collection group's
      // `expiresAt` field (configure in the Firebase console) — the field
      // alone doesn't expire anything without that policy, but correctness
      // of the dedup check never depends on the reap actually happening.
      expiresAt: new Date(Date.now() + DEDUP_TTL_MS),
    });
    return true;
  });
}

// ---- 2E helper: increment and check the sender's rolling hourly count -----
// Keyed by a hash of the lowercased sender address + the current UTC hour
// bucket, so it resets naturally on the hour with no separate reaper needed
// for correctness (same pattern as the daily cap in extract.js).
async function checkAndIncrementSenderRate(fsdb, tenantId, fromAddress) {
  const senderKey = crypto.createHash('sha256').update((fromAddress || '').trim().toLowerCase()).digest('hex');
  const hourBucket = new Date().toISOString().slice(0, 13).replace(/[-T:]/g, ''); // UTC YYYYMMDDHH
  const ref = fsdb.collection('tenants').doc(tenantId).collection('emailIngestRate').doc(`${senderKey}_${hourBucket}`);
  return fsdb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? (snap.data().count || 0) : 0;
    if (count >= RATE_LIMIT_PER_HOUR) return false;
    tx.set(ref, {
      count: count + 1,
      hourBucket,
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // TTL policy target, 2h headroom past the bucket
    }, { merge: true });
    return true;
  });
}