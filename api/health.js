module.exports = function healthHandler(_req, res) {
  res.status(200).json({ ok: true, geminiConfigured: Boolean(process.env.GEMINI_API_KEY) });
};
