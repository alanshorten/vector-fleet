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
// recognised role. No further per-user usage limits here: this endpoint
// makes no AI calls and costs nothing beyond a small, bounded compute
// spike, so the abuse-limits work (claude_abuse-limits-build-spec.md)
// intentionally didn't extend to it.
//
// Parse and discard: the uploaded file is parsed in memory only and never
// written anywhere — consistent with the app's parse-and-discard
// commercial story.

const admin = require('firebase-admin');
const ExcelJS = require('exceljs');

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

// ---- ExcelJS -> CSV / rows conversion ---------------------------------------
// ExcelJS has no direct sheet_to_csv or sheet_to_json(header:1) equivalent
// — both are built here by hand, close enough to SheetJS's old output for
// this app's two uses (feeding CSV text to Claude, and raw-array column
// matching for LLP catalogues).
function cellValue(cell) {
  let val = cell.value;
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    if (val.result !== undefined) val = val.result;   // formula cell
    else if (val.text !== undefined) val = val.text;   // rich text
    else if (val.richText) val = val.richText.map(rt => rt.text).join('');
  }
  if (val instanceof Date) return val.toISOString();
  return typeof val === 'string' ? val : String(val);
}

function sheetToCsv(worksheet) {
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

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheets = workbook.worksheets.map(ws => ({
      name: ws.name,
      csv: sheetToCsv(ws),
      rows: sheetToRows(ws),
    }));
    return res.status(200).json({ sheets });
  } catch (err) {
    console.error('parse-excel: failed to parse workbook', err);
    return res.status(400).json({ error: 'Could not read this Excel file. It may be corrupted or an unsupported format.' });
  }
};