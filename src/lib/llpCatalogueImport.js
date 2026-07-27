import * as XLSX from 'xlsx';

// ============================================================
// LLP Catalogue upload parsers — knowledge-base-scoping-handoff.md §1
// "Upload catalogue — Excel or PDF. System matches against the shopping
// list, populates prices, user reviews."
//
// Excel: pure client-side column matching, no AI needed.
//
// PDF: follows extraction.js's DOCUMENT-BLOCK pattern (extractLLPSheet,
// extractOperatorHistory, extractAvionicsLRU) — the raw PDF is sent as a
// base64 document content block straight to Claude via /api/extract, NOT
// extracted to text client-side first. That text-extraction path
// (extractPdfPageTexts + runLeaseExtraction) is specific to LeaseWizard's
// Confidential Extract tier, which exists only because lease documents
// are sensitive enough to need page-by-page confirmation before anything
// leaves the browser. A catalogue price list has no such privacy
// requirement, so it follows the same pattern as every other plain
// document extraction in this app: whole PDF in, structured JSON out,
// with the same status-code/error-message handling and result-parsing
// (including the Array.isArray(...) last-element fallback) as
// extractLLPSheet/extractAvionicsLRU.
// ============================================================

// Returns [{ partNumber, unitPrice }, ...]. Throws with a user-facing
// message if no recognisable Part Number / Price header pair is found
// in the first 10 rows of the first sheet.
function parseExcelCatalogueFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        let headerIdx = -1, pnCol = -1, priceCol = -1;
        for (let i = 0; i < Math.min(rows.length, 10); i++) {
          const row = (rows[i] || []).map(c => String(c).toLowerCase());
          const pn = row.findIndex(c => /part\s*number|p\/n|part\s*no/.test(c));
          const price = row.findIndex(c => /unit\s*price|unit\s*rate|unit\s*cost|^price$/.test(c));
          if (pn !== -1 && price !== -1) { headerIdx = i; pnCol = pn; priceCol = price; break; }
        }
        if (headerIdx === -1) {
          reject(new Error("Couldn't find Part Number / Unit Price columns in this file's header row — check the file, or enter prices manually below."));
          return;
        }

        const entries = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const pn = String((rows[i] || [])[pnCol] || '').trim();
          const priceRaw = (rows[i] || [])[priceCol];
          const price = parseFloat(String(priceRaw).replace(/[^0-9.-]/g, ''));
          if (pn && !isNaN(price)) entries.push({ partNumber: pn, unitPrice: price });
        }
        if (!entries.length) {
          reject(new Error("Found the header row but no valid part number / price rows underneath it."));
          return;
        }
        resolve(entries);
      } catch (err) {
        reject(new Error("Couldn't read this Excel file — " + (err.message || "unknown error")));
      }
    };
    reader.onerror = () => reject(new Error("Couldn't read the file."));
    reader.readAsArrayBuffer(file);
  });
}

const LLP_CATALOGUE_PROMPT = `Extract every part number and its unit price from this LLP (Life Limited Parts) catalogue/price list document. Documents vary in layout — some are simple two-column tables, some have additional columns (description, engine family, notes) that should be ignored. Extract ONLY rows that clearly have both a part number and a unit price.

For each row, extract ONLY:
- "partNumber": the part number as printed (e.g. "1234-56-789").
- "unitPrice": the unit price as a plain number, no currency symbol and no thousands separators (e.g. 125000.50, not "$125,000.50").

Ignore any other columns present (description, quantity, notes, etc.) — they are not needed. Skip rows missing either value.

Return ONLY valid JSON, no markdown: {"rows":[{"partNumber":"string","unitPrice":number}]}`;

// Same shape and error handling as extractLLPSheet/extractAvionicsLRU in
// extraction.js — Sonnet, not Haiku (dense multi-page tabular extraction
// is at/above Haiku's reliable ceiling, same reasoning as ENGINE_LLP_PROMPT
// and AVIONICS_LRU_PROMPT there).
async function parsePdfCatalogueFile(file) {
  if (file.type !== "application/pdf") throw new Error("Please upload a PDF file.");
  if (file.size > 15 * 1024 * 1024) throw new Error("File is too large (maximum 15 MB).");
  const base64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Could not read the file. Please try again."));
    r.readAsDataURL(file);
  });
  const resp = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 6000,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          { type: "text", text: LLP_CATALOGUE_PROMPT }
        ]
      }]
    })
  });
  if (!resp.ok) {
    const status = resp.status;
    if (status === 401 || status === 403) throw new Error("Authentication error with the AI service. Please contact your administrator.");
    if (status === 429) throw new Error("Too many requests — please wait a moment and try again.");
    if (status >= 500) throw new Error("The extraction service is temporarily unavailable. Please try again in a few minutes.");
    throw new Error("Extraction request failed (error " + status + "). Please try again.");
  }
  let result;
  try { result = await resp.json(); } catch (jsonErr) { throw new Error("Received an unexpected response from the server. Please try again."); }
  if (result.error) {
    const msg = result.error;
    if (msg.includes("credit") || msg.includes("billing")) throw new Error("AI service billing issue — please contact your administrator.");
    if (msg.includes("overloaded") || msg.includes("capacity")) throw new Error("The AI service is busy right now. Please wait a moment and try again.");
    throw new Error("Extraction failed. Please check the file is a valid catalogue document and try again.");
  }
  let parsed;
  try {
    const rawParsed = result.ok ? result.data : JSON.parse((result.raw || "").replace(/```json|```/g, "").trim());
    // Same defensive unwrap as every other extractor in extraction.js —
    // if the model ever returns multiple JSON candidates as an array,
    // take the last one rather than failing.
    parsed = Array.isArray(rawParsed) ? rawParsed[rawParsed.length - 1] : rawParsed;
  } catch (parseErr) {
    throw new Error("The AI could not extract structured data from this file. Check it is a valid LLP catalogue document.");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.rows)) {
    throw new Error("The AI returned an unexpected format. Check the file is a valid LLP catalogue document.");
  }
  return parsed.rows
    .filter(r => r && r.partNumber && typeof r.unitPrice === "number")
    .map(r => ({ partNumber: String(r.partNumber).trim(), unitPrice: r.unitPrice }));
}

function isCatalogueExcelFile(file) {
  return /\.(xlsx|xls)$/i.test(file.name) || file.type.includes("spreadsheet") || file.type.includes("excel");
}
function isCatalogueUploadFile(file) {
  return isCatalogueExcelFile(file) || file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export { isCatalogueExcelFile, isCatalogueUploadFile, parseExcelCatalogueFile, parsePdfCatalogueFile };
