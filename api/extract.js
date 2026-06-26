export const maxDuration = 60;

// Allow both the legacy Vercel URL and the new tailiq.app domain while we're
// mid-transition. Drop the .vercel.app entry in a future cleanup session
// once app.tailiq.app is confirmed solid for everything.
const ALLOWED_ORIGINS = [
  'https://vector-fleet.vercel.app',
  'https://app.tailiq.app',
];

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
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
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return res.status(200).json({ ok: false, raw: text.slice(0, 2000) });
    }
    if (!Array.isArray(parsed.content)) {
      return res.status(200).json({ ok: false, raw: (parsed.error?.message || JSON.stringify(parsed)).slice(0, 2000) });
    }
    // Combine all text blocks (handles the rare multi-block case)
    const combinedText = parsed.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');
    // The model may reason in plain text before producing the answer.
    // Prefer a fenced ```json ... ``` block if present — this is what we
    // now explicitly ask for in prompts that allow reasoning (e.g. LLP extraction).
    let candidate;
    const fenced = combinedText.match(/```json\s*([\s\S]*?)```/);
    if (fenced) {
      candidate = fenced[1].trim();
    } else {
      // Fallback: no fence found. Try to find the first '{' or '[' and take
      // everything from there to the matching last '}' or ']' in the text,
      // in case the model dropped the fence but still ended with raw JSON.
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
      return res.status(200).json({ ok: true, data: JSON.parse(candidate) });
    } catch (e) {
      return res.status(200).json({ ok: false, raw: combinedText.slice(0, 2000) });
    }
  } catch (err) {
    return res.status(200).json({ error: err.message });
  }
}
