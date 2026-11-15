# Spread layer on the existing forecast map

## Quick start

```powershell
python fire_forecast.py predict      # only if there is no forecast yet (needs a trained model)
python fire_dashboard.py start       # prepares what is missing, builds the map and serves it
```

Open http://127.0.0.1:8000/ . `start` needs `output/firms/forecast_latest.csv` and the caches in `data/raw` and
`data/gfs`. If the wind forecast for the arrows is not cached, it downloads that one file from NOAA GFS (about 4 MB)
into `data/gfs_uv`; nothing else is downloaded. It also builds the history calendar when
`output/harmonization_handoff.zip` is present, and the seasons page when `data/climate_months.npz` is present.
Any Python with the packages from `requirements.txt` works; the `.venv\Scripts\python.exe` paths below are one example.

On the map:
- The day slider is off by default and never plays by itself. Tick **Next days** to open it; the cross closes it and
  returns to the next 24 hours.
- **Go to** changes the view only. **Other views** opens the history calendar, the Ireland simulation and the seasons page.
- If a view has no squares at the chosen probability, a note says so instead of leaving the map empty.

The sections below describe each part in detail.

Run commands from the repository root with the existing virtual environment:

Prerequisites: the dependencies in `requirements.txt` and locally supplied caches
in `data/raw`, `data/gfs`, `data/gfs_uv`, the cached country boundaries
`data/ne_110m_admin_0_countries.geojson`, and `output/firms/forecast_latest.csv`.
These data and generated outputs are ignored by Git; a fresh clone alone cannot
rebuild the demo. Missing inputs stop the command rather than starting downloads.
The optional fitted blend is `output/spread/blend_model.json`; without it,
directions fall back to wind. Recreate its evaluation from existing caches with
`.venv\Scripts\python.exe fire_spread.py backtest`.

```powershell
.venv\Scripts\python.exe fire_dashboard.py build --refresh-spread
.venv\Scripts\python.exe fire_dashboard.py serve --port 8000
```

Open http://127.0.0.1:8000/ . The generated `output/firms/forecast_map.html`
also works as a standalone file with embedded forecast snapshots. Leaflet and
background map tiles still need internet access. No FIRMS/GFS download, model
training, commit, deployment or changes to `fire_forecast.py` are performed.

The builder aligns the active-fire and scenario issue times to the cached
`output/firms/forecast_latest.csv`. It preserves available partner forecast
days and per-day weather from a matching generated map. Where the CSV supplies
only first-day weather, later-day weather is shown as unavailable, not zero.
Only the first 24h has spread data; selecting a later probability day hides it.
The existing probability layer and its controls remain in place.

Map controls:
- Opens over Ireland with **World + regional scenarios**, showing Ireland,
  United Kingdom, Spain and France scenarios together with worldwide active-fire directions. Zooming or panning
  to the rest of the world keeps those global arrows available. Ireland / World
  buttons change only the view, not the selected source.
- The combined view preserves each feature's active/scenario identity and merges
  only snapshots with matching issue times. Regional scenarios take precedence
  over active arrows in the same forecast cells. Northern Ireland is included
  once, in the Ireland layer. Restricted source options remain available for
  examining Ireland only, UK/Spain/France scenarios, active fires only, or global top-50 scenarios.
- Source: all cached forecast cells on the island of Ireland, observed active-fire clusters worldwide,
  or the global top-50 new-ignition scenarios. Ireland scenarios do not require
  `new_ignition=True`: that flag describes recent nearby fire history, not whether
  a cell can have a fire. Regional scenarios are conditional, not observed fires.
  Northern Ireland cells retain their original United Kingdom country label;
  they are selected using the cached Northern Ireland boundary polygon, excluding
  Great Britain. Country labels and probabilities are not changed.
- Arrows, candidate lists and selected cards follow **Show probability from** and
  **Only new fire areas**, using the same cell lookup/filter as the probability map.
  The probability slider includes 1%, 1.25%, 1.5% and 2% for low-risk regions.
  A higher probability cutoff hides arrows; it does not rotate the wind.
- No synthetic Ireland cells or increased probabilities are added. If cached
  coverage is empty, or the filters exclude it, the layer reports no candidates.
- Direction: wind blows toward, or estimated fire spread.
- Horizon: +6, +12, +18, +24 hours.
- Click an arrow, Find a fire, or Browse fires to see the cell's fire probability,
  wind vector direction/speed, spread direction and cumulative head-fire travel.
- Arrows represent orientation; nearby arrows are thinned at low zoom. At high
  zoom the illustrative head-fire trajectory is drawn at its geographic scale.
- Refresh loads an updated snapshot over HTTP. Rebuild and reopen standalone
  HTML files after the cached inputs change.

## Read-only API

The optional server binds only to `127.0.0.1`. It serves an explicit allowlist,
not the repository or environment files. There are no write endpoints.

| Endpoint | Response |
| --- | --- |
| `GET /api/forecast` | Partner probability columns, grid resolution and UTC forecast windows |
| `GET /api/spread?source=active` | Active spread GeoJSON FeatureCollection |
| `GET /api/spread?source=scenario` | Scenario spread GeoJSON FeatureCollection |
| `GET /api/spread?source=ireland` | Conditional spread for cached Ireland cells |
| `GET /api/spread?source=europe` | Conditional spread for UK, Spain, France; excludes cells already in Ireland layer |
| `GET /api/status` | Available spread snapshot metadata |

Each spread feature is an origin Point with coordinates **[longitude, latitude]**.
IDs are unique within a source/snapshot; do not assume cluster IDs persist across
new forecast runs. Metadata includes `schema_version`, `issued_at_utc`,
`valid_to_utc`, `gfs_cycle_utc`, source and model identity.
Ireland features have `source=scenario`, the island scope in collection `region` metadata,
and an `ireland-` ID prefix; the original global top-50 export is preserved.
Forecast probability columns use the payload's `probability_scale` (1,000,000)
as their divisor. The map also supports the partner's original divisor of 1,000
when that field is absent. This preserves low probabilities such as 1.04%.

Properties include `cluster_id`, `n_points`, `frp_sum`, `persistence_available`,
`persistence_bearing_deg`, `direction_model` and `frames`. Each frame contains:

| Field | Meaning |
| --- | --- |
| `hour`, `valid_at_utc` | Lead time and exact UTC endpoint |
| `wind_u_ms`, `wind_v_ms` | Six-hour interval mean eastward/northward wind at the origin |
| `wind_speed_ms`, `wind_bearing_deg` | Interval wind; bearing points TO, clockwise from north |
| `spread_bearing_deg` | Interval estimated fire-spread direction |
| `head_position` | Illustrative head position [lon, lat], or null when direction is unknown |
| `segment_distance_km` | Estimated head-fire travel in that six-hour interval |
| `cumulative_head_distance_km` | Cumulative travel since the issue time |

These frames provide the data contract for later map animation. No spread
animation or verified burned-area/perimeter prediction is implemented here.
Wind directions and paths are separate from ignition probability: a scenario
path is conditional on an ignition actually happening.
Regional cells are selected from the existing forecast CSV without increasing
probabilities or requiring `new_ignition=True`. Each cell's direction comes from
interpolated GFS U/V, independently of its probability. The default combined view
keeps the regional candidates visible as the map moves around the world.

## Direction model and limits

Active inference matches the current 24h clusters to the preceding 24h clusters,
using only detections before the issue time. It applies the fitted
`output/spread/blend_model.json` if all its training labels predate the issue.
Missing persistence falls back to wind. Scenarios have no observed persistence
and therefore use wind. Calm/undefined directions are null, not invented north.
Terrain is not enabled on the map because it did not improve held-out mean error.
The existing CSV `bearing_deg` retains its original wind-TO meaning; the web
payload explicitly distinguishes wind from blended spread.

Distances retain the uncalibrated wind/dryness heuristic. They are cumulative
travel, not straight-line displacement or burned area. Frames use winds sampled
at the origin; they do not resample weather along the moving path. Current cached
forecasts are dated snapshots, not live monitoring.
Cards show the weather source and `gfs_cycle_utc`. NOAA GFS supplies a numerical
weather forecast of 10 m wind, not live station measurements. Current regional
exports use the cached 2026-11-13 12Z cycle for the 17Z issue time. There is no
automatic download of newer cycles. Rebuild from newly supplied caches to update.

## Checks

```powershell
.venv\Scripts\python.exe -m unittest test_fire_spread test_fire_evaluation test_fire_dashboard -v
```

Desktop/mobile browser checks use the installed Node and Chrome without adding
packages. Start the server, then invoke `scripts/check_dashboard_browser.cjs`
through Python's `subprocess`. Actual captures are saved under
`output/spread/browser_checks/`.

## Harmonized activity calendar (challenge workspace)

The default dashboard view is the MODIS + VIIRS calendar. **Back to forecast**
opens the existing probability map, spread arrows and Ireland simulation.
`http://localhost:8000/?view=forecast` opens the forecast directly. Controllers
remain a separate source of local temperature, not an input to harmonization.

Rebuild the long calendar from the already supplied archive, then the dashboard:

```powershell
.venv\Scripts\python.exe fire_history.py --package "C:\path\to\harmonization_handoff.zip"
.venv\Scripts\python.exe fire_dashboard.py build
.venv\Scripts\python.exe fire_dashboard.py serve --port 8000
```

There are no scientific downloads or global archive extraction. The builder
verifies package checksums and reads selected NPZ/CSV members in memory; it never
executes packaged code or loads pickled arrays. The supplied MODIS monthly files
contain 302 months, November 2000 through December 2025 (15.761 MB of NPZ files).
VIIRS extends the displayed calendar through October 2026, for **312 months**.
November 2026 is partial and excluded, not a zero or a live observation.

The four supported regions are the Republic of Ireland, United Kingdom
(including Northern Ireland), Spain and European France. Delivered country
boundaries are coarse; a shared mask keeps only 0.25-degree cells whose centre
and four corners are inside a single country polygon. Border/coastal cells and
territories absent from the handoff are excluded. This is regional coverage,
not arbitrary AOI selection or complete national coverage.

### One series, explicit provenance

The observed measure is **detected grid-cell days**: each cell with one or more
retained detections on a date contributes one day. VIIRS satellites/overpasses
are unioned, not summed. MODIS was filtered upstream at confidence >=30 and type
0; VIIRS uses nominal/high confidence and type 0 where available. Both use the
same supplied static-source mask. Zero means no retained detections; source
completeness and cloud-free observation coverage cannot be established.

The main **harmonized activity** series uses the MODIS value wherever supplied,
otherwise the adjusted VIIRS value. It never adds overlapping sensors. Adjusted
VIIRS is a **MODIS-scale index**, not a literal number of fires, hotspots or days.
Raw MODIS, raw VIIRS and adjusted VIIRS views remain available. The source and
quality flags are visible for every month and exported in the monthly CSV.

The nonnegative country multiplier is fitted on November 2024-July 2025 and
frozen. August-December 2025 is held out; no parameter fitting or selection uses
these test months. The before/after chart shades the test period and reports MAE
and signed bias. These measure satellite agreement, not fire-prediction accuracy.
Only five held-out months are available, so year-round equivalence is unproven.
Validation is at country-total level; scaling individual map cells is illustrative.
The shared static mask is retrospective, not a prospective validation pipeline.

VIIRS NRT source type is unknown from August 2026. Its harmonized continuation
and anomalies are marked provisional; the mask cannot guarantee removal of all
industrial heat sources. Missing calibration or missing data produces null,
never a fabricated zero. Pre-2003 MODIS coverage is marked separately.

### Historical reference and exports

For each selected month, the comparison uses the **same calendar month** in
supplied MODIS years 2003-2023 strictly before the selected year. At least five
reference years are required. Recent months use 21 reference years. Displayed
values include the median, descriptive 10th-90th percentile band, absolute
anomaly and relative anomaly. A zero median leaves the percentage unavailable.
The selected year, future years and early coverage years are never used in its
baseline. The overlap years 2024-2025 are outside the fixed reference pool.
These are descriptive detection statistics, not forecast probabilities or a
climate-trend claim; sensor and observation-coverage uncertainty remains.

Calendar rows are years, columns months. Region/date/metric controls affect the
calendar, peak-month and complete-year summaries and exports. Missing values
are striped; provisional continuation and early coverage have separate marks.

- **Monthly CSV**: selected country and dates, both instruments, harmonized
  index, source, quality flags, reference statistics and anomalies.
- **Calendar SVG**: a standalone vector calendar with units, provenance and legend.
- **Validation SVG**: before/after country-level agreement with held-out months.
- **VIIRS points CSV**: supplied points in the selected country/date range,
  retaining `calendar_included`. Incomplete months fail the calendar inclusion
  flag even if individual point rows are supplied. Raw MODIS points/times/FRP
  are absent and cannot be reconstructed or exported from monthly aggregates.

Read-only endpoints remain `/api/history` and
`/api/history/detections?country=Ireland&start=2025-01&end=2025-12`.
Monthly CSV and SVG work in the standalone map; points export requires the local
server. Generated artifacts stay in ignored `output/history/`.

### Challenge scope and remaining limitations

This implements monthly aggregate harmonization and a long-record web calendar,
regional/date selection, historical comparisons, downloadable analytics and
visualizations. It does not claim event-level sensor matching, literal hotspot
counts, arbitrary polygons, verified cloud coverage, or fully validated sensor
interchangeability. These distinctions should remain visible in the presentation.
Forecast probability, wind simulation and controller temperature are additional
features; they do not establish the validity of harmonization.

```powershell
.venv\Scripts\python.exe -m unittest test_fire_history test_fire_dashboard
```

Checks cover source stitching, no overlapping-sensor addition, temporal holdout,
missing/zero values, past-only same-month baselines, export boundaries, the full
calendar, SVG/CSV downloads and desktop/mobile navigation back to forecasts.

## Live controller temperature (WebSocket)

The existing map is the main application. The independent `webiot` receiver
accepts controller HTTP requests at `/api/esp32` and broadcasts them at `/ws`.
No Git merge, copied IoT service, new Python dependencies or model changes are
required for this connection. Rebuild with `fire_dashboard.py build` after
updating the template or either sensor script; this embeds both scripts in the
output HTML. Run this dashboard build after the partner regenerates their map.

The Ground sensors panel defaults to the team's supplied endpoint
`ws://51.68.199.185:2500/ws`. Click Connect, add a controller with its exact
`deviceId`, and choose its position on the map. This does not provision hardware;
the device must already send to the team's receiver. The UI can also link an
existing browser-local marker using Link ID. IDs are unique within this browser.

Recommended controller POST body (example only, not an actual observation):

```json
{"deviceId":"esp32-01","temperatureC":21.5,"recordedAt":"2026-11-14T14:00:00Z"}
```

Send a fresh timestamp for each measurement. `recordedAt` is optional if the
controller has no clock: the receiver's `time` is then displayed as server
receipt time, not measurement time. The adapter accepts either the direct JSON
object or the existing receiver's `{event:"request",time,query,body}` envelope.
The newer webplatform live `snapshot`, `sensor.updated` and `sensor.reading`
messages are also supported. Its registry maps internal sensorId to deviceId;
simulation/history contexts, simulated sensors and faulted temperatures are excluded.
JSON bodies, form numeric strings and GET query fields are supported. Aliases:
`device_id`, `tempC`, `temperature`, `temp`, and `recorded_at`. All temperature
aliases mean Celsius; a supplied `unit` must be C, ?C or celsius. Device IDs must
be 1?80 letters/digits or `_.:-`. Unknown IDs are reported, never automatically
assigned to another controller. Plain text needs a firmware/receiver adapter.

Readings are updated in the list and marker popup, with Live, Stale (over two
minutes), Disconnected or Waiting for data status. Out-of-order or duplicate
measurement timestamps and invalid values cannot replace a valid reading.
Automatic retries back off to 30 seconds. A saved enabled connection reconnects
on reload; the location registry and endpoint are browser-local. Temperatures
are memory-only and are not restored as live readings after reload. There is
no server-side history/replay in this integration, and no guarantee of delivery
while the page is closed. Temperature does not modify ML probabilities, wind,
spread distances or the historical calendar, and does not confirm ignition.

An HTTPS-hosted map requires a WSS receiver (normally a TLS reverse proxy and
hostname); the supplied WS endpoint works with the local HTTP dashboard.
The current receiver is a prototype broadcast feed, not authenticated device
registration. Keep ingest secrets out of the browser and WebSocket URL. Do not
reuse the old historical forecast timestamp as the live measurement timestamp.

Validation uses seven Node contract tests and the existing desktop/mobile browser
suite. Its loopback-only relay sends explicitly synthetic QA readings through
HTTP -> WebSocket -> the map and checks routing, invalid/old readings,
staleness, reconnection, and unchanged forecast probabilities. It never POSTs
test data to the team's remote server. Run Node through the project Python:

```powershell
.venv\Scripts\python.exe -c "import subprocess; subprocess.run(['node','--test','scripts/test_fire_telemetry.cjs'],check=True)"
.venv\Scripts\python.exe -c "import subprocess; subprocess.run(['node','scripts/check_dashboard_browser.cjs','http://127.0.0.1:8000/'],check=True)"
```

## Ireland simulation on the forecast map

Open **Ireland fire simulation** on the existing local dashboard, choose a
prepared area and click **Calculate & play**. All seven displayed forecast cells
on the island of Ireland have separate 5 x 5 km terrain grids, plus the original
Glendalough demonstration area. A forecast cell or direction-arrow popup offers
**Simulate this area** where a grid is available. This is seven local windows,
not continuous coverage of the whole island. Probabilities are the original
13 November 2026 17:00 UTC snapshot; these are not seven confirmed fires.

The default wind source is the **cached NOAA GFS forecast** used by the map.
U/V is bilinearly sampled at the ignition and interpolated through the run.
The UI shows the issue date, GFS cycle, speed and direction. Wind TO is converted
to meteorological FROM for the engine. It is forecast wind, not live station
wind. Missing wind cache is an error; there is no automatic download or silent
manual fallback. Manual speed/direction remain available for what-if scenarios.
Temperature (27 C), RH (35%) and rain (0) are synthetic dry-weather assumptions.
Neither weather mode is a calibrated prediction of a real burned perimeter.

Demo setup places an ignition on nearby burnable terrain and three explicitly
virtual sensors. Users can replace the ignition and place up to eight virtual
sensors, including temperature-only profiles. Water, built/unknown terrain and
out-of-area ignition are rejected. Calculate runs 30 minutes, one hour or three
hours; pause and seek replay the same frames. Engine time steps are 5 seconds,
returned frames 30 seconds; playback speed does not alter the solver.
Closing the mode restores forecast layers and real controllers. Virtual readings
never enter live telemetry or change ML probabilities or the historical calendar.

The pinned team engine `surface-grid-1.2.0` comes from `webiot` commit `63061bc`.
Source, generated modules and hashes are in `vendor/irish_simulation/`.
The numerical support adaptation is Node-native SHA-256 instead of the browser
hash dependency. Node 24 is required; React, PostgreSQL and new npm packages are
not required. Run commands through `.venv\Scripts\python.exe`.

### Terrain acquisition and provenance

Each of the seven new grids uses its own ESA WorldCover 2021 land cover and
Copernicus DEM GLO-30 elevation, sampled to a 200 x 200 grid at approximately
25 m. Fuel rates and sensor responses remain illustrative. Original Glendalough
terrain is preserved separately. Attribution, source URLs, raster alignment and
checksums accompany the compressed grids in `vendor/irish_simulation/sites/`.
`planned_sites.csv` records the seven snapshot locations and availability.

The approved acquisition fetched **20.884 MB** of pixel blocks, with a hard
25 MB limit, after a separate 0.524 MB metadata preflight. The final seven gzip
grids total approximately 6.757 MB. A subsequent alignment correction rebuilt
from cached blocks with zero additional download. No whole source tiles were
fetched. `acquisition.json` records planned bytes and the most recent build's
network bytes (zero for this cached rebuild).

Ordinary dashboard use is entirely offline for scientific inputs. Optional
`scripts/prepare_ireland_sites.py` reproduces the grids; its `--plan` performs
metadata requests, and `--download-approved` performs the bounded acquisition.
Do not use either as part of normal startup. Optional preparation dependencies
are in `requirements-terrain.txt`; they are not needed to run checked-in grids.
Cached blocks and acquisition plan stay in ignored `output/simulation/`.

### API and verification

- GET `/api/simulation/sites`: prepared areas and dated snapshot probabilities.
- GET `/api/simulation/environment?site=ireland-0`: compact selected terrain,
  placement mask, default ignition and provenance; default is Glendalough.
- GET `/api/simulation/wind?lat=53.375&lon=-7.125&duration=3600`: cached wind.
- POST `/api/simulation/run`: `siteId`, `weatherMode` (`forecast_wind` or `manual`),
  `ignition:{longitude,latitude}`, `sensors:[{longitude,latitude,profileId}]`,
  `durationSec` (1800/3600/10800), `windSpeedMps` (0..15), `windFromDeg` (0..<360).
  Omitted site/mode retains the original Glendalough/manual API behavior.

The server allows one calculation at a time, caps request size and terminates
workers after 90 seconds. Scenario results are not stored as observations.
Standalone HTML cannot execute the engine; use the local server:

```powershell
.venv\Scripts\python.exe fire_dashboard.py build
.venv\Scripts\python.exe fire_dashboard.py serve --port 8000
```

Python checks cover determinism, wind response, GFS vector sampling, seven
distinct terrain grids, input bounds and virtual sensor profiles. Browser checks
cover all seven area selectors, calculations, wind changes, water rejection,
rewind, mobile layout and restoring the forecast. These are software checks,
not scientific validation of spread accuracy.

### Controller handoff

The panel supports both receiver formats described above, displays connection
and message diagnostics, and can prefill a detected device ID for map placement.
On reconnect, older samples remain labelled as waiting for a new update.
A WebSocket connection alone does not establish that hardware is transmitting.
The team's controller was switched off during verification; receipt of a real
measurement still needs checking when it is enabled. Local synthetic QA messages
passed through HTTP -> WebSocket -> map without changing forecast probabilities.

Forecast/model caches, generated `output/`, the two-year handoff ZIP and `.venv/`
are excluded from Git. A fresh checkout needs those existing inputs. The small
terrain bundles and simulation runtime are included in source control scope.
Do not download missing scientific inputs outside the separately approved scope.
