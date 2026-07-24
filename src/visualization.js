let mapsPromise;
let siteMap;
let siteOverlays = [];

async function loadGoogleMaps() {
  if (window.google?.maps) return window.google.maps;
  if (mapsPromise) return mapsPromise;
  mapsPromise = (async () => {
    if (window.location.hostname.endsWith('github.io')) {
      throw new Error('Opening the secure Render application...');
    }
    const configResponse = await fetch('/api/client-config', { credentials: 'same-origin' });
    const contentType = configResponse.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('The secure map server is not available on this address.');
    }
    const config = await configResponse.json();
    if (!config.googleMapsBrowserKey) throw new Error('Google Maps browser key is not configured.');
    return new Promise((resolve, reject) => {
      const callback = `__akrdMaps${Date.now()}`;
      window[callback] = () => {
        delete window[callback];
        resolve(window.google.maps);
      };
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.googleMapsBrowserKey)}&libraries=places,geometry&callback=${callback}&loading=async&v=weekly`;
      script.async = true;
      script.onerror = () => reject(new Error('Google Maps failed to load.'));
      document.head.appendChild(script);
    });
  })();
  return mapsPromise;
}

function poleCoordinates(state, layout) {
  if (Array.isArray(state.manualPoles) && state.manualPoles.length) {
    return state.manualPoles.map((pole) => ({ lat: Number(pole.lat), lng: Number(pole.lng) }));
  }
  if (state.polePlacementMode) return [];
  const latitude = Number(state.latitude);
  const longitude = Number(state.longitude);
  const feetPerDegreeLat = 364000;
  const feetPerDegreeLng = feetPerDegreeLat * Math.max(0.2, Math.cos(latitude * Math.PI / 180));
  return layout.luminaires.map((pole) => ({
    lat: latitude + (pole.y - state.widthFt / 2) / feetPerDegreeLat,
    lng: longitude + (pole.x - state.lengthFt / 2) / feetPerDegreeLng,
  }));
}

export async function renderSiteMap(container, state, layout, options = {}) {
  if (!container) return;
  try {
    const maps = await loadGoogleMaps();
    if (!container.isConnected) return;
    const center = { lat: Number(state.latitude), lng: Number(state.longitude) };
    siteMap = new maps.Map(container, {
      center, zoom: 19, mapTypeId: 'satellite', tilt: 45, heading: 0,
      mapTypeControl: true, streetViewControl: true, rotateControl: true,
      fullscreenControl: true, zoomControl: true,
    });
    if (state.polePlacementMode) {
      siteMap.setOptions({ draggableCursor: 'crosshair' });
      siteMap.addListener('click', (event) => {
        if (!event.latLng || typeof options.onPolesChange !== 'function') return;
        options.onPolesChange([...(state.manualPoles || []), {
          lat: event.latLng.lat(),
          lng: event.latLng.lng(),
        }]);
      });
    }
    siteOverlays.forEach((overlay) => overlay.setMap?.(null));
    siteOverlays = [];
    const coordinates = poleCoordinates(state, layout);
    const infoWindow = new maps.InfoWindow();
    coordinates.forEach((position, index) => {
      const marker = new maps.Marker({
        map: siteMap, position, title: `Pole ${index + 1} · ${Number(state.mountingHeightFt)} ft mounting height`,
        draggable: Boolean(state.manualPoles?.length),
        icon: {
          path: maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#c9ff5b',
          fillOpacity: 1, strokeColor: '#111715', strokeWeight: 2.5,
        },
      });
      marker.addListener('click', () => {
        infoWindow.setContent(`<div class="map-popup"><strong>Pole ${index + 1}</strong><br>${Number(state.mountingHeightFt)} ft mounting height<br>${Number(layout.actualSpacing || 0).toFixed(1)} ft ${state.manualPoles?.length ? 'average' : 'calculated'} spacing${state.manualPoles?.length ? '<br><small>Drag this marker to refine placement.</small>' : ''}</div>`);
        infoWindow.open({ map: siteMap, anchor: marker });
      });
      marker.addListener('dragend', (event) => {
        if (!event.latLng || typeof options.onPolesChange !== 'function') return;
        const next = state.manualPoles.map((pole, poleIndex) => poleIndex === index ? {
          lat: event.latLng.lat(),
          lng: event.latLng.lng(),
        } : pole);
        options.onPolesChange(next);
      });
      siteOverlays.push(marker);
    });
    if (coordinates.length > 1) {
      const feetPerDegreeLng = 364000 * Math.max(0.2, Math.cos(center.lat * Math.PI / 180));
      const halfLength = Number(state.lengthFt) / 2 / feetPerDegreeLng;
      const route = new maps.Polyline({
        map: siteMap,
        path: state.manualPoles?.length ? coordinates : [
          { lat: center.lat, lng: center.lng - halfLength },
          { lat: center.lat, lng: center.lng + halfLength },
        ],
        strokeColor: '#c9ff5b', strokeOpacity: 0.75, strokeWeight: 3,
      });
      siteOverlays.push(route);
      const bounds = new maps.LatLngBounds();
      coordinates.forEach((point) => bounds.extend(point));
      siteMap.fitBounds(bounds, 70);
      maps.event.addListenerOnce(siteMap, 'idle', () => {
        if (siteMap.getZoom() > 20) siteMap.setZoom(20);
      });
    }
  } catch (error) {
    container.innerHTML = `<div class="scene-map-error"><strong>Map unavailable</strong><span>${escapeText(error.message)}</span></div>`;
  }
}

function colorForFc(fc, maxFc) {
  const ratio = Math.max(0, Math.min(1, fc / Math.max(0.01, maxFc)));
  if (ratio < 0.2) return `rgba(17,23,21,${0.88 - ratio})`;
  if (ratio < 0.45) return `rgba(0,168,120,${0.28 + ratio})`;
  if (ratio < 0.72) return `rgba(201,255,91,${0.3 + ratio * 0.5})`;
  return `rgba(255,224,128,${0.45 + ratio * 0.5})`;
}

export function drawPhotometricPlan(canvas, state, result) {
  if (!canvas || !result) return;
  const context = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const pad = 52;
  const plan = { x: pad, y: pad, w: width - pad * 2, h: height - pad * 2 };
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#111715';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#18231f';
  context.fillRect(plan.x, plan.y, plan.w, plan.h);
  const values = result.values || [];
  const xs = [...new Set(values.map((item) => item.x))].sort((a, b) => a - b);
  const ys = [...new Set(values.map((item) => item.y))].sort((a, b) => a - b);
  const cellW = plan.w / Math.max(1, xs.length - 1);
  const cellH = plan.h / Math.max(1, ys.length - 1);
  values.forEach((point) => {
    const x = plan.x + point.x / state.lengthFt * plan.w;
    const y = plan.y + point.y / state.widthFt * plan.h;
    context.fillStyle = colorForFc(point.fc, result.maxFc);
    context.fillRect(x - cellW / 2, y - cellH / 2, cellW + 1, cellH + 1);
  });
  result.layout.luminaires.forEach((pole, index) => {
    const x = plan.x + pole.x / state.lengthFt * plan.w;
    const y = plan.y + pole.y / state.widthFt * plan.h;
    context.fillStyle = '#fff';
    context.strokeStyle = '#111715';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(x, y, 7, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = '#fff';
    context.font = '700 10px system-ui';
    context.textAlign = 'center';
    context.fillText(`P${index + 1}`, x, y - 12);
  });
  context.strokeStyle = 'rgba(255,255,255,.5)';
  context.strokeRect(plan.x, plan.y, plan.w, plan.h);
  context.fillStyle = '#fff';
  context.textAlign = 'left';
  context.font = '700 15px system-ui';
  context.fillText(`${result.avgFc.toFixed(2)} FC average · ${result.minFc.toFixed(2)} FC minimum`, plan.x, 28);
}

export function drawSideElevation(canvas, state, result) {
  if (!canvas || !result) return;
  const context = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const ground = height - 45;
  context.clearRect(0, 0, width, height);
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#101b25');
  sky.addColorStop(1, '#18231f');
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#72827c';
  context.beginPath();
  context.moveTo(0, ground);
  context.lineTo(width, ground);
  context.stroke();
  const poles = result.layout.luminaires.slice(0, 8);
  const spacing = width / (poles.length + 1);
  poles.forEach((pole, index) => {
    const x = spacing * (index + 1);
    const top = 45;
    context.strokeStyle = '#d6e0dc';
    context.lineWidth = 7;
    context.beginPath();
    context.moveTo(x, ground);
    context.lineTo(x, top);
    context.stroke();
    context.fillStyle = '#294c5a';
    context.save();
    context.translate(x, top);
    context.rotate(-state.tiltDeg * Math.PI / 180);
    context.fillRect(-25, -5, 50, 10);
    context.restore();
    context.strokeStyle = '#c8d4d0';
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(x, top + 34);
    context.lineTo(x + 30, top + 39);
    context.stroke();
    context.fillStyle = '#f8dfa0';
    context.fillRect(x + 25, top + 34, 18, 9);
    const glow = context.createLinearGradient(x, top + 43, x, ground);
    glow.addColorStop(0, 'rgba(255,224,128,.32)');
    glow.addColorStop(1, 'rgba(255,224,128,.02)');
    context.fillStyle = glow;
    context.beginPath();
    context.moveTo(x + 25, top + 43);
    context.lineTo(x + 43, top + 43);
    context.lineTo(x + 75, ground);
    context.lineTo(x - 7, ground);
    context.closePath();
    context.fill();
  });
  context.fillStyle = '#fff';
  context.font = '700 14px system-ui';
  context.fillText(`${state.mountingHeightFt} ft mounting height · ${result.layout.poleCount} poles total`, 20, 25);
}

function escapeText(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
