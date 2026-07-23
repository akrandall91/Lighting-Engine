import { DEFAULT_MONTHLY_PSH, MONTHS } from './catalog.js';

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function orientationFactor({ style, latitude, azimuthDeg = 180, tiltDeg = 0, monthIndex }) {
  if (style === 'flat') return 0.78;
  const southError = Math.abs((((azimuthDeg - 180) % 360) + 540) % 360 - 180);
  const azimuthFactor = Math.max(0.55, Math.cos(southError * Math.PI / 180) * 0.18 + 0.82);
  const seasonalIdeal = latitude + (monthIndex <= 1 || monthIndex >= 10 ? 12 : monthIndex >= 4 && monthIndex <= 7 ? -10 : 0);
  const appliedTilt = style === 'adjustable' ? seasonalIdeal : tiltDeg;
  const tiltError = Math.abs(appliedTilt - seasonalIdeal);
  const tiltFactor = Math.max(0.72, 1 - tiltError * 0.006);
  return Math.min(1.05, azimuthFactor * tiltFactor);
}

export function lightingWhPerNight(settings) {
  const watts = settings.lampWatts * settings.lampCount;
  const nightHours = settings.nightHours;
  if (settings.schedule === 'dusk-to-dawn') return watts * nightHours;

  const standbyFraction = settings.standbyPercent / 100;
  const boostFraction = settings.boostPercent / 100;
  const eventHours = Math.min(
    nightHours,
    settings.eventsPerHour * nightHours * settings.boostMinutes / 60,
  );

  if (settings.schedule === 'motion') {
    return watts * standbyFraction * nightHours
      + watts * Math.max(0, boostFraction - standbyFraction) * eventHours;
  }

  const eveningHours = Math.min(settings.eveningHours, nightHours);
  const standbyHours = Math.max(0, nightHours - eveningHours);
  const standbyEventHours = Math.min(
    standbyHours,
    settings.eventsPerHour * standbyHours * settings.boostMinutes / 60,
  );
  return watts * settings.eveningPercent / 100 * eveningHours
    + watts * standbyFraction * standbyHours
    + watts * Math.max(0, boostFraction - standbyFraction) * standbyEventHours;
}

export function accessoryWhPerDay(accessories) {
  return accessories.reduce((sum, item) => sum + item.watts * item.hours * item.quantity, 0);
}

export function evaluateElectricalLimits(accessories, hardware) {
  const voltageMismatch = accessories.filter((item) => item.voltage !== hardware.outputVoltage);
  const continuousWatts = accessories.reduce((sum, item) => sum + item.watts * item.quantity, 0);
  const peakWatts = accessories.reduce((sum, item) => sum + item.peakWatts * item.quantity, 0);
  const warnings = [];
  if (voltageMismatch.length) warnings.push('One or more accessories require a different output voltage or a converter.');
  if (continuousWatts > hardware.maxContinuousWatts) warnings.push('Accessory continuous load exceeds the configured controller output.');
  if (peakWatts > hardware.maxPeakWatts) warnings.push('Accessory peak load exceeds the configured controller output.');
  return {
    continuousWatts,
    peakWatts,
    voltageMismatch,
    safe: warnings.length === 0,
    warnings,
  };
}

export function sizeSolarSystem(input) {
  const activeMonths = input.activeMonths;
  const lightingWh = lightingWhPerNight(input.lighting);
  const accessoryWh = accessoryWhPerDay(input.accessories);
  const controllerWh = input.controllerWatts * 24;
  const baseDemandWh = lightingWh + accessoryWh + controllerWh;
  const adjustedDemandWh = baseDemandWh / input.loadEfficiency;
  const usableBatteryWh = input.batteryWh
    * input.maxDepthOfDischarge
    * input.coldBatteryFactor
    * input.endOfLifeCapacity;

  const months = MONTHS.map((month, index) => {
    const active = activeMonths.includes(index);
    const demandWh = active ? adjustedDemandWh : input.inactiveStandbyWh;
    const psh = input.monthlyPsh[index] ?? DEFAULT_MONTHLY_PSH[index];
    const orientation = orientationFactor({ ...input, monthIndex: index });
    const productionWh = input.panelWatts
      * psh
      * orientation
      * input.shadeFactor
      * input.solarEfficiency;
    const marginWh = productionWh - demandWh;
    return {
      month,
      index,
      active,
      days: MONTH_DAYS[index],
      psh,
      orientation,
      productionWh,
      demandWh,
      marginWh,
      marginPercent: demandWh > 0 ? marginWh / demandWh * 100 : 0,
    };
  });

  const activeResults = months.filter((month) => month.active);
  const worstMonth = activeResults.reduce((worst, month) => !worst || month.marginPercent < worst.marginPercent ? month : worst, null);
  const reserveDays = adjustedDemandWh > 0 ? usableBatteryWh / adjustedDemandWh : 0;
  const requiredBatteryWh = adjustedDemandWh * input.reserveDays
    / (input.maxDepthOfDischarge * input.coldBatteryFactor * input.endOfLifeCapacity);
  const worstPshFactor = worstMonth
    ? worstMonth.psh * worstMonth.orientation * input.shadeFactor * input.solarEfficiency
    : 1;
  const requiredPanelWatts = adjustedDemandWh / Math.max(0.1, worstPshFactor);
  const recoveryDays = worstMonth?.marginWh > 0
    ? adjustedDemandWh / worstMonth.marginWh
    : Infinity;

  return {
    lightingWh,
    accessoryWh,
    controllerWh,
    adjustedDemandWh,
    usableBatteryWh,
    reserveDays,
    requiredBatteryWh,
    requiredPanelWatts,
    worstMonth,
    recoveryDays,
    months,
    energyPass: Boolean(worstMonth && worstMonth.marginWh >= 0),
    reservePass: reserveDays >= input.reserveDays,
  };
}

export function remainingAccessoryAllowance(input, result) {
  if (!result.worstMonth) return 0;
  const reserveLimitedDailyWh = result.usableBatteryWh / input.reserveDays;
  const solarLimitedDailyWh = result.worstMonth.productionWh;
  const available = Math.min(reserveLimitedDailyWh, solarLimitedDailyWh);
  const lightingAndController = (result.lightingWh + result.controllerWh) / input.loadEfficiency;
  return Math.max(0, (available - lightingAndController) * input.loadEfficiency);
}
