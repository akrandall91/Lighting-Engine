import {
  ACCESSORY_PRESETS,
  APPLICATIONS,
  BATTERY_SIZES_WH,
  DEFAULT_MONTHLY_PSH,
  MONTHS,
  PANEL_SIZES_W,
  SOLAR_STYLES,
} from './catalog.js';
import { parseIES } from './ies-parser.js';
import { buildLinearLayout, calculateGrid } from './photometry.js';
import {
  evaluateElectricalLimits,
  remainingAccessoryAllowance,
  sizeSolarSystem,
} from './solar-engine.js';
import { compareProjectAlternatives, SURFACE_TYPES } from './project-economics.js';
import { calculateSustainability, LEED_PATHWAYS } from './sustainability.js';
import { getApiStatus, getLocationContext, resolveAddress } from './api-client.js';
import { drawPhotometricPlan, drawSideElevation, renderSiteMap } from './visualization.js';
import { buildDecisionIntelligence } from './decision-intelligence.js';

const STORAGE_KEY = 'akrd-lighting-engine-v3';
const state = loadState();
let registry = { records: [] };
let selectedIES = null;
let photometricResult = null;
let solarResult = null;
let economicsResult = null;
let sustainabilityResult = null;
let apiStatus = {};
let decisionResult = null;

function initialState() {
  return {
    step: 1,
    projectName: '',
    address: '',
    resolvedAddress: '',
    application: 'pathway',
    latitude: 35,
    longitude: -80,
    stateCode: 'NC',
    apiContext: {},
    lengthFt: 240,
    widthFt: 12,
    layout: 'one-side',
    avgFcTarget: 0.5,
    minFcTarget: 0.1,
    mountingHeightFt: 16,
    spacingFt: 55,
    setbackFt: 0,
    fixtureId: '',
    lampWatts: 45,
    distribution: 'T2M',
    outputPercent: 100,
    schedule: 'smart',
    eveningPercent: 80,
    eveningHours: 4,
    standbyPercent: 20,
    boostPercent: 100,
    eventsPerHour: 2,
    boostMinutes: 3,
    nightHours: 12,
    activeMonths: MONTHS.map((_, index) => index),
    solarStyle: 'adjustable',
    azimuthDeg: 180,
    tiltDeg: 35,
    clearSouth: 'confirmed',
    shadePercent: 0,
    panelWatts: 165,
    batteryWh: 1080,
    reserveDays: 3,
    monthlyPsh: [...DEFAULT_MONTHLY_PSH],
    accessories: [],
    siteType: 'pole',
    trenchSurface: 'turf',
    trenchLengthFt: 240,
    poleInstalledCost: 6500,
    gridServiceCost: 18000,
    utilityCoordinationCost: 7500,
    trafficControlCost: 8000,
    irrigationRepairCost: 3500,
    treeProtectionCost: 2500,
    gridMobilizationCost: 6000,
    solarEquipmentPerPole: 7800,
    solarInstallPerPole: 2200,
    solarMobilizationCost: 3500,
    solarSiteRestorationCost: 1200,
    utilityRatePerKwh: 0.16,
    monthlyServiceCharge: 28,
    gridAnnualMaintenance: 450,
    solarAnnualMaintenance: 650,
    batteryReplacementCost: 2800,
    batteryLifeYears: 8,
    analysisYears: 20,
    discountRatePercent: 4,
    energyEscalationPercent: 2.5,
    gridKgCo2ePerKwh: 0.38,
    solarEmbodiedKgPerPole: 850,
    batteryReplacementKg: 240,
    carbonPricePerMetricTon: 65,
    hardware: {
      outputVoltage: 12,
      maxContinuousWatts: 60,
      maxPeakWatts: 100,
    },
  };
}

function loadState() {
  try {
    return { ...initialState(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return initialState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const status = document.querySelector('#saveStatus');
  status.textContent = 'Autosaved';
}

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, digits = 1) => Number(value || 0).toFixed(digits);
const STEP_LABELS = ['Site', 'Lighting', 'Solar + loads', 'Alternatives', 'Decision brief'];

function getWorkflowState() {
  const siteReady = Boolean(state.projectName.trim() && (state.resolvedAddress || state.address.trim()));
  const lightingReady = Boolean(selectedIES
    && photometricResult?.avgFc >= state.avgFcTarget
    && photometricResult?.minFc >= state.minFcTarget);
  const energyReady = Boolean(solarResult?.energyPass && solarResult?.reservePass
    && solarResult?.electrical?.safe && state.clearSouth === 'confirmed');
  const alternativesReady = Boolean(economicsResult && state.trenchLengthFt >= 0 && state.analysisYears > 0);
  const decisionReady = siteReady && lightingReady && energyReady && alternativesReady;
  return {
    steps: [siteReady, lightingReady, energyReady, alternativesReady, decisionReady],
    completeCount: [siteReady, lightingReady, energyReady, alternativesReady].filter(Boolean).length,
    decisionReady,
  };
}

function stepGuidance() {
  const workflow = getWorkflowState();
  const guides = [
    {
      title: state.resolvedAddress ? 'Site evidence is connected' : 'Confirm the project location',
      body: state.resolvedAddress
        ? 'Review the mapped pole corridor and operating season before moving to lighting.'
        : 'Name the project, enter an address, and load location evidence so every downstream result uses the correct place.',
    },
    {
      title: workflow.steps[1] ? 'Lighting target is met' : 'Tune the lighting pattern',
      body: workflow.steps[1]
        ? `Measured photometry clears the selected ${state.avgFcTarget} average and ${state.minFcTarget} minimum foot-candle targets.`
        : 'Adjust wattage, distribution, height, spacing, or output until both average and minimum targets pass.',
    },
    {
      title: workflow.steps[2] ? 'Energy system clears the planning checks' : 'Close the worst-month energy gap',
      body: workflow.steps[2]
        ? 'Generation, battery reserve, electrical output, and southern exposure are aligned.'
        : `Each pole or shelter system needs about ${Math.ceil(solarResult?.requiredPanelWatts || 0)} W of panel and ${Math.ceil(solarResult?.requiredBatteryWh || 0).toLocaleString()} Wh of nominal storage.`,
    },
    {
      title: 'Compare complete project costs',
      body: 'Replace planning allowances with local quantities or bids. Trenching, restoration, utility coordination, maintenance, and replacements are all included.',
    },
    {
      title: workflow.decisionReady ? 'Ready for technical review' : 'Decision brief with open challenges',
      body: workflow.decisionReady
        ? 'All four planning workstreams are complete. Review the evidence ledger before issuing the report.'
        : 'The report remains available, but it clearly identifies every failed check, assumption, and field-verification requirement.',
    },
  ];
  return guides[state.step - 1];
}

function showToast(message, type = 'info') {
  const region = document.querySelector('#toastRegion');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i aria-hidden="true">${type === 'success' ? '✓' : type === 'warning' ? '!' : 'i'}</i><span>${esc(message)}</span>`;
  region.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  window.setTimeout(() => {
    toast.classList.remove('visible');
    window.setTimeout(() => toast.remove(), 250);
  }, 3600);
}

function userFacingVerdict() {
  const costWinner = economicsResult.lifecycleSavings >= 0 ? 'solar' : 'grid';
  const carbonWinner = sustainabilityResult.avoidedMetricTons >= 0 ? 'solar' : 'grid';
  const energyGap = Math.max(0, -(solarResult.worstMonth?.marginPercent || 0));
  if (!solarResult.energyPass) return {
    title: 'The selected solar system is undersized',
    body: `${solarResult.worstMonth?.month || 'The worst active month'} has a ${round(energyGap)}% daily energy shortfall. Increase the panel to at least ${Math.ceil(solarResult.requiredPanelWatts)} W, reduce the operating load, or change the active season.`,
  };
  if (!solarResult.reservePass) return {
    title: 'Generation works, but storage is too small',
    body: `The design produces enough daily energy but does not meet the ${state.reserveDays}-day resilience target. Increase nominal storage to about ${Math.ceil(solarResult.requiredBatteryWh).toLocaleString()} Wh.`,
  };
  return {
    title: `${costWinner === 'solar' ? 'Solar' : 'Grid'} has the current lifecycle advantage`,
    body: costWinner === carbonWinner
      ? 'Cost and lifecycle carbon point in the same direction.'
      : 'Cost and lifecycle carbon point in different directions, so the decision requires a policy tradeoff.',
  };
}

async function loadRegistry() {
  try {
    const response = await fetch('./data/ies-registry.json');
    registry = await response.json();
    if (!state.fixtureId) {
      const preferred = registry.records.find((record) =>
        !record.duplicateOf && record.nominalLampW === state.lampWatts && record.distribution === state.distribution,
      );
      state.fixtureId = preferred?.id || registry.records.find((record) => !record.duplicateOf)?.id || '';
    }
  } catch (error) {
    console.error('Unable to load IES registry', error);
  }
}

async function loadSelectedIES() {
  const record = registry.records.find((item) => item.id === state.fixtureId);
  if (!record) {
    selectedIES = null;
    return;
  }
  try {
    const response = await fetch(encodeURI(`./${record.path}`));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    selectedIES = parseIES(await response.text(), record.path);
    state.lampWatts = record.measuredInputW || record.nominalLampW;
    state.distribution = record.distribution;
  } catch (error) {
    selectedIES = null;
    console.error('Unable to load selected IES file', error);
  }
}

function updateCalculations() {
  const layout = buildLinearLayout({
    lengthFt: state.lengthFt,
    widthFt: state.widthFt,
    spacingFt: state.spacingFt,
    mountHeightFt: state.mountingHeightFt,
    layout: state.layout,
    setbackFt: state.setbackFt,
  });
  layout.luminaires.forEach((luminaire) => { luminaire.outputFraction = state.outputPercent / 100; });
  photometricResult = selectedIES
    ? { ...calculateGrid(selectedIES, layout, { lengthFt: state.lengthFt, widthFt: state.widthFt }), layout }
    : { avgFc: 0, minFc: 0, maxFc: 0, layout };

  const accessories = state.accessories.map((item) => ({ ...item }));
  solarResult = sizeSolarSystem({
    activeMonths: state.activeMonths,
    lighting: {
      lampWatts: state.lampWatts,
      lampCount: 1,
      nightHours: state.nightHours,
      schedule: state.schedule,
      eveningPercent: state.eveningPercent,
      eveningHours: state.eveningHours,
      standbyPercent: state.standbyPercent,
      boostPercent: state.boostPercent,
      eventsPerHour: state.eventsPerHour,
      boostMinutes: state.boostMinutes,
    },
    accessories,
    controllerWatts: 1.5,
    loadEfficiency: 0.9,
    panelWatts: state.panelWatts,
    batteryWh: state.batteryWh,
    reserveDays: state.reserveDays,
    maxDepthOfDischarge: 0.8,
    coldBatteryFactor: 0.85,
    endOfLifeCapacity: 0.8,
    monthlyPsh: state.monthlyPsh,
    style: state.solarStyle,
    latitude: state.latitude,
    azimuthDeg: state.azimuthDeg,
    tiltDeg: state.tiltDeg,
    shadeFactor: 1 - state.shadePercent / 100,
    solarEfficiency: 0.78,
    inactiveStandbyWh: 0,
  });
  solarResult.electrical = evaluateElectricalLimits(accessories, state.hardware);
  solarResult.accessoryAllowanceWh = remainingAccessoryAllowance({
    reserveDays: state.reserveDays,
    loadEfficiency: 0.9,
  }, solarResult);
  const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const operatingDays = state.activeMonths.reduce((total, index) => total + monthDays[index], 0);
  const annualLightingKwh = solarResult.adjustedDemandWh * layout.poleCount * operatingDays / 1000;
  economicsResult = compareProjectAlternatives({
    trenchSegments: [{ surface: state.trenchSurface, lengthFt: state.trenchLengthFt }],
    poleCount: layout.poleCount,
    poleInstalledCost: state.poleInstalledCost,
    gridServiceCost: state.gridServiceCost,
    utilityCoordinationCost: state.utilityCoordinationCost,
    trafficControlCost: state.trafficControlCost,
    irrigationRepairCost: state.irrigationRepairCost,
    treeProtectionCost: state.treeProtectionCost,
    gridMobilizationCost: state.gridMobilizationCost,
    solarEquipmentPerPole: state.solarEquipmentPerPole,
    solarInstallPerPole: state.solarInstallPerPole,
    solarMobilizationCost: state.solarMobilizationCost,
    solarSiteRestorationCost: state.solarSiteRestorationCost,
    annualLightingKwh,
    utilityRatePerKwh: state.utilityRatePerKwh,
    monthlyServiceCharge: state.monthlyServiceCharge,
    gridAnnualMaintenance: state.gridAnnualMaintenance,
    solarAnnualMaintenance: state.solarAnnualMaintenance,
    batteryReplacementCost: state.batteryReplacementCost * layout.poleCount,
    batteryLifeYears: state.batteryLifeYears,
    analysisYears: state.analysisYears,
    discountRate: state.discountRatePercent / 100,
    energyEscalation: state.energyEscalationPercent / 100,
  });
  sustainabilityResult = calculateSustainability({
    annualGridKwh: annualLightingKwh,
    analysisYears: state.analysisYears,
    gridKgCo2ePerKwh: state.gridKgCo2ePerKwh,
    gridConstructionKg: economicsResult.trenchConstructionKgCo2e,
    solarEmbodiedKg: state.solarEmbodiedKgPerPole * layout.poleCount,
    batteryReplacementKg: state.batteryReplacementKg * layout.poleCount,
    solarAnnualMaintenanceKg: 12 * layout.poleCount,
    batteryLifeYears: state.batteryLifeYears,
    carbonPricePerMetricTon: state.carbonPricePerMetricTon,
  });
  decisionResult = buildDecisionIntelligence({
    state,
    economics: economicsResult,
    sustainability: sustainabilityResult,
    photometric: photometricResult,
    solar: solarResult,
    registryRecord: registry.records.find((record) => record.id === state.fixtureId),
  });
}

function field(label, id, value, options = {}) {
  return `<label class="field"><span>${esc(label)}</span>
    <input id="${id}" data-field="${id}" type="${options.type || 'number'}"
      value="${esc(value)}" ${options.min != null ? `min="${options.min}"` : ''}
      ${options.max != null ? `max="${options.max}"` : ''} ${options.step ? `step="${options.step}"` : ''}
      ${options.placeholder ? `placeholder="${esc(options.placeholder)}"` : ''}>
    ${options.hint ? `<small>${esc(options.hint)}</small>` : ''}
  </label>`;
}

function selectField(label, id, choices, value, hint = '') {
  return `<label class="field"><span>${esc(label)}</span><select id="${id}" data-field="${id}">
    ${choices.map(([key, text]) => `<option value="${esc(key)}" ${String(key) === String(value) ? 'selected' : ''}>${esc(text)}</option>`).join('')}
  </select>${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
}

function renderStep1() {
  const application = APPLICATIONS[state.application];
  return `<section class="step-panel">
    <div class="section-intro"><span class="eyebrow">01 — PROJECT SIGNAL</span><h2>Frame the site.<br><em>Set the season.</em></h2>
      <p>Give the engine the essential context. It will establish a technically grounded starting point you can refine.</p></div>
    <div class="field-grid two">
      ${field('Project name', 'projectName', state.projectName, { type: 'text', placeholder: 'Downtown trail lighting' })}
      ${field('Site address', 'address', state.address, { type: 'text', placeholder: 'City, state or full address' })}
      ${selectField('Application', 'application', Object.entries(APPLICATIONS).map(([key, item]) => [key, item.label]), state.application)}
      ${field('Latitude', 'latitude', state.latitude, { min: -60, max: 70, step: 0.01, hint: 'Used for seasonal panel optimization.' })}
      ${field('Longitude', 'longitude', state.longitude, { min: -180, max: 180, step: 0.01 })}
      ${field('State code', 'stateCode', state.stateCode, { type: 'text', placeholder: 'NC' })}
      ${field('Project length (ft)', 'lengthFt', state.lengthFt, { min: 10, max: 10000 })}
      ${field('Illuminated width (ft)', 'widthFt', state.widthFt, { min: 4, max: 500 })}
    </div>
    <div class="scene-workspace">
      <div class="scene-toolbar">
        <div><span class="eyebrow">SITE EVIDENCE</span><strong>Mapped pole scene</strong>
          <small>${esc(state.resolvedAddress || 'Enter an address, then locate the project site.')}</small></div>
        <button class="button primary scene-refresh" type="button" id="locateSite">Locate address + load evidence</button>
      </div>
      <div class="scene-shell" aria-label="Satellite site map with calculated pole locations">
        <div id="siteMap" class="site-map"></div>
        <div class="map-legend"><span><i></i>Calculated pole</span><span>${photometricResult?.layout?.poleCount || 0} poles · ${Number(state.spacingFt).toFixed(0)} ft target spacing</span></div>
      </div>
      <div class="api-pills scene-status" aria-label="Connected evidence services">
          <span>${apiStatus.googleMapsBrowser ? 'Google Maps configured' : 'Google Maps not configured'}</span>
          <span>${apiStatus.nrel ? 'NREL configured' : 'NREL not configured'}</span>
          <span>${apiStatus.census ? 'Census configured' : 'Census not configured'}</span>
          <span>${apiStatus.eia ? 'EIA configured' : 'EIA not configured'}</span>
          <span>Open-Meteo available</span>
      </div>
    </div>
    ${Object.keys(state.apiContext || {}).length ? `<div class="notice info"><span class="notice-icon">i</span><div><strong>Location services checked</strong><p>
      ${Object.entries(state.apiContext).map(([key, value]) => `${esc(key)}: ${value.ok ? 'connected' : esc(value.error)}`).join(' · ')}
    </p></div></div>` : ''}
    <div class="field-grid two">
      ${selectField('Installation type', 'siteType', [['pole', 'Standalone pole'], ['shelter', 'Bus shelter']], state.siteType)}
      ${selectField('Initial trench surface', 'trenchSurface', Object.entries(SURFACE_TYPES).map(([key, item]) => [key, item.label]), state.trenchSurface)}
    </div>
    <div class="subsection">
      <div><h3>Operating months</h3><p class="muted">Only active months are used to identify the worst design month.</p></div>
      <div class="month-grid">${MONTHS.map((month, index) => `<label class="month-check ${state.activeMonths.includes(index) ? 'active' : ''}">
        <input type="checkbox" data-month="${index}" ${state.activeMonths.includes(index) ? 'checked' : ''}><span>${month}</span></label>`).join('')}</div>
      <div class="inline-actions"><button class="text-button" data-month-action="all">All year</button><button class="text-button" data-month-action="summer">Apr–Oct</button><button class="text-button" data-month-action="winter">Nov–Mar</button></div>
    </div>
    <div class="notice info"><span class="notice-icon">↗</span><div><strong>Intelligent baseline applied</strong><p>${esc(application.label)}, ${application.avgFc} average FC, ${application.heightFt} ft mounting height and ${application.distribution} distribution.</p></div></div>
  </section>`;
}

function renderStep2() {
  const fixtureOptions = registry.records
    .filter((record) => !record.duplicateOf)
    .map((record) => [record.id, `${record.nominalLampW} W · ${record.distribution}`]);
  const record = registry.records.find((item) => item.id === state.fixtureId);
  return `<section class="step-panel">
    <div class="section-intro"><span class="eyebrow">02 — LIGHTING LOGIC</span><h2>Shape the light.<br><em>Control the pattern.</em></h2>
      <p>Pair measured photometry with real geometry. Pole quantity, spacing, and coverage stay synchronized as the design moves.</p></div>
    <div class="field-grid two">
      ${selectField('Verified photometric package', 'fixtureId', fixtureOptions, state.fixtureId, `${registry.uniqueFiles || fixtureOptions.length} unique laboratory files indexed`)}
      ${selectField('Layout', 'layout', [['one-side', 'One side'], ['both-sides', 'Both sides'], ['centerline', 'Centerline']], state.layout)}
      ${field('Mounting height (ft)', 'mountingHeightFt', state.mountingHeightFt, { min: 10, max: 50 })}
      ${field('Target spacing (ft)', 'spacingFt', state.spacingFt, { min: 10, max: 250 })}
      ${field('Start/end setback (ft)', 'setbackFt', state.setbackFt, { min: 0, max: state.lengthFt / 3 })}
      ${field('Output level (%)', 'outputPercent', state.outputPercent, { min: 1, max: 100 })}
      ${field('Target average FC', 'avgFcTarget', state.avgFcTarget, { min: 0.05, max: 20, step: 0.05 })}
      ${field('Target minimum FC', 'minFcTarget', state.minFcTarget, { min: 0.01, max: 10, step: 0.01 })}
    </div>
    ${record ? `<div class="file-card"><div><span class="badge ${record.status === 'verified' ? 'success' : 'warning'}">${esc(record.status)}</span>
      <h3>${esc(`${record.nominalLampW} W · ${record.distribution}`)}</h3><p>${esc(`${record.cct || 4000} K · ${record.cri || 80} CRI measured photometric package`)}</p></div>
      <dl><div><dt>Measured input</dt><dd>${round(record.measuredInputW)} W</dd></div><div><dt>Distribution</dt><dd>${esc(record.distribution)}</dd></div>
      <div><dt>Test</dt><dd>${esc(record.testId)}</dd></div><div><dt>Laboratory</dt><dd>${esc(record.testLab)}</dd></div></dl></div>` : ''}
    <div class="result-strip">
      <div><span>Poles</span><strong>${photometricResult.layout.poleCount}</strong></div>
      <div><span>Actual spacing</span><strong>${round(photometricResult.layout.actualSpacing)} ft</strong></div>
      <div><span>Average</span><strong>${round(photometricResult.avgFc, 2)} FC</strong></div>
      <div><span>Minimum</span><strong>${round(photometricResult.minFc, 2)} FC</strong></div>
    </div>
    <div class="plain-result ${photometricResult.avgFc >= state.avgFcTarget && photometricResult.minFc >= state.minFcTarget ? 'pass' : 'attention'}">
      <i>${photometricResult.avgFc >= state.avgFcTarget && photometricResult.minFc >= state.minFcTarget ? '✓' : '!'}</i><div><strong>${photometricResult.avgFc >= state.avgFcTarget && photometricResult.minFc >= state.minFcTarget ? 'The lighting target is met' : 'The lighting target needs adjustment'}</strong>
      <p>${photometricResult.avgFc >= state.avgFcTarget && photometricResult.minFc >= state.minFcTarget
        ? `Measured photometry clears both selected targets at ${photometricResult.layout.poleCount} poles.`
        : `The model must reach ${state.avgFcTarget} average and ${state.minFcTarget} minimum FC. Adjust spacing, height, output, wattage, or distribution.`}</p></div>
    </div>
    <div class="visual-grid">
      <article class="visual-card"><div><span class="eyebrow">IES POINT-BY-POINT</span><h3>Photometric coverage</h3></div>
        <canvas id="photometricPlan" width="1050" height="470" aria-label="Point-by-point foot-candle heatmap"></canvas></article>
      <article class="visual-card"><div><span class="eyebrow">INSTALLED FORM</span><h3>Pole side elevation</h3></div>
        <canvas id="sideElevation" width="1050" height="360" aria-label="Pole and lighting side elevation"></canvas></article>
    </div>
  </section>`;
}

function renderAccessories() {
  return state.accessories.length
    ? state.accessories.map((item, index) => `<div class="accessory-row">
        <div><strong>${esc(item.label)}</strong><small>${item.voltage} V · ${item.watts} W continuous · ${item.peakWatts} W peak</small></div>
        ${field('Qty', `accessory-${index}-quantity`, item.quantity, { min: 1, max: 20 })}
        ${field('Hours/day', `accessory-${index}-hours`, item.hours, { min: 0, max: 24, step: 0.5 })}
        <button class="icon-button" data-remove-accessory="${index}" aria-label="Remove ${esc(item.label)}">×</button>
      </div>`).join('')
    : '<p class="empty-state">No auxiliary devices added.</p>';
}

function renderStep3() {
  return `<section class="step-panel">
    <div class="section-intro"><span class="eyebrow">03 — ENERGY SYSTEM</span><h2>Build for the night.<br><em>Prove it by month.</em></h2>
      <p>Balance generation, storage, operating profile, and connected equipment against the hardest active month.</p></div>
    <div class="choice-grid three">${Object.entries(SOLAR_STYLES).map(([key, style]) => `<button type="button" class="choice-card ${state.solarStyle === key ? 'selected' : ''}" data-solar-style="${key}">
      <span class="solar-icon ${key}"></span><strong>${esc(style.label)}</strong><small>${esc(style.description)}</small></button>`).join('')}</div>
    <div class="sizing-guidance"><div><span class="eyebrow">PER POLE / SHELTER</span><strong>${Math.ceil(solarResult.requiredPanelWatts)} W panel</strong><small>Worst active month</small></div><div><strong>${Math.ceil(solarResult.requiredBatteryWh).toLocaleString()} Wh battery</strong><small>${state.reserveDays}-day resilience target</small></div><div class="${solarResult.energyPass && solarResult.reservePass ? 'pass' : 'attention'}"><strong>${solarResult.energyPass && solarResult.reservePass ? 'Selected system passes' : 'Selected system is undersized'}</strong><small>${solarResult.worstMonth?.month || 'Worst month'}: ${round(solarResult.worstMonth?.marginPercent)}% daily margin</small></div></div>
    <div class="field-grid three">
      ${selectField('Solar panel', 'panelWatts', PANEL_SIZES_W.map((value) => [value, `${value} W`]), state.panelWatts)}
      ${selectField('Battery', 'batteryWh', BATTERY_SIZES_WH.map((value) => [value, `${value.toLocaleString()} Wh`]), state.batteryWh)}
      ${field('Required reserve (days)', 'reserveDays', state.reserveDays, { min: 1, max: 7, step: 0.5 })}
      ${field('Panel azimuth (°)', 'azimuthDeg', state.azimuthDeg, { min: 0, max: 360, hint: '180° is true south.' })}
      ${field('Panel tilt (°)', 'tiltDeg', state.tiltDeg, { min: 0, max: 80 })}
      ${field('Estimated shade loss (%)', 'shadePercent', state.shadePercent, { min: 0, max: 80 })}
      ${selectField('Southern exposure', 'clearSouth', [['confirmed', 'Clear south-facing exposure confirmed'], ['partial', 'Partial or seasonal obstruction'], ['unknown', 'Not field-confirmed']], state.clearSouth)}
      ${field('Controller output voltage', 'hardware.outputVoltage', state.hardware.outputVoltage, { min: 5, max: 48 })}
      ${field('Controller continuous output (W)', 'hardware.maxContinuousWatts', state.hardware.maxContinuousWatts, { min: 1, max: 1000 })}
      ${field('Controller peak output (W)', 'hardware.maxPeakWatts', state.hardware.maxPeakWatts, { min: 1, max: 2000 })}
    </div>
    <details class="advanced"><summary>Lighting operating schedule</summary>
      <div class="field-grid three">
        ${selectField('Schedule', 'schedule', [['dusk-to-dawn', 'Dusk to dawn'], ['smart', 'Adaptive smart'], ['motion', 'Motion-biased']], state.schedule)}
        ${field('Longest active night (hours)', 'nightHours', state.nightHours, { min: 6, max: 18, step: 0.1 })}
        ${field('Evening hours', 'eveningHours', state.eveningHours, { min: 0, max: 12, step: 0.5 })}
        ${field('Evening output (%)', 'eveningPercent', state.eveningPercent, { min: 1, max: 100 })}
        ${field('Standby output (%)', 'standbyPercent', state.standbyPercent, { min: 0, max: 100 })}
        ${field('Boost output (%)', 'boostPercent', state.boostPercent, { min: 1, max: 100 })}
        ${field('Events per hour', 'eventsPerHour', state.eventsPerHour, { min: 0, max: 30, step: 0.5 })}
        ${field('Minutes per event', 'boostMinutes', state.boostMinutes, { min: 0, max: 60, step: 0.5 })}
      </div>
    </details>
    <div class="subsection">
      <div class="subsection-heading"><div><h3>Connected equipment</h3><p class="muted">Energy, voltage, continuous power and peak power are checked separately.</p></div>
        <select id="accessoryPreset"><option value="">Add a device…</option>${Object.entries(ACCESSORY_PRESETS).map(([key, item]) => `<option value="${key}">${esc(item.label)}</option>`).join('')}</select></div>
      <div class="accessory-list">${renderAccessories()}</div>
    </div>
  </section>`;
}

function statusClass(pass) { return pass ? 'pass' : 'fail'; }

function renderStep5() {
  const electrical = solarResult.electrical;
  const warnings = [
    !selectedIES && 'An exact IES file is not loaded.',
    photometricResult.avgFc < state.avgFcTarget && 'Average illuminance is below the selected target.',
    photometricResult.minFc < state.minFcTarget && 'Minimum illuminance is below the selected target.',
    !solarResult.energyPass && 'The selected panel does not replace worst-month daily energy use.',
    !solarResult.reservePass && 'The selected battery does not meet the reserve target.',
    state.clearSouth !== 'confirmed' && 'Southern exposure requires field confirmation.',
    ...electrical.warnings,
  ].filter(Boolean);
  return `<section class="step-panel results-page">
    <div class="section-intro"><span class="eyebrow">04 — DESIGN VERDICT</span><h2>${esc(state.projectName || 'System recommendation')}</h2>
      <p>One decision view across photometric performance, seasonal energy balance, storage, and electrical capacity.</p></div>
    <div class="report-hero"><div class="report-hero-top"><span class="eyebrow">COMPLETE PROJECT VERDICT</span><span class="report-id">PLANNING MODEL · ${new Date().toLocaleDateString()}</span></div><h3>${esc(economicsResult.recommendation)}</h3>
      <p>${money(Math.abs(economicsResult.lifecycleSavings))} ${state.analysisYears}-year lifecycle advantage for ${economicsResult.lifecycleSavings >= 0 ? 'solar' : 'grid'} and ${round(Math.abs(sustainabilityResult.avoidedMetricTons))} metric tons CO2e advantage for ${sustainabilityResult.avoidedMetricTons >= 0 ? 'solar' : 'grid'} under current assumptions.</p></div>
    <div class="verdict-explainer"><span class="eyebrow">WHAT THIS MEANS</span><h3>${esc(userFacingVerdict().title)}</h3><p>${esc(userFacingVerdict().body)}</p></div>
    <div class="decision-readiness"><span class="eyebrow">DECISION READINESS</span><strong>${esc(decisionResult.decisionReadiness)}</strong><p>The engine tests the same proposal independently for lighting, worst-month energy, lifecycle cost and lifecycle carbon.</p></div>
    <div class="decision-tests" aria-label="Four independent decision tests">
      ${[
        ['Lighting', decisionResult.tests.lightingPass, 'IES target'],
        ['Energy', decisionResult.tests.solarPass, 'Worst month + reserve'],
        ['Financial', decisionResult.tests.financialPass, `${state.analysisYears}-year lifecycle`],
        ['Carbon', decisionResult.tests.carbonPass, 'Net lifecycle CO2e'],
      ].map(([label, pass, detail]) => `<div class="${pass ? 'pass' : 'fail'}"><i>${pass ? 'PASS' : 'CHALLENGE'}</i><strong>${label}</strong><span>${detail}</span></div>`).join('')}
    </div>
    <div class="score-grid">
      <article class="score-card ${statusClass(photometricResult.avgFc >= state.avgFcTarget && photometricResult.minFc >= state.minFcTarget)}"><span>Lighting</span><strong>${round(photometricResult.avgFc, 2)} / ${round(photometricResult.minFc, 2)} FC</strong><small>Average / minimum</small></article>
      <article class="score-card ${statusClass(solarResult.energyPass)}"><span>Worst month</span><strong>${esc(solarResult.worstMonth?.month || '—')}</strong><small>${round(solarResult.worstMonth?.marginPercent)}% daily margin</small></article>
      <article class="score-card ${statusClass(solarResult.reservePass)}"><span>Battery reserve</span><strong>${round(solarResult.reserveDays)} days</strong><small>${round(solarResult.usableBatteryWh)} usable Wh</small></article>
      <article class="score-card ${statusClass(electrical.safe)}"><span>Accessories</span><strong>${round(solarResult.accessoryWh)} Wh/day</strong><small>${round(solarResult.accessoryAllowanceWh)} Wh/day recommended allowance</small></article>
    </div>
    <div class="results-columns">
      <article class="result-card"><h3>Financial case</h3><table class="report-table">
        <tr><th>Complete grid capital</th><td>${money(economicsResult.gridCapital)}</td></tr>
        <tr><th>Complete solar capital</th><td>${money(economicsResult.solarCapital)}</td></tr>
        <tr><th>Trenching + restoration</th><td>${money(economicsResult.trenchAndRestorationCost)}</td></tr>
        <tr><th>Landscape restoration</th><td>${money(economicsResult.landscapeRestorationCost)}</td></tr>
        <tr><th>Grid lifecycle</th><td>${money(economicsResult.gridLifecycle)}</td></tr>
        <tr><th>Solar lifecycle</th><td>${money(economicsResult.solarLifecycle)}</td></tr>
      </table></article>
      <article class="result-card"><h3>GHG and carbon case</h3><table class="report-table">
        <tr><th>Grid baseline</th><td>${round(sustainabilityResult.gridTotalKg / 1000)} t CO2e</td></tr>
        <tr><th>Solar alternative</th><td>${round(sustainabilityResult.solarTotalKg / 1000)} t CO2e</td></tr>
        <tr><th>Net difference (solar vs grid)</th><td>${round(sustainabilityResult.avoidedMetricTons)} t CO2e</td></tr>
        <tr><th>Change from grid baseline</th><td>${round(sustainabilityResult.reductionPercent)}%</td></tr>
        <tr><th>Value of net difference</th><td>${money(sustainabilityResult.carbonValue)}</td></tr>
        <tr><th>Battery replacements</th><td>${sustainabilityResult.replacements}</td></tr>
      </table><p class="muted">Avoided emissions are reported separately from any purchased, verified carbon offsets.</p></article>
    </div>
    <div class="results-columns">
      <article class="result-card"><h3>Selected configuration</h3><dl>
        <div><dt>Photometric package</dt><dd>${esc((() => { const item = registry.records.find((record) => record.id === state.fixtureId); return item ? `${item.nominalLampW} W · ${item.distribution}` : 'Not selected'; })())}</dd></div>
        <div><dt>Lamp load</dt><dd>${round(state.lampWatts)} W × ${photometricResult.layout.poleCount}</dd></div>
        <div><dt>Distribution</dt><dd>${esc(state.distribution)}</dd></div>
        <div><dt>Panel style</dt><dd>${esc(SOLAR_STYLES[state.solarStyle].label)}</dd></div>
        <div><dt>Panel / battery per unit</dt><dd>${state.panelWatts} W / ${state.batteryWh.toLocaleString()} Wh</dd></div>
        <div><dt>Required panel per unit</dt><dd>${Math.ceil(solarResult.requiredPanelWatts)} W minimum model estimate</dd></div>
        <div><dt>Required battery per unit</dt><dd>${Math.ceil(solarResult.requiredBatteryWh).toLocaleString()} Wh nominal model estimate</dd></div>
      </dl></article>
      <article class="result-card"><h3>Monthly energy balance</h3><div class="month-chart">
        ${solarResult.months.map((month) => {
          const max = Math.max(...solarResult.months.map((item) => Math.max(item.productionWh, item.demandWh)), 1);
          return `<div class="month-bar ${month.active ? '' : 'inactive'}"><span>${month.month}</span><div class="bar-track">
            <i class="bar production" style="height:${Math.max(2, month.productionWh / max * 100)}%"></i>
            <i class="bar demand" style="height:${Math.max(2, month.demandWh / max * 100)}%"></i></div></div>`;
        }).join('')}
      </div><div class="legend"><span><i class="production"></i>Solar production</span><span><i class="demand"></i>Energy demand</span></div></article>
    </div>
    <div class="results-columns">
      <article class="result-card"><h3>Civil-cost sensitivity</h3><p class="muted">Lifecycle result when trenching and restoration unit costs move ±30%.</p>
        <div class="sensitivity-chart">${decisionResult.sensitivity.map((scenario) => {
          const extent = Math.max(...decisionResult.sensitivity.map((item) => Math.abs(item.savings)), 1);
          const width = Math.abs(scenario.savings) / extent * 50;
          return `<div class="sensitivity-row"><span>${esc(scenario.label)}</span><div class="sensitivity-track"><i class="${scenario.savings >= 0 ? 'solar' : 'grid'}" style="width:${width}%"></i></div><strong>${scenario.savings >= 0 ? 'Solar +' : 'Grid +'}${money(Math.abs(scenario.savings))}</strong></div>`;
        }).join('')}</div>
        <p class="truth-callout">${decisionResult.breakEvenAdditionalGridCost > 0
          ? `Solar reaches lifecycle break-even if additional verified grid/civil costs exceed ${money(decisionResult.breakEvenAdditionalGridCost)}.`
          : 'Solar is already at or beyond lifecycle break-even in the planning case.'}</p>
      </article>
      <article class="result-card"><h3>Community context</h3>${renderCommunityContext()}</article>
    </div>
    <article class="result-card evidence-card"><div class="evidence-heading"><div><span class="eyebrow">TRUTH LEDGER</span><h3>Evidence, assumptions and confidence</h3></div><p>Every major claim carries its data class and source.</p></div>
      <div class="table-wrap"><table class="report-table evidence-table"><thead><tr><th>Topic</th><th>Classification</th><th>Current value</th><th>Source</th><th>Confidence</th></tr></thead><tbody>
        ${decisionResult.evidence.map((item) => `<tr><td><strong>${esc(item.topic)}</strong></td><td>${esc(item.classification)}</td><td>${esc(item.value)}</td><td>${esc(item.source)}</td><td><span class="confidence ${item.confidence.toLowerCase()}">${esc(item.confidence)}</span></td></tr>`).join('')}
      </tbody></table></div>
    </article>
    <article class="result-card framework-card"><span class="eyebrow">FRAMEWORK SCREENING</span><h3>Potential sustainability alignment</h3>
      <div class="framework-grid">${LEED_PATHWAYS.map((item) => `<div><i aria-hidden="true">+</i><span>${esc(item)}</span></div>`).join('')}</div>
      <p class="muted">These are potential contribution pathways for project-team review—not promised LEED points, certification, carbon offsets or regulatory approval.</p>
    </article>
    ${decisionResult.challenges.length ? `<div class="challenge-panel"><span class="eyebrow">WHAT THE MODEL WILL NOT HIDE</span><h3>Material challenges</h3><ul>${decisionResult.challenges.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>` : ''}
    <div class="notice ${warnings.length ? 'warning' : 'success'}"><strong>${warnings.length ? 'Review required' : 'Planning checks passed'}</strong>
      ${warnings.length ? `<ul>${warnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}</ul>` : '<p>The configured model meets the selected planning targets. Final hardware limits and field conditions still require manufacturer and engineering confirmation.</p>'}</div>
    <div class="disclaimer"><strong>Decision-support model—not stamped engineering.</strong> Final product compatibility, structural design, electrical protection, battery temperature limits, and regulatory compliance must be confirmed by the responsible manufacturer and design professional.</div>
  </section>`;
}

function renderCommunityContext() {
  const census = state.apiContext?.census?.data;
  if (!census) return '<p class="muted">Refresh location data to attach tract-level ACS estimates and margins of error. Community characteristics inform context; they do not determine lighting or safety requirements.</p>';
  const metric = (label, item) => `<div><dt>${esc(label)}</dt><dd>${Number(item?.estimate || 0).toLocaleString()}<small> ±${Number(item?.marginOfError || 0).toLocaleString()} MOE</small></dd></div>`;
  return `<p>${esc(census.geographyName || `Census tract ${census.geography?.tract || ''}`)}</p><dl class="community-metrics">
    ${metric('Population', census.population)}
    ${metric('Households without a vehicle', census.zeroVehicleHouseholds)}
    ${metric('Workers using public transit', census.publicTransitWorkers)}
    ${metric('People below poverty level', census.belowPoverty)}
  </dl><p class="muted">${esc(census.note || 'ACS estimates include margins of error.')}</p>`;
}

const money = (value) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
}).format(value || 0);

function renderStep4() {
  return `<section class="step-panel">
    <div class="section-intro"><span class="eyebrow">04 — COMPLETE PROJECT COMPARISON</span><h2>Compare the whole job.<br><em>Not just the fixture.</em></h2>
      <p>Model poles, service, trenching, surface and landscape restoration, operations, replacements and lifecycle carbon on equal lighting performance.</p></div>
    <details class="assumption-panel"><summary><span><strong>Cost and lifecycle assumptions</strong><small>Review or replace the planning allowances</small></span><i>Edit ${17} inputs</i></summary><div class="field-grid three">
      ${field('Trench route (ft)', 'trenchLengthFt', state.trenchLengthFt, { min: 0, max: 50000 })}
      ${selectField('Primary surface', 'trenchSurface', Object.entries(SURFACE_TYPES).map(([key, item]) => [key, item.label]), state.trenchSurface)}
      ${field('Installed pole + foundation ($/pole)', 'poleInstalledCost', state.poleInstalledCost, { min: 0 })}
      ${field('Utility service ($)', 'gridServiceCost', state.gridServiceCost, { min: 0 })}
      ${field('Utility coordination ($)', 'utilityCoordinationCost', state.utilityCoordinationCost, { min: 0 })}
      ${field('Traffic / pedestrian control ($)', 'trafficControlCost', state.trafficControlCost, { min: 0 })}
      ${field('Irrigation repair ($)', 'irrigationRepairCost', state.irrigationRepairCost, { min: 0 })}
      ${field('Tree/root protection ($)', 'treeProtectionCost', state.treeProtectionCost, { min: 0 })}
      ${field('Grid mobilization ($)', 'gridMobilizationCost', state.gridMobilizationCost, { min: 0 })}
      ${field('Solar equipment ($/pole)', 'solarEquipmentPerPole', state.solarEquipmentPerPole, { min: 0 })}
      ${field('Solar installation ($/pole)', 'solarInstallPerPole', state.solarInstallPerPole, { min: 0 })}
      ${field('Battery life (years)', 'batteryLifeYears', state.batteryLifeYears, { min: 1, max: 30 })}
      ${field('Analysis period (years)', 'analysisYears', state.analysisYears, { min: 1, max: 40 })}
      ${field('Utility energy ($/kWh)', 'utilityRatePerKwh', state.utilityRatePerKwh, { min: 0, step: 0.01 })}
      ${field('Monthly service charge ($)', 'monthlyServiceCharge', state.monthlyServiceCharge, { min: 0 })}
      ${field('Grid emissions (kg CO2e/kWh)', 'gridKgCo2ePerKwh', state.gridKgCo2ePerKwh, { min: 0, step: 0.01 })}
      ${field('Carbon value ($/metric ton)', 'carbonPricePerMetricTon', state.carbonPricePerMetricTon, { min: 0 })}
    </div></details>
    <div class="comparison-grid subsection">
      <article class="alternative-card ${economicsResult.lifecycleSavings < 0 ? 'recommended' : ''}"><span class="eyebrow">GRID + TRENCHING</span><h3 class="money">${money(economicsResult.gridCapital)}</h3><p>Complete capital estimate</p>
        <strong>${money(economicsResult.gridLifecycle)}</strong><p>${state.analysisYears}-year lifecycle estimate</p>
        <small>${economicsResult.trenchLengthFt.toLocaleString()} ft disturbed; ${money(economicsResult.landscapeRestorationCost)} landscape restoration.</small></article>
      <article class="alternative-card ${economicsResult.lifecycleSavings >= 0 ? 'recommended' : ''}"><span class="eyebrow">PROVIDER-NEUTRAL SOLAR</span><h3 class="money">${money(economicsResult.solarCapital)}</h3><p>Complete capital estimate</p>
        <strong>${money(economicsResult.solarLifecycle)}</strong><p>${state.analysisYears}-year lifecycle estimate</p>
        <small>Minimum modeled requirement: ${Math.ceil(solarResult.requiredPanelWatts)} W panel and ${Math.ceil(solarResult.requiredBatteryWh).toLocaleString()} Wh nominal battery.</small></article>
    </div>
    <div class="notice info"><span class="notice-icon">i</span><div><strong>${esc(economicsResult.recommendation)}</strong><p>Replace planning unit costs with local bids, utility requirements and measured route quantities before issue.</p></div></div>
  </section>`;
}

const renderers = [null, renderStep1, renderStep2, renderStep3, renderStep4, renderStep5];

function render() {
  updateCalculations();
  const guide = stepGuidance();
  const workflow = getWorkflowState();
  document.querySelector('#stepContent').innerHTML = `<div class="workflow-banner"><div class="workflow-number">${String(state.step).padStart(2, '0')}</div><div><span class="eyebrow">CURRENT OBJECTIVE</span><strong>${esc(guide.title)}</strong><p>${esc(guide.body)}</p></div></div>${renderers[state.step]()}`;
  document.querySelectorAll('.step-tab').forEach((button) => {
    const index = Number(button.dataset.stepTarget) - 1;
    const active = index + 1 === state.step;
    button.classList.toggle('active', active);
    button.classList.toggle('complete', workflow.steps[index]);
    button.classList.toggle('attention', !workflow.steps[index] && index < state.step);
    button.setAttribute('aria-current', active ? 'step' : 'false');
    button.innerHTML = `<span>${workflow.steps[index] ? '✓' : index + 1}</span><b>${esc(STEP_LABELS[index])}</b><small>${workflow.steps[index] ? 'Complete' : active ? 'In progress' : 'Review'}</small>`;
  });
  document.querySelector('#backButton').hidden = state.step === 1;
  document.querySelector('#nextButton').textContent = state.step === 5 ? 'Print report' : 'Continue';
  renderSummary();
  renderProjectContext();
  wireStep();
  initializeVisuals();
  saveState();
}

function renderProjectContext() {
  const workflow = getWorkflowState();
  document.querySelector('#projectContextName').textContent = state.projectName || 'Untitled lighting project';
  document.querySelector('#projectContextLocation').textContent = state.resolvedAddress || state.address || 'Location not confirmed';
  const status = document.querySelector('#projectContextStatus');
  status.textContent = workflow.decisionReady ? 'Decision ready' : `${workflow.completeCount}/4 workstreams complete`;
  status.className = `context-status ${workflow.decisionReady ? 'ready' : ''}`;
}

function initializeVisuals() {
  const siteMap = document.querySelector('#siteMap');
  if (siteMap) renderSiteMap(siteMap, state, photometricResult.layout);
  drawPhotometricPlan(document.querySelector('#photometricPlan'), state, photometricResult);
  drawSideElevation(document.querySelector('#sideElevation'), state, photometricResult);
}

function renderSummary() {
  const record = registry.records.find((item) => item.id === state.fixtureId);
  document.querySelector('#summaryProduct').textContent = record
    ? `${record.nominalLampW} W ${record.distribution} lighting package`
    : 'Select an IES lighting package';
  const verdict = userFacingVerdict();
  const workflow = getWorkflowState();
  document.querySelector('#summaryMetrics').innerHTML = [
    ['Poles', photometricResult.layout.poleCount],
    ['Actual spacing', `${round(photometricResult.layout.actualSpacing)} ft`],
    ['Light level (avg / min)', `${round(photometricResult.avgFc, 2)} / ${round(photometricResult.minFc, 2)} FC`],
    ['Panel / battery per unit', `${state.panelWatts} W / ${state.batteryWh.toLocaleString()} Wh`],
    ['Worst active month', solarResult.worstMonth?.month || '—'],
    ['Battery resilience', `${round(solarResult.reserveDays)} days`],
    ['Lifecycle result', economicsResult.recommendation],
    ['Carbon result', `${sustainabilityResult.avoidedMetricTons >= 0 ? 'Solar avoids' : 'Grid avoids'} ${round(Math.abs(sustainabilityResult.avoidedMetricTons))} t CO2e`],
  ].map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
  const pass = selectedIES && solarResult.energyPass && solarResult.reservePass
    && photometricResult.avgFc >= state.avgFcTarget && photometricResult.minFc >= state.minFcTarget
    && solarResult.electrical.safe;
  const badge = document.querySelector('#confidenceBadge');
  badge.className = `badge ${pass ? 'success' : 'estimate'}`;
  badge.textContent = pass ? 'Model checks passed' : 'Design in progress';
  document.querySelector('#summaryStatus').innerHTML = `<div class="summary-progress"><span><b>${workflow.completeCount}</b> of 4 workstreams complete</span><i><b style="width:${workflow.completeCount / 4 * 100}%"></b></i></div>
    <div class="summary-callout ${pass ? 'success' : 'warning'}"><strong>${esc(verdict.title)}</strong><span>${esc(verdict.body)}</span></div>
    <div class="source-key"><span><i class="verified"></i>Measured</span><span><i class="live"></i>Live source</span><span><i class="assumed"></i>Assumption</span></div>`;
}

function applyApplicationDefaults(key) {
  const item = APPLICATIONS[key];
  state.application = key;
  state.avgFcTarget = item.avgFc;
  state.minFcTarget = item.minFc;
  state.mountingHeightFt = item.heightFt;
  state.distribution = item.distribution;
  state.widthFt = item.widthFt;
  const match = registry.records.find((record) => !record.duplicateOf && record.distribution === item.distribution && record.nominalLampW === state.lampWatts)
    || registry.records.find((record) => !record.duplicateOf && record.distribution === item.distribution);
  if (match) state.fixtureId = match.id;
}

async function updateField(path, rawValue, element) {
  const parts = path.split('.');
  const numeric = element?.type === 'number' || ['panelWatts', 'batteryWh'].includes(path);
  const value = numeric ? number(rawValue) : rawValue;
  if (parts.length === 2) state[parts[0]][parts[1]] = value;
  else state[path] = value;
  if (path === 'application') applyApplicationDefaults(value);
  if (path === 'fixtureId') await loadSelectedIES();
  render();
}

function wireStep() {
  document.querySelectorAll('[data-field]:not([data-field^="accessory-"])').forEach((element) => {
    element.addEventListener('change', () => updateField(element.dataset.field, element.value, element));
  });
  document.querySelectorAll('[data-month]').forEach((element) => {
    element.addEventListener('change', () => {
      const index = Number(element.dataset.month);
      state.activeMonths = element.checked
        ? [...new Set([...state.activeMonths, index])].sort((a, b) => a - b)
        : state.activeMonths.filter((value) => value !== index);
      if (!state.activeMonths.length) state.activeMonths = [index];
      render();
    });
  });
  document.querySelectorAll('[data-month-action]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeMonths = button.dataset.monthAction === 'all'
        ? MONTHS.map((_, index) => index)
        : button.dataset.monthAction === 'summer' ? [3, 4, 5, 6, 7, 8, 9] : [10, 11, 0, 1, 2];
      render();
    });
  });
  document.querySelectorAll('[data-solar-style]').forEach((button) => {
    button.addEventListener('click', () => { state.solarStyle = button.dataset.solarStyle; render(); });
  });
  const accessorySelect = document.querySelector('#accessoryPreset');
  if (accessorySelect) accessorySelect.addEventListener('change', () => {
    const preset = ACCESSORY_PRESETS[accessorySelect.value];
    if (preset) state.accessories.push({ ...preset, quantity: 1 });
    render();
  });
  document.querySelectorAll('[data-remove-accessory]').forEach((button) => {
    button.addEventListener('click', () => { state.accessories.splice(Number(button.dataset.removeAccessory), 1); render(); });
  });
  state.accessories.forEach((_, index) => {
    ['quantity', 'hours'].forEach((key) => {
      const element = document.querySelector(`[data-field="accessory-${index}-${key}"]`);
      if (element) element.addEventListener('change', () => {
        state.accessories[index][key] = number(element.value);
        render();
      });
    });
  });
  const locateSite = document.querySelector('#locateSite');
  if (locateSite) locateSite.addEventListener('click', async () => {
    locateSite.disabled = true;
    locateSite.textContent = 'Locating site...';
    const addressInput = document.querySelector('[data-field="address"]');
    if (addressInput) state.address = addressInput.value.trim();
    try {
      if (state.address) {
        const location = await resolveAddress(state.address);
        state.latitude = location.latitude;
        state.longitude = location.longitude;
        if (location.stateCode) state.stateCode = location.stateCode;
        state.resolvedAddress = location.formattedAddress;
        state.apiContext = { location: { ok: true, data: location } };
      }
      locateSite.textContent = 'Loading site evidence...';
      const evidence = await getLocationContext({
        latitude: state.latitude, longitude: state.longitude, stateCode: state.stateCode,
      });
      state.apiContext = { ...(state.apiContext || {}), ...evidence };
      showToast('Location confirmed and site evidence refreshed.', 'success');
    } catch (error) {
      state.apiContext = { ...(state.apiContext || {}), location: { ok: false, error: error.message } };
      showToast(`Location evidence could not be completed: ${error.message}`, 'warning');
    }
    const monthly = state.apiContext.solar?.data?.monthly;
    if (monthly) {
      const keys = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const values = keys.map((key) => Number(monthly[key]));
      if (values.every(Number.isFinite)) state.monthlyPsh = values;
    }
    const rate = Number(state.apiContext.electricity?.data?.record?.price);
    if (Number.isFinite(rate)) state.utilityRatePerKwh = rate / 100;
    render();
  });
}

document.querySelectorAll('.step-tab').forEach((button) => {
  button.addEventListener('click', () => { state.step = Number(button.dataset.stepTarget); render(); });
});
document.querySelector('#backButton').addEventListener('click', () => { state.step = Math.max(1, state.step - 1); render(); });
document.querySelector('#nextButton').addEventListener('click', () => {
  if (state.step === 5) window.print();
  else {
    const workflow = getWorkflowState();
    if (!workflow.steps[state.step - 1] && state.step <= 2) {
      showToast(state.step === 1
        ? 'You can continue, but confirm the project name and location for a defensible report.'
        : 'You can continue, but the lighting design has not cleared its selected targets.', 'warning');
    }
    state.step = Math.min(5, state.step + 1);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});
document.querySelector('#viewDecisionBrief').addEventListener('click', () => {
  state.step = 5;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
document.querySelector('#resetProject').addEventListener('click', () => {
  if (!window.confirm('Start a new project and clear the saved design?')) return;
  Object.assign(state, initialState());
  render();
});

await loadRegistry();
await loadSelectedIES();
try { apiStatus = await getApiStatus(); } catch { apiStatus = {}; }
render();
