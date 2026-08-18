// api/parse-excel.js — Authenticated Excel parsing endpoint
//
// SECURITY (2026-08, xlsx remediation — Option D, see
// claude_xlsx-remediation-option-d-build-handoff.md): SheetJS (xlsx)
// 0.18.5 has an unpatched prototype-pollution CVE (GHSA-4r6h-8v6p-xvw6)
// with no npm fix and no future npm release — the maintainers only ship
// patched builds through their own CDN, outside the normal npm update
// path. Rather than take on that unusual CDN-sourced dependency, all
// Excel parsing (both client upload flows and the server-side
// email-ingest path) has been consolidated onto ExcelJS, which is
// actively maintained and Node-native.
//
// This endpoint exists specifically so client code never bundles ExcelJS
// itself — ExcelJS relies on Node's Buffer internally and has known,
// unresolved bundling issues under Vite/Rollup in the browser. Moving all
// parsing server-side sidesteps that entirely: the client sends raw file
// bytes, this endpoint parses them, and returns structured sheet data.
// See src/lib/llpCatalogueImport.js and src/components/UploadView.jsx for
// the two client callers (via the shared parseExcelFetch helper in
// src/lib/extraction.js).
//
// Auth: same pattern as /api/extract — any signed-in TailiQ user with a
// recognised role.
//
// DECOMPRESSION / RESOURCE LIMITS (item 3, 18 Aug review): the compressed
// body size was already capped (5MB), but uncompressed size, ZIP entry
// count, worksheet count, and row/column count per sheet were all
// unbounded before workbook.xlsx.load() ran — a small, compressed
// "zip bomb"-style file could exhaust memory/CPU before this endpoint
// got a chance to reject it. Ceilings now live in api/_lib/excelLimits.js
// (shared with api/email-ingest.js's Excel path) and are enforced in this
// order: ZIP structure pre-check (before ExcelJS even loads the file) ->
// load timeout -> worksheet count -> per-sheet row/column bounds. Also
// added: a per-user concurrency lock (same Firestore-transaction pattern
// as api/extract.js's extraction lock), so one user can't queue up
// multiple in-flight parses.
//
// Parse and discard: the uploaded file is parsed in memory only and never
// written anywhere — consistent with the app's parse-and-discard
// commercial story.

const admin = require('firebase-admin');
const ExcelJS = require('exceljs');
const {
  ExcelLimitError,
  checkZipStructure,
  withTimeout,
  checkWorksheetCount,
  checkSheetBounds,
  PARSE_TIMEOUT_MS,
} = require('./_lib/excelLimits');

// Allow both the legacy Vercel URL and the new tailiq.app domain while
// we're mid-transition, matching /api/extract.
const ALLOWED_ORIGINS = [
  'https://vector-fleet.vercel.app',
  'https://app.tailiq.app',
];

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

const VALID_ROLES = new Set(['admin', 'editor', 'viewer', 'dataEntry']);

// Any legitimate utilisation report or LLP catalogue is well under 1MB.
// 5MB matches /api/extract's cap — generous headroom, not a real ceiling
// for legitimate use.
const MAX_BODY_BYTES = 5 * 1024 * 1024;

// Fallback tenant for callers whose token predates the tenantId claim
// (Phase 3). New tokens always carry tenantId; this only matters for a
// brief transition window right after that rollout.
const FALLBACK_TENANT_ID = 'maverick';

// ---- per-user concurrency lock (item 3) -------------------------------------
// Same pattern as api/extract.js's extractionLocks, separate collection so
// the two endpoints' locks never interact. TTL is well above
// PARSE_TIMEOUT_MS plus request overhead, so a crashed invocation can't
// wedge a user out for long, but a legitimate slow parse isn't preempted
// mid-flight either.
const PARSE_LOCK_TTL_MS = 20000;

async function acquireParseLock(fsdb, tenantId, uid) {
  const ref = fsdb.collection('tenants').doc(tenantId).collection('parseExcelLocks').doc(uid);
  return fsdb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    if (snap.exists) {
      const startedAt = snap.data().startedAt || 0;
      if (now - startedAt < PARSE_LOCK_TTL_MS) {
        return false; // still locked by an in-flight call
      }
      // Past TTL — treat as abandoned (crashed invocation) and reclaim it.
    }
    tx.set(ref, { startedAt: now, uid });
    return true;
  });
}

async function releaseParseLock(fsdb, tenantId, uid) {
  try {
    await fsdb.collection('tenants').doc(tenantId).collection('parseExcelLocks').doc(uid).delete();
  } catch (err) {
    // Non-fatal: worst case is the TTL fallback clears it later.
    console.error('parse-excel: failed to release concurrency lock', err);
  }
}

// ---- ExcelJS -> CSV / rows conversion ---------------------------------------
// ExcelJS has no direct sheet_to_csv or sheet_to_json(header:1) equivalent
// — both are built here by hand, close enough to SheetJS's old output for
// this app's two uses (feeding CSV text to Claude, and raw-array column
// matching for LLP catalogues).
function cellValue(cell) {
  return unwrapCellValue(cell.value);
}

// Recursive unwrap so a formula cell's cached result (or a hyperlink's text,
// or rich text) is resolved down to a primitive. Bug fix (2026-08-18, found
// via a real workbook with un-cached cross-sheet formulas): a formula cell
// with NO cached result (never recalculated by whatever last saved the
// file, or errored) has no 'result'/'text'/'richText' key at all — falling
// through to String(val) on the raw {formula:...} object produces the
// literal text "[object Object]", which silently corrupted the CSV sent to
// Claude and broke its JSON response. Any object shape we don't recognise
// is now treated as blank, matching how SheetJS effectively behaved before
// (it also only ever had a cached value to show, never a live recalculation).
function unwrapCellValue(val) {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object') {
    if (val.result !== undefined) return unwrapCellValue(val.result);   // formula cell with a cached result
    if (val.text !== undefined) return unwrapCellValue(val.text);       // rich text / hyperlink
    if (val.richText) return val.richText.map(rt => rt.text).join('');
    return ''; // formula with no cached result, a formula error, or any other unrecognised shape — blank, never stringified
  }
  return typeof val === 'string' ? val : String(val);
}

function sheetToCsv(worksheet) {
  checkSheetBounds(worksheet);
  const rows = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const cells = [];
    for (let i = 1; i <= row.cellCount; i++) {
      let val = String(cellValue(row.getCell(i)));
      if (/[,\n"]/.test(val)) val = '"' + val.replace(/"/g, '""') + '"';
      cells.push(val);
    }
    rows.push(cells.join(','));
  });
  return rows.join('\n');
}

// Matches SheetJS's sheet_to_json(sheet, {header:1, defval:''}) shape —
// an array of arrays, one per row, no header mapping.
function sheetToRows(worksheet) {
  checkSheetBounds(worksheet);
  const rows = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const cells = [];
    for (let i = 1; i <= row.cellCount; i++) {
      cells.push(cellValue(row.getCell(i)));
    }
    rows.push(cells);
  });
  return rows;
}

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  // ---- body size cap, checked as early as possible ------------------------
  const contentLength = Number(req.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'File is too large.' });
  }

  // ---- auth: any signed-in TailiQ user with a recognised role -------------
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    return res.status(401).json({ error: 'Missing authentication token.' });
  }

  let app, decoded;
  try {
    app = getApp();
  } catch (err) {
    console.error('parse-excel: Firebase Admin init failed', err);
    return res.status(500).json({ error: 'Server configuration error.' });
  }
  try {
    decoded = await admin.auth(app).verifyIdToken(idToken, true);
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
  if (!VALID_ROLES.has(decoded.role)) {
    return res.status(403).json({ error: 'Your account is not authorised to use this feature.' });
  }

  const tenantId = decoded.tenantId || FALLBACK_TENANT_ID;

  const { file } = req.body || {};
  if (!file || typeof file !== 'string') {
    return res.status(400).json({ error: 'No file provided.' });
  }

  let buffer;
  try {
    buffer = Buffer.from(file, 'base64');
  } catch (err) {
    return res.status(400).json({ error: 'Could not decode the uploaded file.' });
  }
  if (buffer.length > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'File is too large.' });
  }

  // ---- concurrency cap ------------------------------------------------------
  let fsdb;
  try {
    fsdb = admin.firestore(app);
  } catch (err) {
    console.error('parse-excel: Firestore init failed', err);
    return res.status(500).json({ error: 'Server configuration error.' });
  }
  let lockAcquired;
  try {
    lockAcquired = await acquireParseLock(fsdb, tenantId, decoded.uid);
  } catch (err) {
    console.error('parse-excel: concurrency lock check failed', err);
    return res.status(500).json({ error: 'Server error while checking request status.' });
  }
  if (!lockAcquired) {
    return res.status(429).json({
      error: 'concurrent_limit',
      message: 'A file is already being parsed. Please wait for it to complete.',
    });
  }

  try {
    // ZIP structure pre-check — rejects an oversized-once-decompressed or
    // entry-flooded file before ExcelJS does the expensive full parse.
    await checkZipStructure(buffer);

    const workbook = new ExcelJS.Workbook();
    await withTimeout(
      workbook.xlsx.load(buffer),
      PARSE_TIMEOUT_MS,
      'This file took too long to parse and was rejected.'
    );
    checkWorksheetCount(workbook);
    const sheets = workbook.worksheets.map(ws => ({
      name: ws.name,
      csv: sheetToCsv(ws),
      rows: sheetToRows(ws),
    }));
    return res.status(200).json({ sheets });
  } catch (err) {
    if (err instanceof ExcelLimitError) {
      return res.status(400).json({ error: err.message });
    }
    console.error('parse-excel: failed to parse workbook', err);
    return res.status(400).json({ error: 'Could not read this Excel file. It may be corrupted or an unsupported format.' });
  } finally {
    await releaseParseLock(fsdb, tenantId, decoded.uid);
  }
};