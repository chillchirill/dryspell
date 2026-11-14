# Spread layer on the existing forecast map

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

## Two-year activity calendar

Build from the supplied handoff ZIP, then rebuild the same dashboard:

```powershell
.venv\Scripts\python.exe fire_history.py --package "C:\path\to\harmonization_handoff.zip"
.venv\Scripts\python.exe fire_dashboard.py build
.venv\Scripts\python.exe fire_dashboard.py serve --port 8000
```

The package stays in its original location. The builder checks its SHA256
manifest, reads selected arrays directly from the ZIP, never runs packaged code,
never loads pickled arrays, and does not download or unpack global archives.
Generated JSON, monthly CSV and compressed VIIRS points stay in ignored
`output/history/` (about 3.9 MB for the supplied package).

The **Fire history & calendar** button opens a separate map view, preserving the
forecast and sensor controls. It covers November 2024 through October 2026 in
Ireland (Republic), United Kingdom (including Northern Ireland), Spain and
European France. Country and month-range controls filter the calendar and CSV;
selecting a month displays its active grid cells. Coastal/border cells and
territories absent from the handoff are excluded. Forecast probability cells and
direction arrows are hidden in this historical view and restored on return.

The common measure is **detected grid-cell days**: a cell observed on a day
counts once even if several VIIRS satellites/overpasses detected it. Summing this
measure across a country does not count independent fires or burned area.
VIIRS is rebuilt from raw points with nominal/high confidence and type 0 where
available. MODIS monthly counts already use confidence >=30 and type 0.
Both use the same supplied static-source mask and 0.25-degree cells whose centre
and four corners fall inside a delivered country polygon. The annual MODIS file
and precomputed VIIRS climate arrays are deliberately not mixed into this series.

An **experimental adjusted VIIRS index** scales country totals toward MODIS.
A nonnegative least-squares multiplier is fitted on the first 9 common months
(Nov 2024–Jul 2025), then evaluated on the last 5 (Aug–Dec 2025). The fitted
multiplier is frozen; test months never determine it. The UI exposes the factor,
held-out MAE before/after adjustment, and whether it improves this comparison.
The fixed preprocessing mask is shared across the entire record: this is not
prospective validation. Individual map-cell adjustment is illustrative; it has
only been evaluated at country-total level.

This is **monthly aggregate alignment**, not completed event-level sensor
harmonization. MODIS raw points/times and FRP are missing. MODIS for 2026 is null,
not zero. VIIRS NRT lacks `type` from Aug 2026; those months show unknown-type
counts and provisional adjusted values. File-date coverage is checked for both
VIIRS satellites, but cloud-free observation coverage and source completeness
are unknown. Zero means no retained detections, not proof of no fire. Two years
do not establish a climatic baseline or long-term trend.

Additional read-only endpoints (restart an older running server after updating):

- `/api/history`: the calendar and per-month grid-cell data.
- `/api/history/detections?country=Ireland&start=2025-01&end=2025-12`: supplied raw
  VIIRS rows for the selected country/months, with a `calendar_included` flag.
  Raw MODIS points cannot be exported because they are not supplied.

Monthly CSV is generated in the browser and also works in standalone HTML.
VIIRS point downloads require the local server. Neither endpoint serves archive
paths, source code, keys or arbitrary files.

```powershell
.venv\Scripts\python.exe -m unittest test_fire_spread test_fire_evaluation test_fire_dashboard test_fire_history
```

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

Validation uses five Node contract tests and the existing desktop/mobile browser
suite. Its loopback-only relay sends explicitly synthetic QA readings through
HTTP -> WebSocket -> the map and checks routing, invalid/old readings,
staleness, reconnection, and unchanged forecast probabilities. It never POSTs
test data to the team's remote server. Run Node through the project Python:

```powershell
.venv\Scripts\python.exe -c "import subprocess; subprocess.run(['node','--test','scripts/test_fire_telemetry.cjs'],check=True)"
.venv\Scripts\python.exe -c "import subprocess; subprocess.run(['node','scripts/check_dashboard_browser.cjs','http://127.0.0.1:8000/'],check=True)"
```

## Ireland simulation on the forecast map

Open **Ireland fire simulation** on the existing local dashboard. This is a
bounded 5 ? 5 km Glendalough scenario, not coverage of all Ireland. Demo setup
places one ignition and three explicitly virtual sensors. Calculate & play
computes 30-minute, one-hour or three-hour runs; pause and seek replay the same
calculated frames. Users can replace the ignition, place up to eight virtual
temperature/combined sensors, inspect terrain by clicking, and change scenario
wind. Water/unknown/built ignition and points outside the prepared grid are
rejected. Closing the mode restores forecast layers, view and real controllers.
Virtual readings never enter the live telemetry registry or the forecast model.

The pinned team engine `surface-grid-1.2.0` comes from `webiot` commit `63061bc`.
Original TypeScript and generated runtime modules are in
`vendor/irish_simulation/`; `provenance.json` records full commit/source hashes.
The only numerical support adaptation is equivalent Node-native SHA-256
instead of the original browser hash dependency. No React, PostgreSQL, new npm
packages or map service on port 4177 is required. Node 24 must be available.
All commands continue to be launched through `.venv\Scripts\python.exe`.

The cached terrain is the team's actual WorldCover 2021 / Copernicus DSM
prepared 40,000-cell grid (25 m). The original metadata and attribution are
retained in compressed `environment.json.gz` (about 0.67 MB). No terrain or
weather acquisition occurs. Fuel rates and virtual sensor responses remain
illustrative assumptions. The scenario explicitly holds 27 ?C, 35% RH, no rain
and user-selected wind constant. These are synthetic dry-summer conditions,
not current weather, a climate projection, observed fire or a calibrated forecast.
Weather wind direction is meteorological FROM; the UI labels the corresponding
TO direction. The engine retains 5-second numerical steps, while returned/display
frames are sampled every 30 seconds. Playback speed does not change the solver.

GET `/api/simulation/environment` returns the prepared extent, terrain classes,
elevation, placement mask and provenance. POST `/api/simulation/run` accepts
`ignition:{longitude,latitude}`, `sensors:[{longitude,latitude,profileId}]`,
`durationSec` (1800/3600/10800), `windSpeedMps` (0?15), `windFromDeg` (0?<360).
The local server allows one calculation at a time, caps request size and has a
90-second child-process timeout. Runs are returned to the browser, not saved
as scientific observations or probabilities. Simulation needs the local server;
a standalone HTML file cannot execute the numerical engine.

Rebuild with `fire_dashboard.py build` and restart `fire_dashboard.py serve`
after installing these routes. `scripts/prepare_irish_simulation.py` reproduces
the vendored source/data from the already-fetched Git commit, using Node's
built-in TypeScript transformation without downloads. It is not necessary for
a normal run when the checked-in runtime modules/data are present.

`test_fire_simulation.py` checks real engine determinism, wind sensitivity,
virtual profile capabilities, input bounds and SHA-256 equivalence. The browser
suite also exercises placement, water rejection, calculation, pause/rewind,
mobile layout and restoration of the original forecast. Those are software
checks, not scientific validation of spread accuracy.

## Team handoff: seven island-of-Ireland forecast sites

The agreed next scope is all seven displayed island-of-Ireland forecast cells:
four in the Republic and three in Northern Ireland. Their coordinates, original
probabilities, snapshot times and cached wind coverage are recorded in
`vendor/irish_simulation/planned_sites.csv` (forecast issued 13 November 2026,
17:00 UTC). These are forecast cells, not seven confirmed fires or an exhaustive
list of places where Irish fires occur.

**Delivered:** the Glendalough simulation, the two-year calendar, and the
WebSocket temperature panel on the existing forecast map. **Not implemented:**
simulation at the seven forecast sites and automatic transfer of their forecast
weather into the simulation. Those seven sites lack prepared local land-cover
and detailed elevation windows; never relocate Glendalough terrain to them.
The plan is one 5 km window per site. No new scientific data were downloaded for
that extension, and no full-island simulation is claimed.

The live panel currently speaks the original receiver protocol on port 2500.
The new webplatform typed snapshot/sensor.reading protocol needs a separate
adapter, including sensorId-to-deviceId mapping and source/context checks.
The remote socket connection was verified, but the real controller was switched
off; receipt of its first actual measurement remains a hardware integration check.

Run the existing map with the already supplied forecast/history caches:

```powershell
.venv\Scripts\python.exe fire_dashboard.py build
.venv\Scripts\python.exe fire_dashboard.py serve --port 8000
```

Forecast/model caches, generated `output/`, the two-year handoff ZIP and `.venv/`
are not included in Git. A fresh checkout needs those existing inputs and the
Python dependencies described above; do not interpret a missing snapshot as zero
risk. The small Glendalough terrain bundle and its engine ARE included. Node 24
must be available for the simulation. Do not download missing scientific data
without the separately agreed scope and approval.
