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
- Complete grid-and-trenching and provider-neutral solar alternatives are compared on equal lighting performance.
- Trenching surfaces include turf, planting, asphalt, concrete, roadway, pavers, irrigation, and tree-root protection areas.
- Lifecycle costs include service, restoration, landscaping, energy, maintenance, and battery replacement assumptions.
- GHG reporting separates project emissions, avoided emissions, and optional purchased carbon offsets.
- The report surfaces potential LEED pathways without promising certification or points.
- An immersive 3D site workspace is prepared for Google Maps 3D, Places, Solar data layers, and Census context.
- The civic decision brief applies four independent tests: lighting, worst-month energy, lifecycle cost, and lifecycle carbon.
- A truth ledger labels measured, sourced, assumed, user-entered, and modeled evidence with confidence and provenance.
- Civil-cost sensitivity shows whether the recommendation survives ±30% trenching and restoration uncertainty.
- Census community context includes ACS estimates and 90% confidence margins of error for population, zero-vehicle households, public-transit commuters, and poverty context.
- Material challenges remain visible even when other dimensions favor solar.

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

Tests cover IES parsing, candela interpolation, endpoint-inclusive pole counts, motion-energy calculations, electrical limits, seasonal solar sizing, project economics, landscape restoration, and lifecycle carbon.

## API integration plan

The protected Node server now provides `/api/status`, `/api/solar-resource`, `/api/climate`, `/api/elevation`, `/api/census`, and `/api/electricity-rate`. Use separate restricted browser and server credentials. The browser receives only a referrer-restricted Google Maps key. Census, NREL, EIA, elevation, solar-resource processing, and caching belong behind `/api`.

- Google Maps JavaScript / Maps 3D / Places (New) / Geocoding / Elevation / Time Zone / Solar API
- U.S. Census Data API and Census Geocoder
- NREL Developer Network
- EIA API
- Open-Meteo for weather history where appropriate (no key at time of design)

EPA eGRID factors, LEED pathway mappings, unit costs, and embodied-carbon factors are versioned reference datasets rather than hidden live assumptions. Every report must identify the source year, geography, factor, and user overrides.

## Private configuration

Copy `.env.example` to `.env`, then fill in the rotated credentials. Never reuse credentials that were previously committed or embedded in browser JavaScript.

```powershell
Copy-Item .env.example .env
node scripts/set-password.mjs
```

Paste the generated `APP_PASSWORD_HASH` into `.env`. Generate a separate random `SESSION_SECRET` of at least 32 characters. In production, set `NODE_ENV=production`, use HTTPS, restrict the browser key by HTTP referrer, and restrict the server key by server IP.

Start the password-protected application with:

```powershell
node scripts/serve.mjs 8000
```

Authentication is intentionally permitted without a password only in local development when `APP_PASSWORD_HASH` is absent. Production does not receive that bypass.

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

Do not commit live API keys. Use the ignored `.env` file locally and hosting-environment variables in production. Google Maps browser keys must be restricted by API and HTTP referrer; server credentials must not be shipped to browsers.
