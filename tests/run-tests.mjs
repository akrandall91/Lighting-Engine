import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseIES, interpolateCandela } from '../src/ies-parser.js';
import { buildLinearLayout } from '../src/photometry.js';
import { evaluateElectricalLimits, lightingWhPerNight, sizeSolarSystem } from '../src/solar-engine.js';

const samplePath = new URL('../photometry/ies/SELS IES FINAL/T2M/SELS 45W Solar XSPSM-T2M-4000K.ies', import.meta.url);
const sample = parseIES(await readFile(samplePath, 'utf8'), samplePath.pathname);
assert.ok(sample.verticalAngles.length > 1, 'IES vertical angles should parse');
assert.ok(sample.horizontalAngles.length > 0, 'IES horizontal angles should parse');
assert.ok(interpolateCandela(sample, 0, 45) >= 0, 'Candela interpolation should be non-negative');

const layout = buildLinearLayout({ lengthFt: 240, widthFt: 12, spacingFt: 60, mountHeightFt: 16 });
assert.equal(layout.poleCount, 5, '240 ft at 60 ft spacing requires five endpoint-inclusive poles');
assert.equal(layout.actualSpacing, 60);

const motionWh = lightingWhPerNight({
  lampWatts: 100, lampCount: 1, nightHours: 10, schedule: 'motion',
  standbyPercent: 20, boostPercent: 100, eventsPerHour: 2, boostMinutes: 3,
});
assert.equal(motionWh, 280, 'Motion boost should replace, not duplicate, standby energy');

const limits = evaluateElectricalLimits(
  [{ watts: 40, peakWatts: 90, voltage: 12, quantity: 1 }],
  { outputVoltage: 12, maxContinuousWatts: 60, maxPeakWatts: 100 },
);
assert.equal(limits.safe, true);

const result = sizeSolarSystem({
  activeMonths: [5, 6, 7],
  lighting: {
    lampWatts: 45, lampCount: 1, nightHours: 10, schedule: 'dusk-to-dawn',
    eveningPercent: 100, eveningHours: 4, standbyPercent: 20,
    boostPercent: 100, eventsPerHour: 0, boostMinutes: 0,
  },
  accessories: [],
  controllerWatts: 0,
  loadEfficiency: 1,
  panelWatts: 210,
  batteryWh: 1440,
  reserveDays: 2,
  maxDepthOfDischarge: 0.8,
  coldBatteryFactor: 1,
  endOfLifeCapacity: 1,
  monthlyPsh: Array(12).fill(5),
  style: 'adjustable',
  latitude: 35,
  azimuthDeg: 180,
  tiltDeg: 35,
  shadeFactor: 1,
  solarEfficiency: 0.8,
  inactiveStandbyWh: 0,
});
assert.equal(result.months.filter((month) => month.active).length, 3);
assert.ok(result.requiredPanelWatts > 0);

console.log('All lighting-engine tests passed.');
