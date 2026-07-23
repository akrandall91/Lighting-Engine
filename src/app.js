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

const STORAGE_KEY = 'akrd-lighting-engine-v3';
const state = loadState();
let registry = { records: [] };
let selectedIES = null;
let photometricResult = null;
let solarResult = null;

function initialState() {
  return {
    step: 1,
    projectName: '',
    address: '',
    application: 'pathway',
    latitude: 35,
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
      lampCount: layout.poleCount,
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
      ${field('Project length (ft)', 'lengthFt', state.lengthFt, { min: 10, max: 10000 })}
      ${field('Illuminated width (ft)', 'widthFt', state.widthFt, { min: 4, max: 500 })}
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
    .map((record) => [record.id, `${record.family} · ${record.nominalLampW} W · ${record.distribution} · ${record.testId || 'unverified'}`]);
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
      <h3>${esc(`${record.family} ${record.nominalLampW} W ${record.distribution}`)}</h3><p>${esc(`${record.cct || 4000} K · ${record.cri || 80} CRI measured photometric package`)}</p></div>
      <dl><div><dt>Measured input</dt><dd>${round(record.measuredInputW)} W</dd></div><div><dt>Distribution</dt><dd>${esc(record.distribution)}</dd></div>
      <div><dt>Test</dt><dd>${esc(record.testId)}</dd></div><div><dt>Laboratory</dt><dd>${esc(record.testLab)}</dd></div></dl></div>` : ''}
    <div class="result-strip">
      <div><span>Poles</span><strong>${photometricResult.layout.poleCount}</strong></div>
      <div><span>Actual spacing</span><strong>${round(photometricResult.layout.actualSpacing)} ft</strong></div>
      <div><span>Average</span><strong>${round(photometricResult.avgFc, 2)} FC</strong></div>
      <div><span>Minimum</span><strong>${round(photometricResult.minFc, 2)} FC</strong></div>
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

function renderStep4() {
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
    <div class="score-grid">
      <article class="score-card ${statusClass(photometricResult.avgFc >= state.avgFcTarget && photometricResult.minFc >= state.minFcTarget)}"><span>Lighting</span><strong>${round(photometricResult.avgFc, 2)} / ${round(photometricResult.minFc, 2)} FC</strong><small>Average / minimum</small></article>
      <article class="score-card ${statusClass(solarResult.energyPass)}"><span>Worst month</span><strong>${esc(solarResult.worstMonth?.month || '—')}</strong><small>${round(solarResult.worstMonth?.marginPercent)}% daily margin</small></article>
      <article class="score-card ${statusClass(solarResult.reservePass)}"><span>Battery reserve</span><strong>${round(solarResult.reserveDays)} days</strong><small>${round(solarResult.usableBatteryWh)} usable Wh</small></article>
      <article class="score-card ${statusClass(electrical.safe)}"><span>Accessories</span><strong>${round(solarResult.accessoryWh)} Wh/day</strong><small>${round(solarResult.accessoryAllowanceWh)} Wh/day recommended allowance</small></article>
    </div>
    <div class="results-columns">
      <article class="result-card"><h3>Selected configuration</h3><dl>
        <div><dt>Photometric package</dt><dd>${esc((() => { const item = registry.records.find((record) => record.id === state.fixtureId); return item ? `${item.family} ${item.nominalLampW} W ${item.distribution}` : 'Not selected'; })())}</dd></div>
        <div><dt>Lamp load</dt><dd>${round(state.lampWatts)} W × ${photometricResult.layout.poleCount}</dd></div>
        <div><dt>Distribution</dt><dd>${esc(state.distribution)}</dd></div>
        <div><dt>Panel style</dt><dd>${esc(SOLAR_STYLES[state.solarStyle].label)}</dd></div>
        <div><dt>Panel / battery</dt><dd>${state.panelWatts} W / ${state.batteryWh.toLocaleString()} Wh</dd></div>
        <div><dt>Required panel</dt><dd>${Math.ceil(solarResult.requiredPanelWatts)} W minimum model estimate</dd></div>
        <div><dt>Required battery</dt><dd>${Math.ceil(solarResult.requiredBatteryWh).toLocaleString()} Wh nominal model estimate</dd></div>
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
    <div class="notice ${warnings.length ? 'warning' : 'success'}"><strong>${warnings.length ? 'Review required' : 'Planning checks passed'}</strong>
      ${warnings.length ? `<ul>${warnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}</ul>` : '<p>The configured model meets the selected planning targets. Final hardware limits and field conditions still require manufacturer and engineering confirmation.</p>'}</div>
    <div class="disclaimer"><strong>Decision-support model—not stamped engineering.</strong> Final product compatibility, structural design, electrical protection, battery temperature limits, and regulatory compliance must be confirmed by the responsible manufacturer and design professional.</div>
  </section>`;
}

const renderers = [null, renderStep1, renderStep2, renderStep3, renderStep4];

function render() {
  updateCalculations();
  document.querySelector('#stepContent').innerHTML = renderers[state.step]();
  document.querySelectorAll('.step-tab').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.stepTarget) === state.step);
    button.classList.toggle('complete', Number(button.dataset.stepTarget) < state.step);
  });
  document.querySelector('#backButton').hidden = state.step === 1;
  document.querySelector('#nextButton').textContent = state.step === 4 ? 'Print summary' : 'Continue';
  renderSummary();
  wireStep();
  saveState();
}

function renderSummary() {
  const record = registry.records.find((item) => item.id === state.fixtureId);
  document.querySelector('#summaryProduct').textContent = record
    ? `${record.nominalLampW} W ${record.distribution} lighting package`
    : 'Select an IES lighting package';
  document.querySelector('#summaryMetrics').innerHTML = [
    ['Poles', photometricResult.layout.poleCount],
    ['Actual spacing', `${round(photometricResult.layout.actualSpacing)} ft`],
    ['Avg / min FC', `${round(photometricResult.avgFc, 2)} / ${round(photometricResult.minFc, 2)}`],
    ['Panel / battery', `${state.panelWatts} W / ${state.batteryWh.toLocaleString()} Wh`],
    ['Worst active month', solarResult.worstMonth?.month || '—'],
    ['Reserve', `${round(solarResult.reserveDays)} days`],
    ['Accessory allowance', `${round(solarResult.accessoryAllowanceWh)} Wh/day`],
  ].map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
  const pass = selectedIES && solarResult.energyPass && solarResult.reservePass
    && photometricResult.avgFc >= state.avgFcTarget && photometricResult.minFc >= state.minFcTarget
    && solarResult.electrical.safe;
  const badge = document.querySelector('#confidenceBadge');
  badge.className = `badge ${pass ? 'success' : 'estimate'}`;
  badge.textContent = pass ? 'Model checks passed' : 'Design in progress';
  document.querySelector('#summaryStatus').innerHTML = `<div class="summary-callout ${pass ? 'success' : 'warning'}">
    <strong>${pass ? 'Ready for technical review' : 'Design needs attention'}</strong>
    <span>${pass ? 'The configuration clears current model targets.' : 'Continue tuning the highlighted checks.'}</span></div>`;
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
}

document.querySelectorAll('.step-tab').forEach((button) => {
  button.addEventListener('click', () => { state.step = Number(button.dataset.stepTarget); render(); });
});
document.querySelector('#backButton').addEventListener('click', () => { state.step = Math.max(1, state.step - 1); render(); });
document.querySelector('#nextButton').addEventListener('click', () => {
  if (state.step === 4) window.print();
  else { state.step = Math.min(4, state.step + 1); render(); }
});
document.querySelector('#resetProject').addEventListener('click', () => {
  if (!window.confirm('Start a new project and clear the saved design?')) return;
  Object.assign(state, initialState());
  render();
});

await loadRegistry();
await loadSelectedIES();
render();
