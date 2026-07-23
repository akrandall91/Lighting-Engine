const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?/g;

export function parseIES(text, source = '') {
  const normalized = String(text).replace(/\r/g, '');
  const lines = normalized.split('\n');
  const tiltIndex = lines.findIndex((line) => line.trim().toUpperCase().startsWith('TILT='));
  if (tiltIndex < 0) throw new Error('IES file is missing TILT declaration');

  const metadata = {};
  lines.slice(0, tiltIndex).forEach((line) => {
    const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (match) metadata[match[1].toUpperCase()] = match[2].trim();
  });

  const tilt = lines[tiltIndex].split('=')[1]?.trim().toUpperCase();
  if (tilt !== 'NONE') throw new Error(`Unsupported tilt mode: ${tilt || 'unknown'}`);

  const values = lines.slice(tiltIndex + 1).join(' ').match(NUMBER)?.map(Number) || [];
  if (values.length < 13) throw new Error('IES photometric body is incomplete');

  let cursor = 0;
  const lampCount = values[cursor++];
  const lumensPerLamp = values[cursor++];
  const candelaMultiplier = values[cursor++];
  const verticalCount = values[cursor++];
  const horizontalCount = values[cursor++];
  const photometricType = values[cursor++];
  const unitsType = values[cursor++];
  const width = values[cursor++];
  const length = values[cursor++];
  const height = values[cursor++];
  const ballastFactor = values[cursor++];
  const ballastLampFactor = values[cursor++];
  const inputWatts = values[cursor++];
  const verticalAngles = values.slice(cursor, cursor += verticalCount);
  const horizontalAngles = values.slice(cursor, cursor += horizontalCount);
  const expectedCandela = verticalCount * horizontalCount;
  const rawCandela = values.slice(cursor, cursor + expectedCandela);

  if (verticalAngles.length !== verticalCount || horizontalAngles.length !== horizontalCount || rawCandela.length !== expectedCandela) {
    throw new Error('IES angle or candela count does not match the header');
  }

  const candela = [];
  for (let h = 0; h < horizontalCount; h += 1) {
    candela.push(rawCandela.slice(h * verticalCount, (h + 1) * verticalCount).map((value) => value * candelaMultiplier));
  }

  return {
    source,
    version: lines[0]?.trim() || 'unknown',
    metadata,
    tilt,
    lampCount,
    lumens: lumensPerLamp > 0 ? lumensPerLamp * lampCount : null,
    inputWatts,
    photometricType,
    unitsType,
    dimensions: { width, length, height },
    ballastFactor,
    ballastLampFactor,
    verticalAngles,
    horizontalAngles,
    candela,
  };
}

function bracket(values, target) {
  if (target <= values[0]) return [0, 0, 0];
  const last = values.length - 1;
  if (target >= values[last]) return [last, last, 0];
  for (let i = 0; i < last; i += 1) {
    if (target >= values[i] && target <= values[i + 1]) {
      const span = values[i + 1] - values[i];
      return [i, i + 1, span ? (target - values[i]) / span : 0];
    }
  }
  return [last, last, 0];
}

function normalizeHorizontal(angle, angles) {
  let value = ((angle % 360) + 360) % 360;
  const max = angles[angles.length - 1];
  if (max <= 90) {
    value = value % 180;
    if (value > 90) value = 180 - value;
  } else if (max <= 180 && value > 180) {
    value = 360 - value;
  }
  return Math.max(angles[0], Math.min(max, value));
}

export function interpolateCandela(ies, horizontalDeg, verticalDeg) {
  const h = normalizeHorizontal(horizontalDeg, ies.horizontalAngles);
  const v = Math.max(ies.verticalAngles[0], Math.min(ies.verticalAngles.at(-1), verticalDeg));
  const [h0, h1, ht] = bracket(ies.horizontalAngles, h);
  const [v0, v1, vt] = bracket(ies.verticalAngles, v);
  const c00 = ies.candela[h0][v0];
  const c01 = ies.candela[h0][v1];
  const c10 = ies.candela[h1][v0];
  const c11 = ies.candela[h1][v1];
  const a = c00 + (c01 - c00) * vt;
  const b = c10 + (c11 - c10) * vt;
  return a + (b - a) * ht;
}
