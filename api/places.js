const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

function sendJson(res, status, payload) {
  res.status(status).setHeader('Cache-Control', 'no-store').json(payload);
}

function validNumber(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const radians = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * radians / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin((lon2 - lon1) * radians / 2) ** 2;
  return Math.round(6371e3 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

module.exports = async function placesHandler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const lat = validNumber(body.latitude, -90, 90);
  const lon = validNumber(body.longitude, -180, 180);
  if (lat === null || lon === null) return sendJson(res, 400, { error: '位置座標無效。' });

  const query = `[out:json][timeout:15];(node(around:800,${lat},${lon})["name"]["shop"];node(around:800,${lat},${lon})["name"]["amenity"];);out center;`;
  try {
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': 'ARGUS-VisionEcho/1.0' },
      body: `data=${encodeURIComponent(query)}`
    });
    if (!response.ok) return sendJson(res, 502, { error: '地圖服務暫時無法使用。' });
    const source = await response.json();
    const seen = new Set();
    const places = (source.elements || []).map((item) => ({ name: item.tags?.name, latitude: item.lat ?? item.center?.lat, longitude: item.lon ?? item.center?.lon }))
      .filter((item) => item.name && Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
      .map((item) => ({ ...item, distance: distanceMeters(lat, lon, item.latitude, item.longitude) }))
      .filter((item) => !seen.has(`${item.name}:${item.latitude}:${item.longitude}`) && seen.add(`${item.name}:${item.latitude}:${item.longitude}`))
      .sort((a, b) => a.distance - b.distance).slice(0, 10);
    return sendJson(res, 200, { places });
  } catch (error) {
    return sendJson(res, 502, { error: error.message || '地圖服務暫時無法使用。' });
  }
};
