export const maxDuration = 60;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });

    const text = await response.text();

    // --- DEBUG: log everything about the raw response ---
    console.log('[extract] HTTP status:', response.status);
    console.log('[extract] response length (chars):', text.length);
    console.log('[extract] first 300 chars:', text.slice(0, 300));
    console.log('[extract] last 300 chars:', text.slice(-300));

    // Try the proper parse path
    let properResult = null;
    let properError = null;
    try {
      const parsed = JSON.parse(text);
      console.log('[extract] top-level keys:', Object.keys(parsed));
      console.log('[extract] stop_reason:', parsed.stop_reason);
      if (Array.isArray(parsed.content)) {
        console.log('[extract] content block count:', parsed.content.length);
        parsed.content.forEach((block, i) => {
          console.log(`[extract] content[${i}] type:`, block.type,
            block.type === 'text' ? `len=${block.text?.length}` : '');
        });
        const textBlocks = parsed.content.filter(b => b.type === 'text').map(b => b.text);
        const combinedText = textBlocks.join('\n');
        const cleaned = combinedText.replace(/```json|```/g, '').trim();
        try {
          properResult = JSON.parse(cleaned);
          console.log('[extract] PROPER PARSE: success, keys:', Object.keys(properResult));
        } catch (e) {
          properError = 'proper-path JSON.parse of extracted text failed: ' + e.message;
          console.log('[extract] PROPER PARSE: failed to parse extracted text as JSON.', e.message);
          console.log('[extract] cleaned text preview (first 1000 chars):', cleaned.slice(0, 1000));
          console.log('[extract] cleaned text preview (last 1000 chars):', cleaned.slice(-1000));
        }
      } else {
        console.log('[extract] parsed.content is not an array. parsed.error?', parsed.error);
        properError = 'no content array on parsed response. Full parsed body: ' + JSON.stringify(parsed).slice(0, 1000);
      }
    } catch (e) {
      properError = 'top-level JSON.parse(text) failed: ' + e.message;
      console.log('[extract] top-level JSON.parse(text) failed:', e.message);
    }

    // --- OLD REGEX PATH (kept temporarily for comparison) ---
    const match = text.match(/"type":"text","text":"([\s\S]*?)"\s*\}/);
    let regexResult = null;
    let regexError = null;
    if (match) {
      const extracted = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/```json|```/g, '').trim();
      console.log('[extract] regex matched, extracted length:', extracted.length);
      try {
        regexResult = JSON.parse(extracted);
        console.log('[extract] REGEX PARSE: success');
      } catch (e) {
        regexError = 'regex-path JSON.parse failed: ' + e.message;
        console.log('[extract] REGEX PARSE: failed.', e.message);
        console.log('[extract] regex-extracted preview (first 500):', extracted.slice(0, 500));
      }
    } else {
      regexError = 'regex did not match at all';
      console.log('[extract] regex did NOT match the response text.');
    }

    console.log('[extract] SUMMARY -> proper ok:', !!properResult, '| regex ok:', !!regexResult);
    if (!!properResult !== !!regexResult) {
      console.log('[extract] *** MISMATCH between proper path and regex path ***');
    }

    // --- Respond using proper path if it worked, else fall back to regex result, else surface diagnostics ---
    if (properResult) {
      return res.status(200).json({ ok: true, data: properResult, _debugPath: 'proper' });
    }
    if (regexResult) {
      return res.status(200).json({ ok: true, data: regexResult, _debugPath: 'regex-fallback' });
    }

    return res.status(200).json({
      ok: false,
      _debugPath: 'none',
      properError,
      regexError,
      httpStatus: response.status,
      preview: text.slice(0, 800)
    });

  } catch (err) {
    console.log('[extract] outer catch error:', err.message, err.stack);
    return res.status(200).json({ error: err.message });
  }
}
