// api/_lib/excelLimits.js — shared Excel parsing ceilings
//
// Item 3 (18 Aug review): both api/parse-excel.js and api/email-ingest.js's
// Excel-attachment path accept an uploaded/emailed .xlsx file and hand it to
// ExcelJS's workbook.xlsx.load(). Before this fix, only COMPRESSED size was
// capped (5MB on parse-excel.js, 10MB on email-ingest.js) — uncompressed
// size, ZIP entry count, worksheet count, and row/column count per sheet
// were all unbounded. A small, compressed "zip bomb"-style file (or just a
// pathologically wide/tall sheet) could exhaust memory or CPU time before
// either endpoint got a chance to reject it. Shared here so both call sites
// enforce identical ceilings rather than drifting apart over time.

const JSZip = require('jszip');

// Any real utilisation report or LLP catalogue is a handful of sheets, a few
// hundred rows, well under 50 columns. These ceilings are generous headroom
// above any legitimate file, not a real-world limit on normal use.
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_ZIP_ENTRIES = 100; // a normal .xlsx has ~15-40 internal parts
const MAX_WORKSHEETS = 50;
const MAX_ROWS_PER_SHEET = 100000;
const MAX_COLS_PER_SHEET = 500;
// Neither endpoint declares a long maxDuration, so both run under Vercel's
// short default — a pathological file should fail fast and cleanly rather
// than ride out to a platform-level timeout that surfaces as an opaque 504.
const PARSE_TIMEOUT_MS = 8000;

class ExcelLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExcelLimitError';
  }
}

// Inspects the ZIP central directory via JSZip's loadAsync (which parses
// headers/metadata without inflating entry contents) so an oversized or
// entry-flooded file is rejected BEFORE ExcelJS does the expensive full
// parse. Relies on JSZip's internal `_data.uncompressedSize` — not part of
// JSZip's documented public API — so this is pinned to jszip@3.10.1 (the
// same version ExcelJS itself depends on) to avoid silent drift; re-verify
// this field still exists if either dependency is ever bumped. If the field
// is ever missing, this fails safe by treating that entry's size as unknown
// (0) for the sum but the entry still counts toward MAX_ZIP_ENTRIES, and
// ExcelJS's own load() remains the backstop for anything that slips past.
async function checkZipStructure(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    // Not a valid ZIP at all — let ExcelJS's own load() produce the
    // user-facing "could not read this file" error rather than duplicating
    // that message here.
    return;
  }
  const names = Object.keys(zip.files);
  if (names.length > MAX_ZIP_ENTRIES) {
    throw new ExcelLimitError('This file contains an unusually large number of internal parts and was rejected.');
  }
  let totalUncompressed = 0;
  for (const name of names) {
    const entry = zip.files[name];
    const size = entry && entry._data && typeof entry._data.uncompressedSize === 'number'
      ? entry._data.uncompressedSize
      : 0;
    totalUncompressed += size;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw new ExcelLimitError('This file is too large once decompressed and was rejected.');
    }
  }
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ExcelLimitError(message)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

function checkWorksheetCount(workbook) {
  if (workbook.worksheets.length > MAX_WORKSHEETS) {
    throw new ExcelLimitError(`This file has more than ${MAX_WORKSHEETS} sheets and was rejected.`);
  }
}

// Cheap dimension check (ExcelJS tracks rowCount/columnCount from the
// worksheet's declared dimension) applied BEFORE iterating rows/cells to
// build CSV or row-array output, so a pathological sheet is rejected before
// the expensive per-cell work starts.
function checkSheetBounds(worksheet) {
  if (worksheet.rowCount > MAX_ROWS_PER_SHEET) {
    throw new ExcelLimitError(`Sheet "${worksheet.name}" has more than ${MAX_ROWS_PER_SHEET.toLocaleString()} rows and was rejected.`);
  }
  if (worksheet.columnCount > MAX_COLS_PER_SHEET) {
    throw new ExcelLimitError(`Sheet "${worksheet.name}" has more than ${MAX_COLS_PER_SHEET} columns and was rejected.`);
  }
}

module.exports = {
  ExcelLimitError,
  checkZipStructure,
  withTimeout,
  checkWorksheetCount,
  checkSheetBounds,
  PARSE_TIMEOUT_MS,
  MAX_UNCOMPRESSED_BYTES,
  MAX_ZIP_ENTRIES,
  MAX_WORKSHEETS,
  MAX_ROWS_PER_SHEET,
  MAX_COLS_PER_SHEET,
};