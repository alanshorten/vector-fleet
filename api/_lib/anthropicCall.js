// api/_lib/anthropicCall.js — shared Anthropic Messages API caller
//
// Extracted from api/extract.js during the Phase 1B security remediation
// (security-remediation-roadmap.md) so that api/email-ingest.js can reuse
// the exact same "call Claude + parse its response" logic WITHOUT making an
// HTTP round-trip back into /api/extract — that round-trip is what forced
// extract.js's new Firebase-ID-token auth requirement into an awkward
// server-to-server corner (email-ingest.js has no user session to get a
// token from). Calling this shared function in-process instead keeps
// extract.js's auth model simple (browser callers only) while still giving
// email-ingest.js the identical Claude-calling behaviour extract.js has —
// same model/response handling, same JSON-candidate extraction — with a
// single source of truth for any future fix to that logic.
//
// This module does NOT do any authorization of its own — callers
// (api/extract.js, api/email-ingest.js) are each responsible for verifying
// the caller is allowed to invoke them before calling this.
//
// Note: this file lives under api/_lib/, not directly under api/ — Vercel
// does not turn underscore-prefixed folders into routes, so this stays an
// internal module rather than becoming its own (unauthenticated) endpoint.

async function callAnthropic({ model, max_tokens, messages }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model, max_tokens, messages })
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { httpStatus: 502, ok: false, raw: text.slice(0, 2000) };
  }
  if (!response.ok || !Array.isArray(parsed.content)) {
    const status = !response.ok && response.status >= 400 ? response.status : 502;
    return { httpStatus: status, ok: false, raw: (parsed.error?.message || JSON.stringify(parsed)).slice(0, 2000) };
  }
  // Combine all text blocks (handles the rare multi-block case)
  const combinedText = parsed.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');
  // The model may reason in plain text before producing the answer. Prefer
  // a fenced ```json ... ``` block if present — this is what we explicitly
  // ask for in prompts that allow reasoning (e.g. LLP extraction).
  let candidate;
  const fenced = combinedText.match(/```json\s*([\s\S]*?)```/);
  if (fenced) {
    candidate = fenced[1].trim();
  } else {
    // Fallback: no fence found. Try to find the first '{' or '[' and take
    // everything from there to the matching last '}' or ']' in the text, in
    // case the model dropped the fence but still ended with raw JSON.
    const firstBrace = combinedText.search(/[\{\[]/);
    if (firstBrace !== -1) {
      const lastBraceObj = combinedText.lastIndexOf('}');
      const lastBraceArr = combinedText.lastIndexOf(']');
      const lastBrace = Math.max(lastBraceObj, lastBraceArr);
      candidate = lastBrace > firstBrace ? combinedText.slice(firstBrace, lastBrace + 1) : combinedText;
    } else {
      candidate = combinedText;
    }
  }
  candidate = candidate.replace(/```json|```/g, '').trim();
  try {
    return { httpStatus: 200, ok: true, data: JSON.parse(candidate) };
  } catch (e) {
    // Anthropic call succeeded but no usable JSON was found in the response
    // text — a semantic extraction failure, not an upstream HTTP failure.
    return { httpStatus: 200, ok: false, raw: combinedText.slice(0, 2000) };
  }
}

module.exports = { callAnthropic };
