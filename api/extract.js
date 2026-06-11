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
    const match = text.match(/"type":"text","text":"([\s\S]*?)"\s*\}/);
    if (match) {
      const extracted = match[1].replace(/\\n/g,'\n').replace(/\\"/g,'"').replace(/```json|```/g,'').trim();
      try {
        return res.status(200).json({ ok: true, data: JSON.parse(extracted) });
      } catch {
        return res.status(200).json({ ok: false, raw: extracted.slice(0, 2000) });
      }
    }
    return res.status(200).json({ ok: false, preview: text.slice(0, 500) });

  } catch (err) {
    return res.status(200).json({ error: err.message });
  }
}
