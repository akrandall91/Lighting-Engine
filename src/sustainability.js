export function calculateSustainability(input) {
  const gridOperationalKg = input.annualGridKwh * input.analysisYears * input.gridKgCo2ePerKwh;
  const gridTotalKg = gridOperationalKg + input.gridConstructionKg;
  const replacements = Math.floor((input.analysisYears - 1) / input.batteryLifeYears);
  const solarTotalKg = input.solarEmbodiedKg + replacements * input.batteryReplacementKg
    + input.solarAnnualMaintenanceKg * input.analysisYears;
  const avoidedKg = gridTotalKg - solarTotalKg;
  const annualAvoidedKg = avoidedKg / input.analysisYears;
  return {
    gridOperationalKg,
    gridTotalKg,
    solarTotalKg,
    replacements,
    avoidedKg,
    avoidedMetricTons: avoidedKg / 1000,
    reductionPercent: gridTotalKg > 0 ? avoidedKg / gridTotalKg * 100 : 0,
    carbonPaybackYears: annualAvoidedKg > 0 ? input.solarEmbodiedKg / annualAvoidedKg : Infinity,
    carbonValue: avoidedKg / 1000 * input.carbonPricePerMetricTon,
  };
}

export const LEED_PATHWAYS = [
  'Energy efficiency and operational carbon',
  'On-site renewable energy',
  'Construction activity pollution prevention',
  'Light pollution reduction',
  'Site disturbance and habitat protection',
  'Enhanced commissioning and performance verification',
];

