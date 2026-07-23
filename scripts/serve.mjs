import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || process.argv[2] || 8000);
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const env = { ...await loadEnv(join(root, '.env')), ...process.env };
const sessionSecret = env.SESSION_SECRET || randomBytes(32).toString('hex');
const loginAttempts = new Map();

function loadEnv(path) {
  return readFile(path, 'utf8').then((text) => Object.fromEntries(text.split(/\r?\n/)
    .map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const split = line.indexOf('=');
      return [line.slice(0, split), line.slice(split + 1).replace(/^['"]|['"]$/g, '')];
    }))).catch(() => ({}));
}

function cookie(req, name) {
  const value = (req.headers.cookie || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length + 1)) : '';
}

function sign(value) {
  return createHmac('sha256', sessionSecret).update(value).digest('base64url');
}

function authenticated(req) {
  if (!env.APP_PASSWORD_HASH) return env.NODE_ENV !== 'production';
  const token = cookie(req, 'akrd_session');
  const [expires, signature] = token.split('.');
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(sign(expires)));
}

function verifyPassword(password) {
  const [scheme, salt, expected] = (env.APP_PASSWORD_HASH || '').split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

function send(res, status, body, type = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://maps.googleapis.com https://maps.gstatic.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.googleapis.com https://*.gstatic.com https://*.google.com; connect-src 'self' https://*.googleapis.com https://*.gstatic.com; frame-src https://www.google.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), 'application/json; charset=utf-8');
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    if (chunks.reduce((size, item) => size + item.length, 0) > 16_384) throw new Error('Request too large');
  }
  return Buffer.concat(chunks).toString('utf8');
}

function loginPage(message = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow"><title>AKRD Access</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111715;color:#fff;font-family:Inter,system-ui,sans-serif}
  main{width:min(420px,calc(100% - 32px));padding:34px;border:1px solid #34423d;background:#17201d;border-radius:16px}
  i{display:block;width:44px;height:4px;background:#c9ff5b;margin-bottom:24px}h1{margin:0 0 8px}p{color:#b9c5c1}label{display:block;font-size:.8rem;font-weight:800;margin:25px 0 8px}
  input{width:100%;height:50px;border:1px solid #53635d;border-radius:8px;background:#0d1311;color:#fff;padding:0 13px;font:inherit}
  button{width:100%;height:50px;margin-top:14px;border:0;border-radius:8px;background:#c9ff5b;color:#111715;font-weight:900}.error{color:#ffb5a9}</style></head>
  <body><main><i></i><small>AKRD PRODUCT STUDIO</small><h1>Lighting Engine</h1><p>Private planning workspace. Authorized access only.</p>
  ${message ? `<p class="error">${message}</p>` : ''}<form method="post" action="/login"><label for="password">Access password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button>Enter workspace</button></form></main></body></html>`;
}

async function proxyJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  return response.json();
}

async function api(req, res, url) {
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  try {
    if (url.pathname === '/api/status') {
      return sendJson(res, 200, {
        googleMapsBrowser: Boolean(env.GOOGLE_MAPS_BROWSER_KEY),
        googleServer: Boolean(env.GOOGLE_MAPS_SERVER_KEY),
        census: Boolean(env.CENSUS_API_KEY),
        nrel: Boolean(env.NREL_API_KEY),
        eia: Boolean(env.EIA_API_KEY),
        openMeteo: true,
      });
    }
    if (url.pathname === '/api/client-config') {
      return sendJson(res, 200, { googleMapsBrowserKey: env.GOOGLE_MAPS_BROWSER_KEY || '' });
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return sendJson(res, 400, { error: 'Valid lat and lng are required.' });
    if (url.pathname === '/api/solar-resource') {
      if (!env.NREL_API_KEY) return sendJson(res, 503, { error: 'NREL key is not configured.' });
      const endpoint = new URL('https://developer.nrel.gov/api/solar/solar_resource/v1.json');
      endpoint.search = new URLSearchParams({ api_key: env.NREL_API_KEY, lat: String(lat), lon: String(lng) });
      const data = await proxyJson(endpoint);
      return sendJson(res, 200, { source: 'NREL Solar Resource', monthly: data.outputs?.avg_lat_tilt?.monthly || null });
    }
    if (url.pathname === '/api/climate') {
      const endpoint = new URL('https://archive-api.open-meteo.com/v1/archive');
      endpoint.search = new URLSearchParams({
        latitude: String(lat), longitude: String(lng), start_date: '2015-01-01',
        end_date: '2024-12-31', daily: 'temperature_2m_min,cloud_cover_mean,snowfall_sum',
        timezone: 'auto',
      });
      return sendJson(res, 200, { source: 'Open-Meteo historical weather', data: await proxyJson(endpoint) });
    }
    if (url.pathname === '/api/elevation') {
      if (!env.GOOGLE_MAPS_SERVER_KEY) return sendJson(res, 503, { error: 'Google server key is not configured.' });
      const endpoint = `https://maps.googleapis.com/maps/api/elevation/json?locations=${lat},${lng}&key=${encodeURIComponent(env.GOOGLE_MAPS_SERVER_KEY)}`;
      return sendJson(res, 200, { source: 'Google Elevation API', data: await proxyJson(endpoint) });
    }
    if (url.pathname === '/api/census') {
      if (!env.CENSUS_API_KEY) return sendJson(res, 503, { error: 'Census key is not configured.' });
      const geo = new URL('https://geocoding.geo.census.gov/geocoder/geographies/coordinates');
      geo.search = new URLSearchParams({ x: String(lng), y: String(lat), benchmark: 'Public_AR_Current', vintage: 'Current_Current', format: 'json' });
      const geography = await proxyJson(geo);
      const tract = geography.result?.geographies?.['Census Tracts']?.[0];
      if (!tract) return sendJson(res, 404, { error: 'No Census tract was found.' });
      const acs = new URL('https://api.census.gov/data/2024/acs/acs5');
      acs.search = new URLSearchParams({
        get: 'NAME,B01003_001E,B01003_001M',
        for: `tract:${tract.TRACT}`, in: `state:${tract.STATE} county:${tract.COUNTY}`, key: env.CENSUS_API_KEY,
      });
      const rows = await proxyJson(acs);
      return sendJson(res, 200, {
        source: '2024 ACS 5-year', geography: { state: tract.STATE, county: tract.COUNTY, tract: tract.TRACT },
        population: { estimate: Number(rows?.[1]?.[1]), marginOfError: Number(rows?.[1]?.[2]) },
      });
    }
    if (url.pathname === '/api/electricity-rate') {
      if (!env.EIA_API_KEY) return sendJson(res, 503, { error: 'EIA key is not configured.' });
      const state = String(url.searchParams.get('state') || '').toUpperCase();
      if (!/^[A-Z]{2}$/.test(state)) return sendJson(res, 400, { error: 'Two-letter state is required.' });
      const endpoint = new URL('https://api.eia.gov/v2/electricity/retail-sales/data/');
      endpoint.search = new URLSearchParams({
        api_key: env.EIA_API_KEY, frequency: 'annual', 'data[0]': 'price',
        'facets[stateid][]': state, 'facets[sectorid][]': 'COM', sort: 'period', direction: 'desc', length: '1',
      });
      const data = await proxyJson(endpoint);
      return sendJson(res, 200, { source: 'EIA retail electricity sales', record: data.response?.data?.[0] || null });
    }
    return sendJson(res, 404, { error: 'API route not found.' });
  } catch (error) {
    return sendJson(res, 502, { error: error.message });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ip = req.socket.remoteAddress || 'unknown';
  if (url.pathname === '/login' && req.method === 'GET') return send(res, 200, loginPage(), 'text/html; charset=utf-8');
  if (url.pathname === '/login' && req.method === 'POST') {
    const record = loginAttempts.get(ip) || { count: 0, until: 0 };
    if (record.until > Date.now()) return send(res, 429, loginPage('Too many attempts. Try again later.'), 'text/html; charset=utf-8');
    const password = new URLSearchParams(await body(req)).get('password') || '';
    if (!verifyPassword(password)) {
      record.count += 1;
      if (record.count >= 5) { record.until = Date.now() + 15 * 60_000; record.count = 0; }
      loginAttempts.set(ip, record);
      return send(res, 401, loginPage('Incorrect password.'), 'text/html; charset=utf-8');
    }
    loginAttempts.delete(ip);
    const expires = String(Date.now() + 30 * 60_000);
    const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
    return send(res, 302, '', 'text/plain', {
      Location: '/', 'Set-Cookie': `akrd_session=${expires}.${sign(expires)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800${secure}`,
    });
  }
  if (!authenticated(req)) return send(res, 302, '', 'text/plain', { Location: '/login' });
  if (url.pathname.startsWith('/api/')) return api(req, res, url);

  const requestPath = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const safePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, safePath);
  if (!file.startsWith(root)) return send(res, 403, 'Forbidden');
  try {
    if (!(await stat(file)).isFile()) throw new Error('Not a file');
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ies': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png' };
    send(res, 200, await readFile(file), `${types[extname(file)] || 'application/octet-stream'}; charset=utf-8`,
      safePath === 'index.html' ? {} : { 'Cache-Control': 'private, max-age=300' });
  } catch {
    send(res, 404, 'Not found');
  }
});

server.listen(port, host, () => {
  console.log(`AKRD Lighting Engine listening on ${host}:${port}`);
  if (!env.APP_PASSWORD_HASH) console.warn('Authentication is disabled outside production until APP_PASSWORD_HASH is configured.');
});
