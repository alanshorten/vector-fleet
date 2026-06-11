export const maxDuration = 60;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': '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',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
    
    const text = await response.text();
    if (!text) return res.status(200).json({ error: 'Empty response from Anthropic', status: response.status });
    try {
      return res.status(200).json(JSON.parse(text));
    } catch {
      return res.status(200).json({ error: 'Non-JSON response', raw: text.slice(0, 500), status: response.status });
    }
  } catch (err) {
    return res.status(200).json({ error: err.message, stack: err.stack });
  }
}
