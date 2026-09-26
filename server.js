const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

loadEnv();

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const MIME_TYPES = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function loadEnv() {
  try {
    const contents = require('node:fs').readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch { /* .env is optional */ }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function safeNumber(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error('Request body is too large.');
  }
  try { return JSON.parse(body || '{}'); } catch { throw new Error('Invalid JSON body.'); }
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const radians = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * radians / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin((lon2 - lon1) * radians / 2) ** 2;
  return Math.round(6371e3 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function analyze(body) {
  if (!process.env.GEMINI_API_KEY) return { status: 503, data: { error: 'Gemini 尚未設定。請在伺服器的 .env 填入 GEMINI_API_KEY。' } };
  if (typeof body.image !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(body.image)) return { status: 400, data: { error: '缺少有效的影像資料。' } };
  const prompt = typeof body.prompt === 'string' && body.prompt.length <= 500 ? body.prompt : 'Act as a visual assistant for a blind person. Describe the scene in under 18 words. State a traffic-light color first if visible. Reply with only the concise description.';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: body.image } }] }] })
  });
  const data = await response.json();
  if (!response.ok) return { status: response.status, data: { error: data.error?.message || 'Gemini request failed.' } };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  return text ? { status: 200, data: { text } } : { status: 502, data: { error: 'AI did not return a description.' } };
}

async function findPlaces(body) {
  const lat = safeNumber(body.latitude, -90, 90);
  const lon = safeNumber(body.longitude, -180, 180);
  if (lat === null || lon === null) return { status: 400, data: { error: '位置座標無效。' } };
  const mode = ['radar', 'landmark', 'search'].includes(body.mode) ? body.mode : 'radar';
  const radius = mode === 'search' ? 3000 : mode === 'landmark' ? 1500 : 800;
  const search = String(body.query || '').trim().replace(/[\\"\[\]{}();]/g, '').slice(0, 80);
  const query = mode === 'search' && search
    ? `[out:json][timeout:15];(node(around:${radius},${lat},${lon})["name"~"${search}",i];way(around:${radius},${lat},${lon})["name"~"${search}",i];);out center;`
    : mode === 'landmark'
      ? `[out:json][timeout:15];(node(around:${radius},${lat},${lon})["public_transport"];node(around:${radius},${lat},${lon})["amenity"="hospital"];);out center;`
      : `[out:json][timeout:15];(node(around:${radius},${lat},${lon})["name"]["shop"];node(around:${radius},${lat},${lon})["name"]["amenity"];);out center;`;
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'ARGUS-VisionEcho/1.0 (local development)'
    },
    body: `data=${encodeURIComponent(query)}`
  });
  if (!response.ok) return { status: 502, data: { error: '地圖服務暫時無法使用。' } };
  const source = await response.json();
  const seen = new Set();
  const places = (source.elements || []).map((item) => ({ name: item.tags?.name, latitude: item.lat ?? item.center?.lat, longitude: item.lon ?? item.center?.lon }))
    .filter((item) => item.name && Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
    .map((item) => ({ ...item, distance: distanceMeters(lat, lon, item.latitude, item.longitude) }))
    .filter((item) => !seen.has(`${item.name}:${item.latitude}:${item.longitude}`) && seen.add(`${item.name}:${item.latitude}:${item.longitude}`))
    .sort((a, b) => a.distance - b.distance).slice(0, 10);
  return { status: 200, data: { places } };
}

async function serveStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });
  try { const file = await fs.readFile(filePath); res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' }); res.end(file); }
  catch { sendJson(res, 404, { error: 'Not found' }); }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true, geminiConfigured: Boolean(process.env.GEMINI_API_KEY) });
    if (req.method === 'POST' && url.pathname === '/api/analyze') { const result = await analyze(await readJson(req)); return sendJson(res, result.status, result.data); }
    if (req.method === 'POST' && url.pathname === '/api/places') { const result = await findPlaces(await readJson(req)); return sendJson(res, result.status, result.data); }
    if (req.method === 'GET') return serveStatic(res, url.pathname);
    sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) { console.error(error); sendJson(res, 500, { error: error.message || 'Server error.' }); }
}).listen(PORT, () => console.log(`ARGUS is running at http://localhost:${PORT}`));
