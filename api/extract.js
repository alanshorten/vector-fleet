export const maxDuration = 60;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    // Remove document from body before sending to reduce response size
    const body = req.body;
    if (body.messages) {
      body.messages = body.messages.map(msg => ({
        ...msg,
        content: Array.isArray(msg.content) 
          ? msg.content.filter(c => c.type === 'text')
          : msg.content
      }));
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': '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',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    
    const data = await response.json();
    const text = data.content?.map(c => c.text || '').join('') || '';
    const clean = text.replace(/```json|```/g, '').trim();
    
    try {
      const parsed = JSON.parse(clean);
      return res.status(200).json({ ok: true, data: parsed });
    } catch {
      return res.status(200).json({ ok: false, raw: clean.slice(0, 2000) });
    }
    
  } catch (err) {
    return res.status(200).json({ error: err.message });
  }
}
