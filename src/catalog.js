export const APPLICATIONS = {
  pathway: { label: 'Pathway / trail', avgFc: 0.5, minFc: 0.1, heightFt: 16, distribution: 'T2M', widthFt: 12 },
  roadway: { label: 'Roadway edge', avgFc: 1.0, minFc: 0.2, heightFt: 24, distribution: 'T3M', widthFt: 28 },
  parking: { label: 'Parking area', avgFc: 2.0, minFc: 0.5, heightFt: 20, distribution: 'T4M', widthFt: 60 },
  transit: { label: 'Transit stop', avgFc: 2.0, minFc: 0.5, heightFt: 16, distribution: 'T3M', widthFt: 18 },
  perimeter: { label: 'Security perimeter', avgFc: 1.0, minFc: 0.2, heightFt: 18, distribution: 'T4M', widthFt: 20 },
  campus: { label: 'Campus / open area', avgFc: 1.0, minFc: 0.3, heightFt: 18, distribution: 'T3M', widthFt: 40 },
};

export const SOLAR_STYLES = {
  flat: {
    label: 'Fixed Flat',
    description: 'Horizontal integrated panel with no south-facing or tilt adjustment.',
    canRotate: false,
    canTilt: false,
  },
  fixedTilt: {
    label: 'South-Facing / Fixed Tilt',
    description: 'Panel rotates toward solar south while its tilt remains fixed.',
    canRotate: true,
    canTilt: false,
  },
  adjustable: {
    label: 'South-Facing / Adjustable Tilt',
    description: 'Panel rotates toward solar south and tilt is optimized for the operating season.',
    canRotate: true,
    canTilt: true,
  },
};

export const PANEL_SIZES_W = [60, 72, 105, 135, 140, 165, 210, 285, 330];
export const BATTERY_SIZES_WH = [384, 720, 1080, 1440, 2160, 2880];

export const ACCESSORY_PRESETS = {
  camera: { label: 'Security camera', watts: 5, hours: 24, voltage: 12, peakWatts: 8 },
  lpr: { label: 'License-plate camera', watts: 12, hours: 24, voltage: 12, peakWatts: 20 },
  radio: { label: 'Cellular / Wi-Fi radio', watts: 6, hours: 24, voltage: 12, peakWatts: 10 },
  sensor: { label: 'Environmental sensor', watts: 2, hours: 24, voltage: 12, peakWatts: 3 },
  beacon: { label: 'Warning beacon', watts: 10, hours: 2, voltage: 12, peakWatts: 15 },
  display: { label: 'Transit information display', watts: 18, hours: 16, voltage: 24, peakWatts: 30 },
};

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const DEFAULT_MONTHLY_PSH = [2.7, 3.2, 4.0, 4.8, 5.4, 5.8, 5.7, 5.2, 4.5, 3.7, 2.9, 2.5];
