export const SURFACE_TYPES = {
  turf: { label: 'Turf / lawn', trenchPerFt: 32, restorePerFt: 18, kgCo2ePerFt: 3.2 },
  planting: { label: 'Planting bed', trenchPerFt: 38, restorePerFt: 34, kgCo2ePerFt: 4.1 },
  asphalt: { label: 'Asphalt', trenchPerFt: 72, restorePerFt: 86, kgCo2ePerFt: 12.5 },
  concrete: { label: 'Concrete sidewalk', trenchPerFt: 82, restorePerFt: 105, kgCo2ePerFt: 16.8 },
  roadway: { label: 'Roadway', trenchPerFt: 115, restorePerFt: 165, kgCo2ePerFt: 24.5 },
  pavers: { label: 'Unit pavers', trenchPerFt: 78, restorePerFt: 128, kgCo2ePerFt: 10.2 },
  irrigation: { label: 'Irrigated landscape', trenchPerFt: 42, restorePerFt: 58, kgCo2ePerFt: 5.8 },
  rootzone: { label: 'Tree root protection area', trenchPerFt: 95, restorePerFt: 120, kgCo2ePerFt: 8.4 },
};

const sum = (items, pick) => items.reduce((total, item) => total + pick(item), 0);
const presentValue = (annual, years, discountRate, escalationRate = 0) => {
  let total = 0;
  for (let year = 1; year <= years; year += 1) {
    total += annual * ((1 + escalationRate) ** (year - 1)) / ((1 + discountRate) ** year);
  }
  return total;
};

export function compareProjectAlternatives(input) {
  const segments = (input.trenchSegments || []).map((segment) => {
    const surface = SURFACE_TYPES[segment.surface] || SURFACE_TYPES.turf;
    const lengthFt = Math.max(0, Number(segment.lengthFt) || 0);
    return {
      ...segment,
      label: surface.label,
      lengthFt,
      trenchCost: lengthFt * surface.trenchPerFt,
      restorationCost: lengthFt * surface.restorePerFt,
      constructionKgCo2e: lengthFt * surface.kgCo2ePerFt,
    };
  });
  const poles = Math.max(1, Number(input.poleCount) || 1);
  const commonPoleCost = poles * input.poleInstalledCost;
  const gridCapital = commonPoleCost
    + sum(segments, (item) => item.trenchCost + item.restorationCost)
    + input.gridServiceCost + input.utilityCoordinationCost + input.trafficControlCost
    + input.irrigationRepairCost + input.treeProtectionCost + input.gridMobilizationCost;
  const solarCapital = commonPoleCost
    + poles * (input.solarEquipmentPerPole + input.solarInstallPerPole)
    + input.solarMobilizationCost + input.solarSiteRestorationCost;
  const gridAnnualEnergyKwh = input.annualLightingKwh;
  const gridLifecycle = gridCapital
    + presentValue(gridAnnualEnergyKwh * input.utilityRatePerKwh + input.gridAnnualMaintenance, input.analysisYears, input.discountRate, input.energyEscalation)
    + presentValue(input.monthlyServiceCharge * 12, input.analysisYears, input.discountRate, input.energyEscalation);
  const solarLifecycle = solarCapital
    + presentValue(input.solarAnnualMaintenance, input.analysisYears, input.discountRate)
    + input.batteryReplacementCost * Math.floor((input.analysisYears - 1) / input.batteryLifeYears);
  const avoidedCapital = gridCapital - solarCapital;
  const lifecycleSavings = gridLifecycle - solarLifecycle;
  const simplePaybackYears = avoidedCapital >= 0 ? 0 : Math.abs(avoidedCapital) /
    Math.max(1, gridAnnualEnergyKwh * input.utilityRatePerKwh + input.monthlyServiceCharge * 12
      + input.gridAnnualMaintenance - input.solarAnnualMaintenance);
  return {
    segments,
    trenchLengthFt: sum(segments, (item) => item.lengthFt),
    trenchAndRestorationCost: sum(segments, (item) => item.trenchCost + item.restorationCost),
    landscapeRestorationCost: sum(segments.filter((item) => ['turf', 'planting', 'irrigation', 'rootzone'].includes(item.surface)),
      (item) => item.restorationCost) + input.irrigationRepairCost + input.treeProtectionCost,
    trenchConstructionKgCo2e: sum(segments, (item) => item.constructionKgCo2e),
    gridCapital,
    solarCapital,
    gridLifecycle,
    solarLifecycle,
    avoidedCapital,
    lifecycleSavings,
    simplePaybackYears,
    recommendation: lifecycleSavings > gridLifecycle * 0.2 ? 'Strong solar advantage'
      : lifecycleSavings > 0 ? 'Solar advantage'
        : lifecycleSavings > -gridLifecycle * 0.05 ? 'Comparable lifecycle cost' : 'Grid advantage',
  };
}

