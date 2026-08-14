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
// EMAIL_INGEST_SECRET in Vercel env vars. SendGrid's Inbound Parse does not
// support request signing the way their Event Webhook does, so a shared
// secret in the URL (transmitted over HTTPS) is the standard mitigation for
// this class of receiver.
//
// Every successful extraction that would touch live asset data is now
// staged in `pendingReports` for human review rather than auto-applied —
// see the write logic near the bottom of this file. This is a second,
// independent layer of defense on top of the secret: even a valid, correctly
// authenticated report can't silently change live fleet data without a
// human clicking Apply in the Dashboard review queue.
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
const XLSX = require('xlsx');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { callAnthropic } = require('./_lib/anthropicCall');

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // matches the 10MB limit on the manual Upload flow

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
// display names or multiple recipients), `subject`, and one file field per
// attachment (`attachment1`, `attachment2`, ...) plus a JSON `attachment-info`
// field describing them. We only need the file bytes + filename/mimetype,
// so we read every file field generically rather than relying on exact
// SendGrid field naming, in case that varies by plan/config.
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = [];
    let totalBytes = 0;
    const bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_ATTACHMENT_BYTES } });

    bb.on('field', (name, val) => { fields[name] = val; });

    bb.on('file', (name, stream, info) => {
      const chunks = [];
      let truncated = false;
      stream.on('data', (chunk) => { chunks.push(chunk); totalBytes += chunk.length; });
      stream.on('limit', () => { truncated = true; });
      stream.on('end', () => {
        files.push({
          field: name,
          filename: info.filename || '',
          mimeType: info.mimeType || '',
          buffer: Buffer.concat(chunks),
          truncated
        });
      });
    });

    bb.on('error', reject);
    bb.on('finish', () => resolve({ fields, files }));
    req.pipe(bb);
  });
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

  let fields, files;
  try {
    ({ fields, files } = await parseMultipart(req));
  } catch (err) {
    console.error('email-ingest: multipart parse failed', err);
    // Malformed body isn't something SendGrid can usefully retry past —
    // ack it so it doesn't keep hammering us with the same bad payload.
    return res.status(200).json({ ok: false, reason: 'parse_error' });
  }

  const fromAddress = fields.from || '';
  const subject = fields.subject || '';
  const recipient = extractRecipient(fields);
  const companySlug = companySlugFromRecipient(recipient);
  const expectedSlug = (process.env.EXPECTED_COMPANY_SLUG || '').toLowerCase();

  // Fail closed and silent — no retry storm, no information leakage about
  // why. This is the only gate standing in for real companyId/role
  // validation until the Section 2.3 backfill happens.
  if (!companySlug || !expectedSlug || companySlug !== expectedSlug) {
    console.error('email-ingest: rejected — recipient did not match expected company', { recipient });
    return res.status(200).json({ ok: false, reason: 'company_not_recognised' });
  }

  let app, fsdb;
  try {
    app = getApp();
    fsdb = admin.firestore(app);
  } catch (err) {
    console.error('email-ingest: Firebase Admin init failed', err);
    return res.status(200).json({ ok: false, reason: 'init_error' });
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
      const wb = XLSX.read(attachment.buffer, { type: 'buffer' });
      const csvText = wb.SheetNames.map(name => 'Sheet: ' + name + '\n' + XLSX.utils.sheet_to_csv(wb.Sheets[name], { skipHidden: true })).join('\n\n');
      messageContent = [
        { type: 'text', text: 'The following is the contents of an Excel spreadsheet exported as CSV. This is the most recent month\'s data.\n\n' + csvText + '\n\n' + UTIL_PROMPT }
      ];
    }
  } catch (err) {
    console.error('email-ingest: could not read attachment', err);
    await writeNotification(fsdb, {
      status: 'error', companySlug, from: fromAddress, subject,
      fileName: attachment.filename,
      warnings: ['Could not read the attached file. It may be corrupted or an unsupported variant of PDF/Excel.']
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
    const snap = await fsdb.collection('assets').get();
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
      await fsdb.collection('utilisation').add({
        ...result.utilisationRecord,
        asset_id: String(result.utilisationRecord.asset_id),
        created_at: new Date().toISOString()
      });
      await writeNotification(fsdb, { ...baseLog, status: 'history_only', warnings: result.warnings });
      return res.status(200).json({ ok: true, status: 'history_only' });
    }

    // ---- Review queue gate (Phase 1A: every result, not just high-severity) -
    // Previously, only high-severity warnings (S/N change, delta mismatch,
    // gap detected) held a report back for review — everything else wrote
    // straight to live asset data. Now that this endpoint is reachable by
    // anyone who obtains the shared secret (not just SendGrid), a compromised
    // or leaked secret should not translate into silent live-data writes.
    // Every non-historyOnly result is staged in `pendingReports` regardless
    // of severity, so Apply in the Dashboard review queue is always a human
    // decision. The full merge result (already computed by Brain 1 above) is
    // staged as-is, so Apply is just "write what we already calculated" — no
    // re-parsing, no re-running Brain 1, no risk of a different result
    // between now and review.
    await fsdb.collection('pendingReports').add({
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
  } catch (err) {
    console.error('email-ingest: Firestore write failed', err);
    await writeNotification(fsdb, { ...baseLog, status: 'error', warnings: ['Failed to save to Firestore: ' + (err.message || 'unknown error')] });
    return res.status(200).json({ ok: false, reason: 'write_failed' });
  }
};
