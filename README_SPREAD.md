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
