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
        'x-api-key': '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',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });

    const text = await response.text();
    
    // Find just the content array using regex to avoid parsing 245MB
    const match = text.match(/"content"\s*:\s*(\[.*?\])/s);
    if (!match) return res.status(200).json({ error: 'No content in response', preview: text.slice(0, 500) });
    
    const content = JSON.parse(match[1]);
    const extracted = content.map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
    
    try {
      return res.status(200).json({ ok: true, data: JSON.parse(extracted) });
    } catch {
      return res.status(200).json({ ok: false, raw: extracted.slice(0, 2000) });
    }

  } catch (err) {
    return res.status(200).json({ error: err.message });
  }
}
