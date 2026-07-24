import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseIES, interpolateCandela } from '../src/ies-parser.js';
import { buildLinearLayout, buildManualLayout } from '../src/photometry.js';
import { evaluateElectricalLimits, lightingWhPerNight, sizeSolarSystem } from '../src/solar-engine.js';
import { compareProjectAlternatives } from '../src/project-economics.js';
import { calculateSustainability } from '../src/sustainability.js';
import { buildDecisionIntelligence } from '../src/decision-intelligence.js';

const samplePath = new URL('../photometry/ies/46W/46W-T2M-L082110603.ies', import.meta.url);
const sample = parseIES(await readFile(samplePath, 'utf8'), samplePath.pathname);
assert.ok(sample.verticalAngles.length > 1, 'IES vertical angles should parse');
assert.ok(sample.horizontalAngles.length > 0, 'IES horizontal angles should parse');
assert.ok(interpolateCandela(sample, 0, 45) >= 0, 'Candela interpolation should be non-negative');

const layout = buildLinearLayout({ lengthFt: 240, widthFt: 12, spacingFt: 60, mountHeightFt: 16 });
assert.equal(layout.poleCount, 5, '240 ft at 60 ft spacing requires five endpoint-inclusive poles');
assert.equal(layout.actualSpacing, 60);

const manualLayout = buildManualLayout({
  poles: [{ lat: 35, lng: -80.0001 }, { lat: 35, lng: -79.9999 }],
  centerLat: 35, centerLng: -80, lengthFt: 240, widthFt: 12,
  mountHeightFt: 16, outputFraction: 0.8,
});
assert.equal(manualLayout.poleCount, 2);
assert.ok(manualLayout.actualSpacing > 50 && manualLayout.actualSpacing < 70);
assert.equal(manualLayout.luminaires[0].outputFraction, 0.8);
assert.ok(manualLayout.routeLengthFt > 50);
assert.ok(manualLayout.luminaires.every((pole) =>
  pole.x >= 0 && pole.x <= manualLayout.siteLengthFt
  && pole.y >= 0 && pole.y <= manualLayout.siteWidthFt));

const mappedCurve = buildManualLayout({
  poles: [
    { lat: 35.0000, lng: -80.0000 },
    { lat: 35.0003, lng: -79.9998 },
    { lat: 35.0005, lng: -79.9995 },
    { lat: 35.0007, lng: -79.9993 },
    { lat: 35.0010, lng: -79.9991 },
  ],
  centerLat: 35, centerLng: -80, lengthFt: 240, widthFt: 16,
  mountHeightFt: 20,
});
assert.ok(mappedCurve.siteLengthFt > 240, 'Mapped corridor should expand when placed poles exceed input length');
assert.ok(mappedCurve.siteWidthFt >= 16);
assert.ok(mappedCurve.luminaires.every((pole) =>
  pole.x >= 0 && pole.x <= mappedCurve.siteLengthFt
  && pole.y >= 0 && pole.y <= mappedCurve.siteWidthFt));

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

const decision = buildDecisionIntelligence({
  state: {
    avgFcTarget: 0.5, minFcTarget: 0.1, utilityRatePerKwh: 0.15,
    clearSouth: 'confirmed', apiContext: {},
  },
  economics: {
    trenchAndRestorationCost: 20000, gridLifecycle: 100000,
    lifecycleSavings: 25000, trenchLengthFt: 200,
  },
  sustainability: { avoidedKg: 5000, avoidedMetricTons: 5 },
  photometric: { avgFc: 0.8, minFc: 0.2 },
  solar: {
    energyPass: true, reservePass: true,
    worstMonth: { psh: 3.4, month: 'December' },
  },
  registryRecord: { testId: 'TEST-1', testLab: 'Lab', path: 'fixture.ies' },
});
assert.equal(decision.tests.lightingPass, true);
assert.equal(decision.tests.financialPass, true);
assert.equal(decision.sensitivity.length, 3);
assert.equal(decision.challenges.length, 0);

console.log('All lighting-engine tests passed.');
