async function request(path, params = {}) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { credentials: 'same-origin' });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(window.location.hostname.endsWith('github.io')
      ? 'Secure API server unavailable: GitHub Pages cannot run the password or API backend.'
      : 'Secure API server returned a non-JSON response.');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export const getApiStatus = () => request('/api/status');

export async function getLocationContext({ latitude, longitude, stateCode }) {
  const coordinates = { lat: latitude, lng: longitude };
  const tasks = {
    solar: request('/api/solar-resource', coordinates),
    climate: request('/api/climate', coordinates),
    elevation: request('/api/elevation', coordinates),
    census: request('/api/census', coordinates),
    electricity: request('/api/electricity-rate', { ...coordinates, state: stateCode }),
  };
  const entries = await Promise.all(Object.entries(tasks).map(async ([key, promise]) => {
    try { return [key, { ok: true, data: await promise }]; }
    catch (error) { return [key, { ok: false, error: error.message }]; }
  }));
  return Object.fromEntries(entries);
}
