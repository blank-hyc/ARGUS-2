function sendJson(res, status, payload) {
  res.status(status).setHeader('Cache-Control', 'no-store').json(payload);
}

module.exports = async function analyzeHandler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  if (!process.env.GEMINI_API_KEY) return sendJson(res, 503, { error: 'Gemini 尚未設定。請在 Vercel Environment Variables 新增 GEMINI_API_KEY。' });
  if (typeof body.image !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(body.image)) return sendJson(res, 400, { error: '缺少有效的影像資料。' });

  const prompt = typeof body.prompt === 'string' && body.prompt.length <= 500
    ? body.prompt
    : 'Act as a visual assistant for a blind person. Describe the scene in under 18 words. State a traffic-light color first if visible. Reply with only the concise description.';

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: body.image } }] }] })
    });
    const data = await response.json();
    if (!response.ok) return sendJson(res, response.status, { error: data.error?.message || 'Gemini request failed.' });
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    return text ? sendJson(res, 200, { text }) : sendJson(res, 502, { error: 'AI did not return a description.' });
  } catch (error) {
    return sendJson(res, 502, { error: error.message || 'Gemini request failed.' });
  }
};
