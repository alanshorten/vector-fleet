import { extractFetch, extractPdfPageTexts, fileToBase64, parseExcelFetch } from './extraction';

// ============================================================
// LLP Catalogue upload parsers — knowledge-base-scoping-handoff.md §1
// "Upload catalogue — Excel or PDF. System matches against the shopping
// list, populates prices, user reviews."
//
// Excel: pure client-side column matching, no AI needed.
//
// PDF: a LOOKUP, not a full extraction — deliberately redesigned after a
// real 100+ page full CFM spare parts catalogue broke the original
// "send the whole PDF, extract every row" approach (function timeout,
// and even with more time, thousands of rows of structured JSON wouldn't
// fit in one model response regardless). Since the fleet only ever needs
// ~50-60 specific known part numbers (never the full manufacturer
// catalogue — see the scoping doc), the fix is to look those up rather
// than extract everything: extract page text client-side
// (extractPdfPageTexts — no AI, no cost, scales to any page count),
// string-search it for each target part number, and send only the
// matched short text snippets to /api/extract. Cost and time are
// proportional to the number of fleet part numbers, not to how long the
// source catalogue is.
// ============================================================

// Scans every sheet in the workbook (real escalation-model workbooks —
// like the one this was built and tested against — commonly split by
// engine family across sheets, e.g. "CFM"/"IAE"/"V2500", and there's no
// reliable way to know in advance which sheet name maps to which family
// tab in the app). Returns [{ partNumber, unitPrice }, ...] deduped by
// part number (last sheet processed wins on a collision — harmless in
// practice since the same part number found in two sheets of a real
// escalation model has matched, not conflicting, prices).
//
// Within each sheet, if there are multiple columns whose header contains
// "price" (a real multi-year escalation table has one per year), the
// RIGHTMOST one is used — assumed to be the most recent year, since that
// convention held in the one real file this was tested against. If your
// spreadsheet lists years newest-to-oldest instead, this will pick the
// oldest price — flag it if the parsed prices come out anywhere close to
// half of what you expect at a glance, that's the tell.
async function parseExcelCatalogueFile(file) {
  // Parsing moved server-side (xlsx remediation, 2026-08 — see
  // claude_xlsx-remediation-option-d-build-handoff.md): /api/parse-excel
  // returns each sheet's rows as an array of arrays, matching the shape
  // this function's column-matching logic already expected from
  // XLSX.utils.sheet_to_json(sheet, {header:1, defval:''}). Only the data
  // source changed — everything below is untouched.
  let sheets;
  try {
    const base64 = await fileToBase64(file);
    sheets = await parseExcelFetch(base64);
  } catch (err) {
    throw new Error("Couldn't read this Excel file — " + (err.message || "unknown error"));
  }

  const byPartNumber = {};

  sheets.forEach(({ rows }) => {
    let headerIdx = -1, pnCol = -1, priceCol = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const row = (rows[i] || []).map(c => String(c).toLowerCase().trim());
      const pnCandidates = [];
      const priceCandidates = [];
      row.forEach((c, idx) => {
        // "material" included alongside part-number wording — one
        // real sheet in testing used "2026 Material" as its part
        // number column header, with no "part number"/"P/N" wording
        // anywhere on the row.
        if (/part\s*number|p\/n|part\s*no|material/.test(c)) pnCandidates.push(idx);
        // Contains-match, not exact — real headers were "2023 Price",
        // "2025 Price" etc, not a bare "Price" cell.
        if (/price|unit\s*rate|unit\s*cost/.test(c)) priceCandidates.push(idx);
      });
      if (pnCandidates.length && priceCandidates.length) {
        headerIdx = i;
        pnCol = pnCandidates[pnCandidates.length - 1];
        priceCol = priceCandidates[priceCandidates.length - 1]; // rightmost = most recent year
        break;
      }
    }
    if (headerIdx === -1) return; // this sheet doesn't look like a price table — skip it, not an error

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const pn = String((rows[i] || [])[pnCol] || '').trim();
      const priceRaw = (rows[i] || [])[priceCol];
      const price = parseFloat(String(priceRaw).replace(/[^0-9.-]/g, ''));
      if (pn && !isNaN(price)) byPartNumber[pn] = price;
    }
  });

  const entries = Object.entries(byPartNumber).map(([partNumber, unitPrice]) => ({ partNumber, unitPrice }));
  if (!entries.length) {
    throw new Error("Couldn't find any Part Number / Price columns in this file — check the file, or enter prices manually below.");
  }
  return entries;
}

// Finds the best snippet of surrounding text for a part number anywhere
// in the document's per-page extracted text. Prefers an occurrence whose
// nearby text contains something that looks like a price (3+ digit
// number, optionally with commas/decimals) over one that doesn't — real
// price-table rows have a price nearby; an incidental cross-reference or
// index mention of the same part number usually doesn't. Falls back to
// the first occurrence found if no candidate has a nearby price-looking
// number, rather than giving up. Returns null if the part number doesn't
// appear anywhere in the document.
function findSnippetForPartNumber(pages, partNumber) {
  const needle = partNumber.toLowerCase();
  let firstAnyMatch = null;
  for (const page of pages) {
    const text = page.text || '';
    const lower = text.toLowerCase();
    let searchFrom = 0;
    while (true) {
      const idx = lower.indexOf(needle, searchFrom);
      if (idx === -1) break;
      const start = Math.max(0, idx - 60);
      const end = Math.min(text.length, idx + partNumber.length + 120);
      const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
      if (firstAnyMatch == null) firstAnyMatch = snippet;
      if (/\d[\d,]{2,}(\.\d+)?/.test(snippet)) return snippet;
      searchFrom = idx + needle.length;
    }
  }
  return firstAnyMatch;
}

function buildLookupPrompt(entries) {
  const list = entries.map((e, i) => `${i + 1}. Part number "${e.partNumber}": "${e.snippet}"`).join('\n');
  return `You are looking up unit prices for specific known part numbers within short text snippets extracted from a spare parts catalogue PDF. Each snippet is the raw text surrounding one part number exactly as it appeared in the source document — formatting may be imperfect (columns run together, irregular spacing) since it came from PDF text extraction, not a clean table.

For each numbered entry below, find the unit price associated with that exact part number in its own snippet. If you cannot confidently identify a price for an entry, OMIT it from your response entirely — never guess or estimate.

${list}

Return ONLY valid JSON, no markdown: {"rows":[{"partNumber":"string","unitPrice":number}]}`;
}

// Looks up prices for a KNOWN, SMALL set of target part numbers — the
// fleet's own shopping list (knowledge-base-scoping-handoff.md's ~50-60
// parts, never the full manufacturer catalogue) — within a PDF of ANY
// length. This is a deliberate redesign from an earlier "send the whole
// PDF, extract every row" approach, which broke against a real 100+ page
// full CFM spare parts catalogue: a single /api/extract call can't
// process that much source material within the function's timeout, and
// even given more time, structured JSON for thousands of rows wouldn't
// fit in one model response anyway. Since only ~50-60 specific values are
// ever needed, the fix is to look them up rather than extract everything:
//   1. Extract raw text per page CLIENT-SIDE (extractPdfPageTexts — the
//      same function LeaseWizard's Confidential Extract already uses;
//      no AI call, no cost, and it scales to any page count).
//   2. Plain string-search that text for each target part number.
//   3. Send only the matched snippets (a handful of short text
//      fragments) to /api/extract — proportional to the number of fleet
//      part numbers, NOT to the catalogue's total size.
// Target part numbers with no match anywhere in the document are simply
// absent from the result — same "not found, stays flagged amber"
// outcome as before, just reached without ever sending the whole
// document anywhere. No document/base64 content block is used at all
// here — every /api/extract call in this function is plain text.
async function parsePdfCatalogueFile(file, targetPartNumbers) {
  if (file.type !== "application/pdf") throw new Error("Please upload a PDF file.");
  // No longer bound by an API payload size limit (the PDF itself is
  // never sent to /api/extract) — this is just a sanity ceiling against
  // an accidental multi-hundred-MB upload hanging the browser's own
  // client-side text extraction.
  if (file.size > 60 * 1024 * 1024) throw new Error("File is too large (maximum 60 MB).");
  if (!targetPartNumbers || !targetPartNumbers.length) {
    throw new Error("No fleet part numbers to look up yet — the scan hasn't found any LLP part numbers for this family across the fleet.");
  }

  const pages = await extractPdfPageTexts(file); // [{label, text}, ...]

  const snippetEntries = targetPartNumbers
    .map(pn => ({ partNumber: pn, snippet: findSnippetForPartNumber(pages, pn) }))
    .filter(e => e.snippet != null);

  if (!snippetEntries.length) {
    throw new Error(`None of this fleet's ${targetPartNumbers.length} part numbers were found anywhere in this document — check it's the right catalogue file.`);
  }

  const resp = await extractFetch({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: [{ type: "text", text: buildLookupPrompt(snippetEntries) }] }]
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
