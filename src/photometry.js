import { interpolateCandela } from './ies-parser.js';

const FEET_TO_METERS = 0.3048;
const LUX_TO_FC = 0.092903;

export function pointIlluminanceFc(ies, luminaire, point, lightLossFactor = 0.82) {
  const dx = point.x - luminaire.x;
  const dy = point.y - luminaire.y;
  const dz = luminaire.z;
  const horizontalDistance = Math.hypot(dx, dy);
  const distanceFt = Math.hypot(horizontalDistance, dz);
  if (distanceFt <= 0) return 0;

  const verticalDeg = Math.atan2(horizontalDistance, dz) * 180 / Math.PI;
  const worldBearing = Math.atan2(dy, dx) * 180 / Math.PI;
  const horizontalDeg = worldBearing - (luminaire.headingDeg || 0);
  const candela = interpolateCandela(ies, horizontalDeg, verticalDeg);
  const distanceM = distanceFt * FEET_TO_METERS;
  const cosine = dz / distanceFt;
  const lux = candela * cosine / (distanceM * distanceM);
  return lux * LUX_TO_FC * lightLossFactor * (luminaire.outputFraction ?? 1);
}

export function buildLinearLayout({ lengthFt, widthFt, spacingFt, mountHeightFt, layout = 'one-side', setbackFt = 0 }) {
  const usableLength = Math.max(0, lengthFt - setbackFt * 2);
  const perRow = Math.max(2, Math.ceil(usableLength / Math.max(1, spacingFt)) + 1);
  const actualSpacing = perRow > 1 ? usableLength / (perRow - 1) : 0;
  const rows = layout === 'both-sides' ? [0, widthFt] : layout === 'centerline' ? [widthFt / 2] : [0];
  const luminaires = [];
  rows.forEach((y, rowIndex) => {
    for (let i = 0; i < perRow; i += 1) {
      luminaires.push({
        x: setbackFt + actualSpacing * i,
        y,
        z: mountHeightFt,
        headingDeg: rowIndex === 1 ? -90 : 90,
        outputFraction: 1,
      });
    }
  });
  return { luminaires, perRow, poleCount: luminaires.length, actualSpacing };
}

export function buildManualLayout({
  poles, centerLat, centerLng, lengthFt, widthFt, mountHeightFt, outputFraction = 1,
}) {
  const latitude = Number(centerLat);
  const longitude = Number(centerLng);
  const feetPerDegreeLat = 364000;
  const feetPerDegreeLng = feetPerDegreeLat * Math.max(0.2, Math.cos(latitude * Math.PI / 180));
  const luminaires = (poles || []).map((pole) => ({
    x: Number(lengthFt) / 2 + (Number(pole.lng) - longitude) * feetPerDegreeLng,
    y: Number(widthFt) / 2 + (Number(pole.lat) - latitude) * feetPerDegreeLat,
    z: Number(mountHeightFt),
    headingDeg: 90,
    outputFraction,
  }));
  const distances = luminaires.slice(1).map((pole, index) =>
    Math.hypot(pole.x - luminaires[index].x, pole.y - luminaires[index].y));
  const actualSpacing = distances.length
    ? distances.reduce((total, distance) => total + distance, 0) / distances.length
    : 0;
  return {
    luminaires,
    perRow: luminaires.length,
    poleCount: luminaires.length,
    actualSpacing,
    placement: 'manual',
  };
}

export function calculateGrid(ies, layout, site, options = {}) {
  const stepFt = options.gridStepFt || Math.max(2, Math.min(5, site.widthFt / 8));
  const values = [];
  let minFc = Infinity;
  let maxFc = 0;
  let sum = 0;
  for (let x = 0; x <= site.lengthFt + 0.001; x += stepFt) {
    for (let y = 0; y <= site.widthFt + 0.001; y += stepFt) {
      const fc = layout.luminaires.reduce(
        (total, luminaire) => total + pointIlluminanceFc(ies, luminaire, { x, y }, options.lightLossFactor),
        0,
      );
      values.push({ x, y, fc });
      minFc = Math.min(minFc, fc);
      maxFc = Math.max(maxFc, fc);
      sum += fc;
    }
  }
  const avgFc = values.length ? sum / values.length : 0;
  return {
    avgFc,
    minFc: Number.isFinite(minFc) ? minFc : 0,
    maxFc,
    avgToMin: minFc > 0 ? avgFc / minFc : Infinity,
    maxToMin: minFc > 0 ? maxFc / minFc : Infinity,
    values,
  };
}
