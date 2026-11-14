# Map service integration handoff

## Current status: arbitrary-location analytical preparation implemented
The sandbox no longer depends on the external map project providing an analytical-area endpoint. `POST /api/sandbox/environment/prepare` uses the existing platform ESA WorldCover/Copernicus COG adapters directly, while regional display tiles continue through the map service on 4177. Numerical preparation supports provider-covered coordinates, dateline-crossing bounds, 1–20 km local widths and an adaptive grid with at most 40,000 cells. The inspector, effective terrain overlay and worker all use the returned immutable snapshot. No map files, schema or services are changed.

Actual compiled HTTP acquisition succeeded for Carpathians (48.4, 24.5) and California (38.5, -122.5), each a 1 km / 1,600-cell area with distinct source classes, elevation ranges and checksums. See `docs/evidence/sandbox-area-live.json` and `scripts/verify-sandbox-areas.ts`. These are actual raster and weather requests, not relocated sample data. Tests additionally cover row orientation, water masks, antimeridian source splitting, adapted resolution, request bounds and independent terrain/weather caching. Coverage gaps remain explicit errors, particularly polar or unavailable raster tiles. Numerical fuels remain illustrative assumptions.

The historical proposed handoff below is retained for context and is no longer a blocker for arbitrary-location sandbox simulation.

Read-only inspection of D:/dryspell/map was explicitly authorized by the user on14 November2026. No map files, database schema, services or configuration were changed. Live GET http://127.0.0.1:4177/api/health returned dryspell-map, real-lod-v1, storage=postgres. GET /api/sample?lat=53.011&lng=-6.33 returned analytical ESA WorldCover tree cover, Open-Meteo weather and Celtic broadleaf forests context. Elevation and moisture were null. This proves point acquisition, not a simulation-ready area.

Existing interfaces: /api/world, /api/sample?lat&lng, /api/sources, /api/tiles/{landcover|ecoregions}/{z}/{x}/{y}.png. Current CORS allows4175/4176, so the sandbox should use its own same-origin adapter rather than weakening the map service. No 40,000-point fan-out or decoding land-cover colors is acceptable.

Required area handoff for the map owner:

GET /api/simulation-grid?west=...&south=...&east=...&north=...&cellSizeM=25

Return an immutable, bounded analytical grid with snapshot ID/checksum, WGS84 bounds, projected metric origin/CRS, width/height, cell size and row orientation (south-to-north rows, west-to-east columns). Per cell return original ESA class code, elevation metres or null, source quality/missing flags and water/barrier information. Preserve source URLs, versions, acquisition/retrieval timestamps, licensing, native resolution and resampling method. Cap initial output at40,000 cells. Do not substitute unknown elevation with zero or regional ecological zone with local fuel type. Endpoint may return202 preparing with retry metadata,503 unavailable, or200 complete snapshot. Unknown cells remain explicit.

Sandbox adapter maps analytical classes to documented surface-fuel assumptions (not sensor measurements), builds LandscapeSnapshot and validates dimensions/coordinates/checksum. Weather comes from a complete UTC-aligned Open-Meteo series. The composite EnvironmentSnapshot ID changes when either source changes. Map overlays, terrain inspector and worker consume that exact snapshot. Styling never enters simulation inputs.

Until this endpoint or an equivalent area snapshot is supplied, the sandbox continues the existing real WorldCover/Copernicus prepared terrain. Arbitrary-area integration with map is visibly pending. The point API currently lacks area elevation and temporal precipitation series; the current-conditions response alone cannot drive deterministic30-minute replay weather. The sandbox's hourly Open-Meteo adapter provides that series.

## Implemented integration update:14November2026
The sandbox now consumes map's real ESA land-cover and RESOLVE ecological-zone tile API through its own same-origin /api/sandbox/map/tiles/{layer}/{z}/{x}/{y}.png adapter. Actual upstream4177 and proxied4001 PNG requests passed. Proxy preserves geometry/alpha and changes only display colors: crops wheat#c6aa66, buildings neutral#8b949b, forest#4c8258, shrub#9daf63, grass#bdd180, water#4f91b5. Ecological colors remain the map project's forest/forest-steppe/steppe palette. Cache is bounded32MiB; requests are deduplicated and bounded12inflight. Provider failure remains visible and the numerical prepared landscape remains usable.

The working area was enriched from a real bounded ESA COG window, preserving original class codes in LandscapeCell.sourceClassCode (data/sandbox/environment.json, checksum4e4b0eb212bd2222534c80ac3357a94b64b2cbdcb0eb17b70a5099e033b8b305). scripts/enrich-sandbox-terrain.ts reproduces the acquisition. Its25m effective grid, water masks, fuel assumptions and DEM elevations are the same snapshot used by the worker/inspector. Source imagery is never decoded into fuel parameters. Regional ecological zones remain labelled regional context, not substituted for local grass/woodland/water classes.

The arbitrary-area grid endpoint described above is still a future handoff: the current numerical area remains the prepared5kmGlendalough fixture. Global map navigation/display now works through the actual map service, but arbitrary placement outside the numerical area is not claimed as simulation-ready. The independent map files, database and services remain unmodified.
