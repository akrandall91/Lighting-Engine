const money = (value) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
}).format(Number(value) || 0);
const number = (value, digits = 1) => Number(value || 0).toFixed(digits);

export function buildDecisionIntelligence({ state, economics, sustainability, photometric, solar, registryRecord }) {
  const sensitiveCost = economics.trenchAndRestorationCost;
  const sensitivity = [
    { label: 'Low civil cost', multiplier: 0.7 },
    { label: 'Planning case', multiplier: 1 },
    { label: 'High civil cost', multiplier: 1.3 },
  ].map((scenario) => ({
    ...scenario,
    gridLifecycle: economics.gridLifecycle + sensitiveCost * (scenario.multiplier - 1),
    savings: economics.lifecycleSavings + sensitiveCost * (scenario.multiplier - 1),
  }));
  const breakEvenAdditionalGridCost = Math.max(0, -economics.lifecycleSavings);
  const lightingPass = photometric.avgFc >= state.avgFcTarget && photometric.minFc >= state.minFcTarget;
  const solarPass = solar.energyPass && solar.reservePass;
  const carbonPass = sustainability.avoidedKg > 0;
  const financialPass = economics.lifecycleSavings > 0;
  const decision = [lightingPass, solarPass, financialPass, carbonPass].filter(Boolean).length;

  const census = state.apiContext?.census?.data;
  const solarSource = state.apiContext?.solar?.data?.source || 'Monthly planning defaults';
  const electricitySource = state.apiContext?.electricity?.data?.source || 'User-entered utility rate';
  const evidence = [
    {
      topic: 'Photometric performance', classification: registryRecord ? 'Measured' : 'Missing',
      value: registryRecord ? `${registryRecord.testId || 'Lab file'} · ${registryRecord.testLab || 'laboratory'}` : 'No IES loaded',
      source: registryRecord?.path || '—', confidence: registryRecord ? 'High' : 'Low',
    },
    {
      topic: 'Solar resource', classification: state.apiContext?.solar?.ok ? 'Sourced' : 'Assumed',
      value: `${number(solar.worstMonth?.psh)} peak-sun-hours in ${solar.worstMonth?.month || 'design month'}`,
      source: solarSource, confidence: state.apiContext?.solar?.ok ? 'Moderate' : 'Low',
    },
    {
      topic: 'Electricity price', classification: state.apiContext?.electricity?.ok ? 'Sourced' : 'Assumed',
      value: `$${Number(state.utilityRatePerKwh || 0).toFixed(3)}/kWh`, source: electricitySource,
      confidence: state.apiContext?.electricity?.ok ? 'Moderate' : 'Low',
    },
    {
      topic: 'Civil construction cost', classification: 'User-editable estimate',
      value: `${money(economics.trenchAndRestorationCost)} for ${economics.trenchLengthFt.toLocaleString()} ft`,
      source: 'AKRD planning unit-cost assembly', confidence: 'Planning',
    },
    {
      topic: 'Community context', classification: census ? 'Sourced estimate' : 'Unavailable',
      value: census ? `${census.population?.estimate?.toLocaleString()} people in Census tract` : 'Refresh location data',
      source: census?.source || 'U.S. Census ACS 5-year', confidence: census ? 'Moderate' : 'Low',
    },
    {
      topic: 'Lifecycle carbon', classification: 'Modeled',
      value: `${number(Math.abs(sustainability.avoidedMetricTons))} metric tons CO2e ${sustainability.avoidedMetricTons >= 0 ? 'solar advantage' : 'grid advantage'}`,
      source: 'Energy, construction and embodied-carbon assumptions shown in report', confidence: 'Planning',
    },
  ];

  const challenges = [
    !lightingPass && 'The current pole/fixture layout does not meet the selected average and minimum FC targets.',
    !solarPass && `The selected energy system fails ${!solar.energyPass ? 'worst-month energy recovery' : 'battery reserve'} requirements.`,
    !financialPass && `Solar requires ${money(breakEvenAdditionalGridCost)} more avoided grid/civil cost to reach lifecycle break-even.`,
    !carbonPass && 'The modeled solar alternative has higher lifecycle emissions than the grid baseline under current assumptions.',
    state.clearSouth !== 'confirmed' && 'South-facing solar exposure is not field-confirmed.',
  ].filter(Boolean);

  return {
    sensitivity,
    evidence,
    challenges,
    breakEvenAdditionalGridCost,
    decisionReadiness: decision === 4 ? 'Case supported across all four tests'
      : decision >= 3 ? 'Promising case with one material challenge'
        : decision >= 2 ? 'Mixed case—refinement required' : 'Current case does not support recommendation',
    tests: { lightingPass, solarPass, financialPass, carbonPass },
  };
}
