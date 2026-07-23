# AKRD Lighting Engine

A browser-based planning tool that connects measured luminaire photometry with seasonal off-grid solar, battery, and auxiliary-load sizing.

## What changed in v3

- Exact laboratory IES files are indexed and selected independently from solar platforms.
- Point-by-point horizontal illuminance is calculated from LM-63 candela tables.
- Pole counts are endpoint-inclusive and actual spacing is reported.
- Solar production is evaluated month by month for the selected operating season.
- Three solar mounting styles are modeled:
  - Fixed Flat
  - South-Facing / Fixed Tilt
  - South-Facing / Adjustable Tilt
- Panel and battery sizes can be adjusted interactively.
- Lighting schedules model dusk-to-dawn, adaptive, and motion operation without double-counting standby energy.
- Auxiliary equipment is checked for energy, voltage, continuous power, and peak power.
- API credentials are not stored in the repository.

## Run locally

This project uses browser ES modules and must be served over HTTP:

```powershell
node scripts/serve.mjs 8000
```

Open `http://localhost:8000`.

No package installation or build framework is required.

## Rebuild the IES registry

Place manufacturer-authorized `.ies` files anywhere under `photometry/ies`, then run:

```powershell
npm run build:ies
```

The script parses each file, normalizes its metadata, calculates a SHA-256 checksum, identifies exact duplicates, and writes `data/ies-registry.json`.

## Tests

```powershell
npm test
```

Tests cover IES parsing, candela interpolation, endpoint-inclusive pole counts, motion-energy calculations, electrical limits, and seasonal solar sizing.

## Calculation boundaries

The engine is a planning model, not stamped engineering.

Before procurement, the responsible manufacturer and design professional must confirm:

- Which lamp packages are allowed on each solar platform.
- Actual battery chemistry, voltage, permitted depth of discharge, temperature limits, end-of-life capacity, and maximum current.
- Controller PV/input/output voltage and current limits.
- Permitted auxiliary connections, protection, wiring, converters, and load-shedding behavior.
- Structural pole and wind-loading requirements.
- Field shade and south-facing exposure.
- Applicable lighting and electrical requirements.

Point-by-point results should be regression-checked against AGi32, Visual, DIALux, or another accepted photometric application before being represented as final design values.

## IES data policy

Only files supplied or authorized by the manufacturer or testing laboratory should be distributed in this repository. Preserve original filenames and test metadata. Never scale a different wattage's candela table and label it as measured photometry.

## Repository security

Do not commit live API keys. Use `config.local.js` for local-only configuration or provide credentials through a protected backend. Google Maps keys must be restricted by API and HTTP referrer; general data-service credentials should not be shipped to browsers.
