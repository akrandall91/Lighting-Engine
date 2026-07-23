import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseIES, interpolateCandela } from '../src/ies-parser.js';
import { buildLinearLayout } from '../src/photometry.js';
import { evaluateElectricalLimits, lightingWhPerNight, sizeSolarSystem } from '../src/solar-engine.js';
import { compareProjectAlternatives } from '../src/project-economics.js';
import { calculateSustainability } from '../src/sustainability.js';

const samplePath = new URL('../photometry/ies/46W/46W-T2M-L082110603.ies', import.meta.url);
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

const comparison = compareProjectAlternatives({
  trenchSegments: [{ surface: 'concrete', lengthFt: 100 }],
  poleCount: 2, poleInstalledCost: 6000, gridServiceCost: 12000,
  utilityCoordinationCost: 3000, trafficControlCost: 4000, irrigationRepairCost: 0,
  treeProtectionCost: 0, gridMobilizationCost: 3000, solarEquipmentPerPole: 7000,
  solarInstallPerPole: 2000, solarMobilizationCost: 2000, solarSiteRestorationCost: 500,
  annualLightingKwh: 500, utilityRatePerKwh: 0.15, monthlyServiceCharge: 25,
  gridAnnualMaintenance: 300, solarAnnualMaintenance: 400, batteryReplacementCost: 3000,
  batteryLifeYears: 8, analysisYears: 20, discountRate: 0.04, energyEscalation: 0.02,
});
assert.equal(comparison.trenchLengthFt, 100);
assert.ok(comparison.trenchAndRestorationCost > 0);
assert.ok(comparison.landscapeRestorationCost === 0);

const carbon = calculateSustainability({
  annualGridKwh: 1000, analysisYears: 20, gridKgCo2ePerKwh: 0.4,
  gridConstructionKg: 2000, solarEmbodiedKg: 2500, batteryReplacementKg: 300,
  solarAnnualMaintenanceKg: 10, batteryLifeYears: 8, carbonPricePerMetricTon: 50,
});
assert.equal(carbon.replacements, 2);
assert.ok(carbon.avoidedKg > 0);

console.log('All lighting-engine tests passed.');
