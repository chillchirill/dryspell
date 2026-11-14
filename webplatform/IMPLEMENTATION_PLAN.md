# Dryspell: Geographic Fire and Sensor Simulator

English implementation plan for Codex CLI. Scientific/data research checked on 13 November 2026. UI skill research and the map-simulator brief revised on 14 November 2026.

## 1. Objective and confirmed decisions

Build a geographic fire-and-sensor simulator: the physical map fills the screen, users place different working sensor objects and ignitions, run a scenario, inspect readings, and rewind time. Terrain, vegetation, water, and weather affect the simulation. The first useful interaction is placing and running objects directly on the map.

The same platform also receives future real sensor readings, manages their locations, and estimates current fire location and future spread from observations and environmental data. Preserve live updates, historical charts, a rewindable timeline, and a probability layer without turning the main interface into a dashboard. Simulation must exercise the detection algorithm, not merely draw an expanding circle.

The Packet Tracer comparison describes direct manipulation of objects and simulation controls only. Network topology, device links, protocols, radio simulation, and changes to the independent IoT project are outside scope.

| Topic | Decision |
| --- | --- |
| Primary UI | Full-viewport physical map with a compact object palette, contextual inspector, and bottom time controls. Simulation opens first. |
| Sensor objects | Combined, temperature-only, humidity-only, and smoke-only simulated profiles; extensible measurement capabilities. |
| Geographic coverage | No fixed country. An administrator can select an area anywhere supported by the data providers. |
| Initial network | Up to 30 sensors. This is the initial acceptance-test workload, not a permanent product limit. |
| Smoke reading | A numerical index from 0% to 100%, with an optional `smoke` boolean. |
| Application stack | Node.js, Express, React, WebSocket, local PostgreSQL in Docker. |
| Frontend delivery | Compile React and serve the production assets from Express. |
| Public application port | TCP 4000 for HTTP and WebSocket on the same server. |
| Machine learning | A small TensorFlow model, with reproducible training and evaluation on real historical data. |
| Administration | One administrator account configured in a server-side JavaScript file. Only the administrator can change stored map content or configuration. |
| Deployment | Ubuntu, shell scripts, systemd service files, database persistence, health checks, and port configuration. |
| Reference server | Approximately 3 GB available RAM and 2 CPU cores. Measure and tune deployment for it; do not remove requested features because of this reference. |
| Repository boundary | All new application work belongs in `webplatform/`. `iot/` is an independent project and must not be inspected, modified, migrated, restarted, or incorporated into this application. It may send data to the new API in the future. |

This document is a plan, not a claim that the application, model, deployment, or tests already exist.

### Working defaults

These choices allow implementation to proceed without further blocking questions. Expose them as configuration where appropriate:

- Public read-only simulation/replay and live views; administrator login for persistent changes. Open on the Simulation map, with a clearly labelled prepared example when no scenario is selected.
- English UI initially, with all user-facing strings organized for later Ukrainian translation.
- A 5 km by 5 km initial simulation area, a 25 m simulation grid, and a 6-hour detailed forecast. Allow other areas, resolutions, and horizons through scenario settings.
- A separate 24-hour ML forecast at its supported spatial resolution.
- One expected measurement per minute per real sensor by default; the expected interval is configurable per device, including much longer intervals for battery-powered devices.
- Synthetic readings every 5 seconds of simulation time, independent of playback speed.
- Raw real telemetry retained for 90 days; hourly aggregates retained for one year. Make retention configurable and disclose it in administration.
- In-app alerts and an incident history. Email, SMS, and push delivery are separate extensions.

## 2. Essential modelling distinctions

1. **Simulated ground truth:** the simulation engine knows where the administrator placed an ignition and how the simulated fire evolves.
2. **Sensor observations:** simulated devices report weather-based readings with noise and fire effects. Real devices report actual measurements. Both use the same validation and detection logic, in separate data contexts.
3. **Estimated fire state:** the inference engine receives observations, weather, terrain, and permitted satellite evidence. It must not receive hidden simulation ignitions or ground-truth fire rasters.
4. **Future forecast:** propagation of the estimated state under weather forecasts and uncertain model parameters.

Keep these concepts separate in modules, storage, API responses, and map legends. A comparison view may display ground truth beside an estimate, but it must not feed that truth into inference.

Treat `smokePct` as a normalized sensor response, not a percentage of the air composed of smoke or a substitute for PM2.5 concentration. Store calibration metadata and sensor model information when available.

Implement 70 degrees Celsius as the requested default **critical temperature alarm**. It does not independently establish a real wildfire with mathematical certainty. Temperature anomaly, smoke, trends, neighbouring observations, and device quality determine the evidence score. A manual confirmation is a separate recorded action.

Likewise, a red forecast means high model-estimated probability. Display exact 100% only for a known simulated state or an explicitly identified observation/confirmation whose meaning is clear. An ensemble in which every member agrees is not proof of certainty.

## 3. Architecture and libraries

Use a TypeScript npm workspace within `webplatform/`; the executable services still run on Node.js. Keep the administrator configuration as a private `.cjs` file to satisfy the JavaScript configuration requirement.

| Component | Choice and responsibility |
| --- | --- |
| Web/API server | Express, `ws`, Zod validation, structured logging. Serve REST, static React assets, sessions, and WebSocket upgrades on port 4000. |
| Client | React and Vite; TanStack Query for server state; TanStack Table for the sensor list, sorting, and filter state. |
| UI foundations | Radix Primitives for accessible interactions, CSS Modules and shared CSS tokens for Dryspell's own visual system; Lucide React for one consistent icon family. |
| Mapping | MapLibre GL JS with physical terrain/land-cover presentation, GeoJSON objects, and fixed-scale fire/probability overlays. An explicit interaction controller handles selecting, placing, and moving sensors/ignitions without conflicting with map navigation. |
| Charts | Apache ECharts: three synchronized time series with zoom, missing-data gaps, threshold markers, and shared cursor. |
| Database | PostgreSQL with `pg`, SQL migrations, and PostGIS for locations, areas, and spatial queries. Use one PostgreSQL container with a persistent volume. |
| Analysis worker | A separate Node.js process for simulation, inference, environmental imports, and TensorFlow inference. |
| Background jobs | A PostgreSQL jobs table with leases, retries, and transactional claiming. No extra queue service is required initially. |
| ML | Prefer `@tensorflow/tfjs-node` on a tested Node LTS version. Keep a tested TensorFlow.js CPU fallback if native bindings are unavailable. |
| Geometry/raster helpers | Turf/proj4 for geographic operations; a GeoTIFF reader for windowed environmental data access. |
| Testing | Vitest, Supertest, and Playwright. Use a separate test database. |

TensorFlow's native Node bindings can block the calling thread; they belong in the analysis worker, not the HTTP request path [T1]. Node 24 LTS is a reasonable initial compatibility target; verify the selected runtime and TensorFlow combination on Ubuntu and pin the working versions [T2].

The web process commits incoming telemetry before acknowledging it. A transactional outbox carries notifications and analysis work. The worker claims jobs, writes versioned outputs, and the web process distributes updates. A worker restart must not lose accepted observations.

Python is permitted for an offline dataset converter where NetCDF/HDF5 or TFRecord tooling makes it substantially simpler. It must not become a second always-on web backend without a demonstrated need.

## 4. Researched sources and acquisition tasks

All providers must have adapters. Store provider name, source URL, dataset version, request parameters, spatial and temporal resolution, observation/valid time, forecast issue time where available, retrieval time, licence/attribution, and checksum.

| Source | Required use | Acquisition and limitations |
| --- | --- | --- |
| Open-Meteo Forecast API [D1] | Ambient temperature, relative humidity, wind speed/direction/gusts, precipitation; optional soil moisture. | Fetch a bounded set of weather grid locations for the selected area. Cache results, request explicit units, and interpolate only for presentation/simulation. |
| Open-Meteo Historical Weather and Single Runs APIs [D2, D3] | Historical scenario weather; forecast replay using weather available at the original forecast time. | Reanalysis is useful for retrospective reconstruction. Archived individual forecast runs are preferable for evaluating an actual forecast without future-data leakage. |
| NASA FIRMS [D4, D5] | Satellite hotspot layer, historical event discovery, optional additional evidence. | Use the area CSV API with a server-side `FIRMS_MAP_KEY`. Check product availability and chunk requests by supported date ranges. Keep observation time distinct from ingestion time. |
| NASA VIIRS fire-mask products [D6] | Coverage-aware labels for regional ML training and evaluation. | Use classified fire/no-fire/unknown/cloud pixels, QA, and the required geolocation data. A missing FIRMS hotspot alone is not a negative training label. |
| ESA WorldCover [D7] | Global land-cover categories used to initialize fuel profiles. | Read only relevant windows of Cloud Optimized GeoTIFFs. Use analytical class values, not RGB map imagery. The 2020/2021 products have 10 m nominal resolution and are historical snapshots. |
| OpenStreetMap via Overpass [D8] | Supplementary woodland, grassland, scrub, water, buildings, and mapped barriers. | Query bounded areas and cache results. Preserve attribution and source tags. Do not scrape map screenshots or assume missing tags mean no vegetation. |
| Copernicus DEM [D9] | Elevation, slope, aspect. | Read relevant raster windows; record coverage gaps. This is a surface model, so vegetation/buildings can influence heights. |
| Next Day Wildfire Spread [R4] | Published benchmark for a simple ML baseline. | Use the authors' dataset and extraction workflow. Its daily, approximately 1 km task cannot validate a 25 m, minute-by-minute forecast. |

Open-Meteo's free hosted API currently has non-commercial-use conditions and rate limits; make its provider configuration replaceable if the product becomes commercial [D10]. OpenStreetMap data availability does not imply unrestricted use of the community tile servers; configure the basemap provider and attribution separately [D11].

FIRMS VIIRS detections have approximately 375 m nominal pixels, and a detection does not mean the entire pixel is burning [D5]. Do not turn points into exact fire perimeters, treat brightness temperature as ambient air temperature, or interpret satellite confidence classes as calibrated wildfire probabilities. Satellite acquisition is intermittent; a six-minute swath product is not six-minute coverage of every location [D6].

### Import tasks

- Implement `weather`, `historicalWeather`, `firms`, `landCover`, `osm`, and `elevation` adapters with bounded retries, timeouts, cancellation, and rate-limit handling.
- Support antimeridian-crossing bounding boxes by splitting provider requests. Perform simulation geometry in a suitable local metric projection, including high-latitude handling.
- Schedule weather refreshes according to provider/model cadence, not one network request per sensor tick.
- Store immutable environmental snapshots for scenarios and prediction runs. Mark stale cached data and missing values explicitly.
- Support a small, redistributable sample-data bundle for installation and offline E2E tests, with its own manifest and attribution. Clearly label it as sample data.
- Do not download worldwide rasters or historical archives just to run one local scenario.
- If NASA credentials are absent, keep the adapter and import commands functional, report the unavailable live source, and continue with the public benchmark/sample bundle. Do not claim a live satellite integration was verified with fixtures.

## 5. Sensor management, permissions, and ingestion

### Sensor record

Store an immutable internal ID, unique external `deviceId`, display name, real/simulated source, coordinates, optional elevation, sensor `profileId`, declared measurement capabilities, hardware/calibration profile, expected reporting interval, tags, enabled state, and creation/update timestamps.

The default simulated profile reports temperature, humidity, and smoke. Also provide temperature-only, humidity-only, and smoke-only profiles with actual channel-specific outputs. Profiles configure sample interval, noise, bias, and response settings; they are simulator configuration, not a requirement to change external hardware. Keep unsupported, missing, stale, and zero-valued measurements distinct. Real-device capabilities are configured metadata and must not cause the platform to invent readings.

Administrator actions:

- Create a real sensor manually or place a simulated sensor on the map.
- Edit metadata, location, calibration, and expected reporting interval.
- Move a marker with a visible Save/Cancel step and numeric coordinate fields.
- Disable, archive, restore, and delete a sensor through an explicit data-retention choice. Archive by default when telemetry exists; offer deliberate permanent deletion with affected-record counts.
- Create and edit scenario areas, ignition events, fuel overrides, and model settings.

Keep effective-dated location history. Moving a device today must not move yesterday's observations. Do not allow incoming telemetry to reposition a sensor or create an administrator account.

### Administrator configuration

Use a server-only file such as `/etc/dryspell/admin.config.cjs` containing the username and a salted password hash. Generate the hash using Node's built-in password-derivation facilities. Never put credentials or hashes into the React bundle, public directory, public configuration endpoint, or browser storage.

Use a server-side session with an HttpOnly cookie, expiry, logout invalidation, login throttling, and CSRF/origin checks for mutations. Require backend authorization on every mutation, including WebSocket commands if any exist. Hiding edit controls is only a UI convenience.

Give devices or gateways separate ingestion credentials scoped to registered device IDs. Store credential hashes, allow revocation, and never reuse the administrator password for telemetry. A gateway may submit for an explicit allowlist of devices.

### Telemetry contract

Canonical endpoint: `POST /api/v1/telemetry`.

Example payload, with all numbers expressed in the units implied by their field names:

```json
{
  "deviceId": "sensor-001",
  "messageId": "boot-a7:1842",
  "recordedAt": "2026-11-13T12:00:00Z",
  "temperatureC": 24.6,
  "humidityPct": 61.2,
  "smokePct": 8.4,
  "smoke": false,
  "batteryVoltage": 3.7,
  "extra": {
    "coPpm": 0.6
  }
}
```

Rules:

- Require a registered `deviceId` and at least one valid measurement. Support partial packets; missing values remain missing and never become zero.
- Require finite numerical values; enforce humidity and smoke ranges of 0–100 inclusive. Use hardware-profile temperature ranges rather than rejecting every reading above 70 degrees.
- `smoke` is optional. Preserve it as the device-reported boolean separately from the server's inferred alarm state. Do not invent `smokePct` from a boolean.
- Preserve `recordedAt`, server `receivedAt`, clock-quality flags, source, schema version, and location version. If the device lacks a clock, accept an omitted timestamp and mark server-time substitution.
- Use `(deviceId, messageId)` for idempotency when supplied; document the weaker guarantee when no message ID exists. Device reboots must not create duplicate sequence identities.
- Apply explicit limits to clock skew, packet size, batch size, and `extra` field depth. Accept delayed readings within the retention policy, without replacing newer latest-state records.
- Return success only after the database commit. Distinguish accepted, duplicate, rejected, and temporarily unavailable requests so devices can retry correctly.
- Provide `POST /api/v1/telemetry/batch` with per-item results and bounded batch size for buffered gateway uploads.
- Document an optional alias-normalization adapter for future producers using names such as `temperature`, `humidity`, or `id`. This is part of the new platform and does not require changes to `iot/`.

Real telemetry credentials cannot select `source=simulated` or write into a scenario. Simulation readings enter the same domain validation path through an internal scenario-scoped interface.

### Other API groups

| Routes | Purpose and access |
| --- | --- |
| `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/session` | Administrator session lifecycle. |
| `GET/POST /api/v1/sensors`, `GET/PATCH/DELETE /api/v1/sensors/:id` | Read and administer sensors; mutations require administrator access. |
| `GET /api/v1/sensors/:id/readings` | Time-bounded history, cursor pagination, aggregation resolution, and quality metadata. |
| `/api/v1/scenarios` and scenario action routes | Create, clone, edit, run, pause, stop, and inspect a scenario; mutations require administrator access. |
| `GET /api/v1/scenarios/:id/state?at=...` | Seek a recorded scenario without changing its authoritative simulation clock. |
| `GET /api/v1/environment` | Weather/terrain data and provenance for a bounded area and time. |
| `POST /api/v1/predictions`, `GET /api/v1/predictions/:id` | Request an analysis job and inspect its versioned status/result. Bound and authorize expensive job creation. |
| `GET /api/v1/incidents`, administrator incident actions | Evidence, alarm state, acknowledgement, and explicit confirmation. |
| `GET /api/v1/sources` | Data provenance, model version, supported forecast scale, and attribution. |
| `/health/live`, `/health/ready` | Process health and database readiness; show worker/provider degradation separately. |

Publish an OpenAPI specification and device-ingestion examples.

## 6. Live delivery and persistence

WebSocket endpoint: `/ws`, sharing the HTTP server on port 4000.

Use typed envelopes containing `eventId`, monotonically ordered stream cursor, event type, context/scenario ID, event time, and payload. Events include `sensor.reading`, `sensor.status`, `sensor.updated`, `incident.updated`, `prediction.updated`, `scenario.progress`, and `source.status`.

Default workspace subscriptions cover all 30 sensors in the selected context. Support subscriptions by context/device/area without leaking simulation data into live views. Filter changes affect visibility, not whether the database records incoming measurements.

On connection, establish a consistent snapshot/cursor boundary and deliver subsequent events. On reconnect, resume from a retained cursor or require a fresh snapshot. Deduplicate replayed events. Add ping/pong, exponential reconnect backoff, bounded send buffers, and slow-client handling.

Use a database transaction for telemetry, latest-state updates, and outbox entries. Acknowledged data survives a process restart even if WebSocket delivery happens later. PostgreSQL notifications may wake consumers but must not be the only durable event store.

Core entities:

| Entity | Main contents |
| --- | --- |
| `sensors`, `sensor_locations`, `device_credentials` | Identity, profile/capabilities, effective-dated geometry, calibration, reporting intervals, authentication. |
| `telemetry`, `sensor_latest`, `telemetry_hourly` | Immutable readings, cached current values, aggregates with min/max/count and gaps. |
| `incidents`, `incident_evidence`, `audit_log` | Alarm transitions, contributing readings, acknowledgement, administrator changes. |
| `scenarios`, `scenario_versions`, `scenario_events` | Area, clock, random seed, ignition/weather edits, immutable revision history. |
| `simulation_checkpoints`, `simulation_readings` | Versioned state snapshots and generated observations, isolated from real telemetry. |
| `environment_snapshots`, `external_detections` | Versioned inputs and satellite observations with provenance. |
| `analysis_jobs`, `prediction_runs`, `prediction_frames` | Job state, inputs, output metadata, compressed spatial frames. |
| `model_versions`, `dataset_manifests` | Feature schema, training lineage, metrics, calibration, supported domain. |
| `sessions`, `event_outbox` | Login sessions and durable delivery. |

Index `(sensor_id, recorded_at)`, source/context/time, job status, and spatial geometry. Keep large grid frames compressed in a managed data directory with database metadata, hashes, atomic writes, and coordinated backup. Do not store a JSON object per cell per animation frame. Introduce telemetry partitioning only when measured volume warrants it [T3].

## 7. Map simulator: frontend design and UX specification

**The primary product is a minimal geographic simulator. The physical map is the workspace and background. A user places working sensor objects, places fire, runs time, and observes what happens.** This requirement supersedes the earlier monitoring-dashboard composition.

The Packet Tracer analogy applies only to choosing, placing, configuring, and running objects in a shared workspace. Do not copy its styling or implement network topology, links, routing, packet transport, radio coverage, or device firmware. Real IoT integration remains an external telemetry contract.

### 7.1. Design research and skill selection

Read [UI_DESIGN_RESEARCH.md](UI_DESIGN_RESEARCH.md) before substantial frontend work. It compares six candidates using their upstream instructions and separates visual direction, implementation, and verification. It is a project-fit assessment, not a benchmark proving which model or skill makes the best designs.

Use a small, deliberate sequence:

1. **Composition:** use Anthropic's `frontend-design` [U1] with this map-simulator brief. Read the complete source and follow its relevant references. The actual landscape and object interactions are the subject-specific design material.
2. **Focused refinement:** consult Impeccable's Operate and simplification guidance [U9] when controls become crowded or generic. Treat it as a secondary design reference, or explicitly use its full workflow if installed; do not claim to have run its tooling from reading the documentation.
3. **Implementation review:** use Vercel's `web-design-guidelines` [U10] on the implemented frontend, followed by actual browser and Playwright checks. Code review does not establish visual originality.

Use only relevant guidance at each stage. Do not load every researched skill or combine competing visual defaults. UI UX Pro Max is an optional lookup for a specific interaction/chart issue; the researched Taste skill and image-led website workflows do not set this simulator's structure.

Record source URLs, reviewed revision/checksum, access date, and any unavailable tools in `docs/DESIGN_REFERENCES.md`. Preserve licences for retained packages. Reading a source is not installing it, and a local installation does not install it on the Ubuntu host. This document authorizes normal design decisions without a new approval checkpoint.

### 7.2. Design direction and originality requirement

**Direction: a physical landscape with a small set of precise simulation instruments.**

Open directly onto real geography: relief, vegetation, water, place names, and the selected simulation boundary. The map fills the viewport behind the controls. Avoid a white page surrounding a map card, permanent dashboard sidebars, statistic-card grids, decorative illustrations, marketing sections, and a full-screen welcome page.

Distinctiveness comes from three connected choices:

- Terrain and effective land cover are visible at working scale, with sensors and fire embedded in that geography.
- The object palette, placement preview, selected-object annotation, and compact inspector share one custom symbol and alignment system.
- The bottom transport connects fire progression, sensor detection events, and the selected moment through one readable time scale.

Build two small studies of the **same** scenario: a narrow floating tool strip and a compact object shelf. Both must retain the full map, the same controls, and the same data. Compare the actual placement and inspection flow, then choose one. The floating strip is the default if both work equally well. Do not build two complete applications or delay implementation waiting for an unsolicited style approval.

Changing a font, colour, corner radius, or dark-mode flag alone does not satisfy the originality requirement. Review the chosen screen without its logo: it should still communicate a terrain-based sensor/fire simulator. Familiar usable controls are welcome; unnecessary novelty is not a goal.

### 7.3. Visual system and component styling

Define semantic tokens after choosing the composition. The following are roles and constraints, not a preselected dashboard theme:

| Role | Requirement |
| --- | --- |
| Main background | Actual geographic map data, extending to all viewport edges. No generated landscape image or blank white canvas. |
| Landscape | Readable relief and restrained natural land-cover colours. Analytical land-cover tint must correspond to the effective scenario inputs. |
| Floating controls | Compact opaque or nearly opaque mineral/charcoal surfaces with clear text. Verify contrast over bright water, dark woodland, and fire overlays; do not depend on blur. |
| Selection | One cool accent plus a distinct ring/outline, separate from heat and probability colours. |
| Fire and probability | Warm semantic scale with a fixed labelled legend; active fire, burned land, and estimated probability have distinct treatments. |
| Sensor readings | Consistent temperature, humidity, and smoke colours in markers, values, and charts; always include units. |
| Typography | One readable interface family, with optional monospace for IDs/coordinates only. Tabular numerals for changing readings. IBM Plex [U4] is a candidate, not a substitute for art direction. |
| Geometry | Compact grouped tools, deliberate separators, and one context panel. Avoid a separate rounded card around every value. |

Create matching CSS tokens, MapLibre styles, and ECharts themes. Self-host licensed font subsets with Latin and Cyrillic support. Start with 14–16 px ordinary text, readable secondary metadata, and a 4 px spacing basis; reflow rather than shrinking important labels.

Use Radix Primitives for interaction behaviour [U3], styled for this product through CSS Modules. Keep a consistent icon family. Sensor-type symbols may be simple custom SVGs sharing the same stroke and proportions. Icons have accessible names and discoverable labels. Only actual sensor identities and meaningful time ticks receive numerical labels.

Motion explains placement, selection, and time progression. Do not add cinematic camera movements, mandatory entrance animations, decorative particles, or glowing alarms. Wind animation is optional and has a static alternative.

### 7.4. One workspace and explicit contexts

The entry route opens the **Simulation** map, restoring the last scenario or showing a clearly labelled sample scenario. A new blank scenario is also available. Public visitors can inspect and replay published/saved scenarios; administrator login enables persistent edits.

Keep a compact context selector for **Simulation / Live / History**. These share the map, selection, charts, and layers. Live telemetry remains supported, but the application does not open on a separate dashboard.

| Workspace state | Visible controls and content |
| --- | --- |
| Nothing selected | Map, compact scenario/context control, object tools, transport, essential map controls. |
| Placing an object | Active tool label, placement preview, cancel action, and brief placement guidance. |
| Sensor selected | Selected marker and one inspector with readings, plots, and relevant edit actions. |
| Ignition selected | Ignition position, start time, state, and scenario edit actions. |
| Inspecting terrain | Local land cover, elevation/slope, fuel assumption, source resolution, and missing-data state. |
| Running or replaying | Fire progression, changing sensor readings, current time/speed, and optional estimate comparison. |

Open Sensors, saved scenarios, incidents, source details, and settings from a compact menu into a drawer or focused dialog. Do not introduce six permanent navigation destinations or leave a sensor table open by default. Preserve map camera, selection, and time when opening and closing tools.

Store non-sensitive view state in the URL where useful. Show the context and scenario revision clearly. A future estimate includes its issue time; simulated readings never carry an unqualified Live label.

### 7.5. Layout and responsive behaviour

The map canvas occupies the full viewport. UI controls float over it; there is no page gutter, card container, or empty application background.

| Region | Desktop starting point | Behaviour |
| --- | --- | --- |
| Scenario/context control | Compact top-left group, about 40–48 px high | Scenario name, context, save state, and menu. Account controls stay secondary. |
| Object tools | Narrow floating strip, roughly 48–56 px wide | Select, Add sensor, Add fire, Inspect terrain. Sensor profiles expand from Add sensor. |
| Environment/layers | Small top-right group | Wind summary and Layers; detailed settings open on demand. |
| Selection inspector | One panel, about 340–400 px wide | Closed initially; sensor/ignition/terrain content shares the same panel. |
| Transport | Bottom strip, roughly 64–80 px high | Run/playback controls, time, speed, and scrubber; event tracks expand on demand. |
| Map utilities | Small unobtrusive group | Zoom, north/reset bearing, scale, attribution, and active-layer legend. |

At 1440×900 and 1280×800, target at least 80% unobscured map area with no selection and 60% while inspecting an object. These are composition targets checked on captures, not an excuse to shrink text or hide required controls. Keep the selected object and a useful surrounding area visible.

Only one major inspector/list drawer is open at a time. On tablets, collapse tool labels or use a shelf. On mobile, use a compact top control, an expandable tool shelf, and an inspector bottom sheet with explicit expand/close buttons. A tall chart sheet may temporarily cover more map, but closing it restores the same position and time.

Check 1440×900, 1280×800, 768×1024, and 390×844, plus 320 CSS px reflow and 200% zoom. Preserve touch placement and numeric coordinate entry. Avoid horizontal page scrolling and collisions between the sheet, transport, attribution, and on-screen keyboard.

### 7.6. The physical map must affect the simulation

Visual terrain is a required working input, not scenery. Map imagery and numerical environmental data have separate responsibilities:

| Visible feature | Numerical source | Effect in the baseline |
| --- | --- | --- |
| Woodland, grassland, scrub/mosaic | WorldCover and bounded OSM enrichment [D7, D8] | Fuel profile, burnability, moisture assumptions, and spread response. |
| Hills and slopes | Copernicus DEM [D9] | Elevation, slope, aspect, and directional spread adjustment. |
| Water and designated non-burnable areas | Effective land-cover/barrier masks | Block local surface-fire propagation. |
| Wind direction and speed | Weather snapshot or labelled scenario override [D1–D3] | Directional spread and smoke transport. |
| Temperature, humidity, recent rain | Same time-aligned weather snapshot | Ambient sensor readings and documented moisture/drying effects. |

Use a consistent path: **provider data → immutable environment snapshot → effective simulation grid → engine outputs and map overlays**. Include environment ID, scenario revision, valid time, and resolution in the response contract. The terrain inspector reads the effective grid used by that run.

The default physical basemap shows relief and recognizable geography. Within the active area, provide the effective land-cover/fuel overlay so the user can inspect what the engine actually uses. If imagery and older classified data disagree, identify the source/date difference and expose the effective input rather than silently inferring fuel from image colours.

Switching basemap style, hiding a layer, or changing hillshade opacity must not alter the simulation. An administrator's scenario-only fuel or weather override changes the model input, is visible as an override, and creates a new revision. Hiding trees visually does not remove fuel.

Display dataset resolution and unknown cells honestly. Do not substitute flat terrain or grass everywhere without an explicit fallback label. A new area shows preparation/coverage state before Run; allow a clearly labelled prepared sample to demonstrate the workflow when providers are unavailable.

Start with a top-down physical map and hillshade. 3D terrain is optional presentation, not a prerequisite. Do not treat every road as a perfect firebreak or implement network/radio physics. The analytical rules and their limitations remain in section 9.

### 7.7. Sensor objects, fire objects, and direct manipulation

Provide working simulated sensor profiles, not several decorative icons for the same behaviour:

| Palette profile | Reported measurements |
| --- | --- |
| Combined sensor | Temperature, humidity, and smoke index; the default. |
| Temperature sensor | Temperature only. |
| Humidity sensor | Humidity only. |
| Smoke sensor | Smoke index, with an optional configured boolean threshold. |

Profiles declare supported measurements, units, sample interval, bias/noise, and response settings. Missing or unsupported channels remain distinguishable from zero. All profiles use the same scenario clock and sensor-response engine. The inference engine must handle partial evidence. New capabilities can be added through configuration without inventing or modifying physical hardware.

Primary administrator journey:

1. Open or create an area on the map; prepare its environment with sensible defaults.
2. Choose Add sensor and a profile; click the map to place it. Generate an editable default name and ID. Keep detailed calibration optional.
3. Choose Add fire and click a burnable point. Default the ignition to scenario start; expose scheduled ignitions in its properties.
4. Press Run. Sensor readings and fire advance from the same simulation state.
5. Select a sensor to inspect its response, pause, seek backward, or compare the estimated fire with simulated truth.

A simulation placement can save immediately with a visible pending state; do not open a mandatory long form per object. Failed persistence leaves a recoverable pending placement and does not claim success. Real-sensor creation additionally requires its external device ID.

Use explicit tool state: Select, Place sensor, Place ignition, Inspect terrain, or Move selected object. Escape cancels the active placement/move; clicking ordinary empty map deselects. Map panning and control clicks never create objects. Drag placement may be an enhancement, but click-to-place and coordinate entry must work.

Moving an existing object shows its original/proposed position and Save/Cancel. Provide Undo for draft placement/edit operations; undoing a committed change creates a recorded revision, never deletes telemetry history. Editing a completed/running scenario creates a new draft revision; show that it must be rerun. Warn about ignition on unknown terrain and reject ignition on a confirmed non-burnable cell.

Use marker symbols for profile, shape/outline for real versus simulated, and a separate selection ring. An alert stays recognizable over red fire shading. Overlapping sensors open an explicit selection list. Auto-updates never reposition the camera unless Follow was deliberately enabled.

### 7.8. Selected-object inspection, charts, and filters

Keep detailed information contextual. A sensor inspector contains:

1. Name, profile, source/context, coordinates, and observation time.
2. Three aligned reading slots with units. Unsupported channels say Not supported; missing measurements say No reading.
3. Temperature, humidity, and smoke history on aligned plots, with only supported channels plotted.
4. Alarm/detection events and an optional evidence explanation.
5. Collapsed metadata/calibration and administrator edit actions.

Use a shared time axis and cursor. Keep humidity/smoke on 0–100 scales; temperature shows its units and visible scale. Mark the weather baseline and alarm threshold. Preserve peaks, missing-data gaps, and freshness; do not interpolate misleading readings. Historical range controls are available when needed. Live follow pauses when the user deliberately explores older data.

Use one shared filter model for the map and an optional TanStack Table sensor drawer [T6]. Support ID/name, profile, source/context, state/freshness, measurement ranges, map area, tags, and land cover. Advanced filters stay behind Filters. Show active-filter count, matching count, and Clear all; never hide a selected object without explaining the filter mismatch.

Thirty sensors do not require a permanently visible fleet-management table. Keep the optional list usable when WebGL fails and provide keyboard selection and accessible chart-value tables.

### 7.9. Time, fire visibility, and prediction layers

The bottom transport is always easy to reach. Include current timestamp/time zone, run or playback state, speed, step controls, and a rewindable slider. Expand event tracks for ignition and sensor-detection times on demand.

Separate authoritative scenario execution from a viewer's replay cursor. Administrator Run/Pause run affects that scenario; replay Play/Pause only moves the viewer's recorded-time cursor. Label these states clearly and never pause another user's run merely because a viewer inspects history. Playback speed must not change the deterministic fire or sensor results.

While scrubbing, preview the target time promptly, cancel obsolete requests, and apply a complete matching frame. Map fire, sensor readings, chart cursor, weather, and estimates must share scenario/revision/time. Incoming live telemetry never pulls a historical viewer back to now.

In Simulation, show simulated fire by default so the experiment is observable. Distinguish active burning from burned area. Offer an explicit **Fire / Estimate / Compare** control when estimates exist. Keep simulated truth out of the inference inputs.

Prediction choices distinguish current burning, reached-by-time, and possible origin. Use fixed probability legends and clear unknown regions. Optional wind, temperature, satellite detections, and analytical landscape layers live under Layers. Temperature and fire-probability filled rasters are mutually exclusive by default; wind vectors can accompany either. Satellite points are not exact fire perimeters.

### 7.10. Saving, permissions, and recovery

Persistent placements, moves, scenario edits, real-device metadata, and administrator settings require server-enforced login. Anonymous users can inspect and replay permitted data. A small login action explains why editing is unavailable without replacing the map with a login page.

Show scenario draft/saving/saved/error state. Keep failed edits available for correction or retry. Preserve drafts through session expiry and restore their context after login. Archive real sensors with history by default; deliberate permanent deletion names the device and affected data.

Creating a scenario uses one short setup panel and direct map placement. Advanced fuel/model settings remain collapsed. Saved scenarios open from a menu; they are not a separate card-gallery home page.

### 7.11. Loading, empty, failure, and alert states

| State | Required behaviour |
| --- | --- |
| First load | Keep the map/workspace structure visible with a bounded loading state. |
| Empty scenario | Show brief Add sensor / Add fire guidance on the map; leave tools usable. |
| Environment preparing | Show progress/coverage and explain Run availability. |
| Unknown terrain or stale weather | Identify the missing/stale input and any explicit fallback affecting the run. |
| No readings yet | Waiting state, without fabricated zero charts. |
| Disconnected real sensor | Preserve last reading and time, separate from fire evidence. |
| Reconnecting socket | Keep the current map and selected time; reconnect without duplicate events. |
| Save failed | Preserve the pending object/draft and expose retry/cancel. |
| Prediction delayed | Keep the previous result with its issue time and update state. |
| Critical reading | Persistent sensor/event indication with an Inspect action; no per-tick toast flood. |
| Map unavailable | Usable sensor list/charts, coordinate input, and a clear map error. |

Distinguish connection health, alarm severity, and model freshness. Acknowledgement does not clear measurements or confirm a real wildfire. Keep provider/API/worker details in source/diagnostic panels rather than the main tool labels.

### 7.12. Accessibility and motion

Support the complete core flow with keyboard controls and numeric coordinate entry. Provide readable labels, accessible names, focus restoration, and a list alternative to spatial selection. Shortcuts must not intercept text-field typing.

Target WCAG 2.2 AA [U5–U7]. Check actual text and controls over varied terrain backgrounds. Use at least 24×24 CSS px targets or the applicable spacing accommodation; prefer roughly 44×44 px for primary touch actions. Focus stays visible above panels and transport controls.

Colour never carries status alone. Fire, estimate, sensor profile, selection, and unknown data need complementary symbols, boundaries, or text. Respect reduced-motion preferences and provide static wind vectors. Announce meaningful state changes, not every simulated sample.

### 7.13. Frontend boundaries and state ownership

| Module | Responsibility |
| --- | --- |
| `SimulationWorkspace`, `ContextControl` | Full-map composition, context, scenario, and revision identity. |
| `TerrainMap`, `LayerControls`, `MapLegend` | Map lifecycle, physical/analytical layers, overlays, and legend. |
| `ObjectPalette`, `PlacementController` | Sensor profiles, ignition placement, selection/move modes, pending edits. |
| `ObjectInspector`, `TerrainInspector` | Contextual properties and effective environmental inputs. |
| `SensorInspector`, `TelemetryCharts` | Readings, supported channels, history, evidence. |
| `Timeline`, `PlaybackController` | Run state, viewer cursor, events, and synchronized frames. |
| `SensorDrawer`, `ScenarioMenu`, `SettingsDialog` | Secondary list, saved scenarios, and configuration. |

Use TanStack Query for server data. Separate transient selection, camera, active tool, open panel, and viewer cursor. One controller owns context/time; another explicit state machine owns placement, so overlapping handlers cannot create an object while panning.

Keep MapLibre mounted, patch source data, batch frame updates, and clean up subscriptions. Cancel stale queries: a late response for sensor A cannot overwrite sensor B. Do not rebuild terrain layers for every telemetry sample.

The first implementation should demonstrate the complete place → run → read → rewind flow. Development fixtures may support composition, but final acceptance requires real application persistence, the simulation worker, WebSocket updates, and charts wired together.

### 7.14. Deliverables and design gates

Implementation must produce:

- `docs/DESIGN_REFERENCES.md`: reviewed skill sources, chosen composition, rejected alternative, and font/icon/data licences.
- `docs/DESIGN.md`: the selected canvas composition, semantic tokens, object symbols, control states, and responsive rules.
- Browser captures of empty placement, selected sensor, running fire, terrain inspection, replay/estimate comparison, and mobile use.
- `docs/UX_REVIEW.md`: actual journeys, viewport checks, visual defects/fixes, and remaining limitations.

**Composition gate:** the initial screen is an expansive physical map with a small toolset, not a dashboard with a large map card.

**Identity gate:** the design has a coherent object-symbol system, placement/selection treatment, and terrain/time presentation. A generic dashboard recoloured green or black fails even if its controls function.

**Interaction gate:** every visible primary tool works; the user completes placement, ignition, run, inspection, and rewind without navigating away from the map.

**Environment gate:** shown effective terrain agrees with the run's inputs, and changing those inputs changes the model as specified. A decorative terrain background fails.

**Quality gate:** no blocking keyboard/touch, contrast, overlay-collision, unreadable-chart, or stale-context defects.

Review the first rendered composition before expanding secondary UI; revise the structure if it fails. Perform another complete review after integration. Record remaining issues honestly; do not substitute an automated screenshot match or a subjective 10/10 score for these gates.

### 7.15. Browser acceptance journeys

Use a prepared, attributed landscape fixture with grassland, woodland, a slope, and a water barrier. Seed realistic sensor states and deterministic time.

- From the map, place combined, temperature-only, humidity-only, and smoke-only sensors; reload and verify profiles, locations, and supported channels.
- Place an ignition, run, inspect gradual heating and downwind smoke, pause/replay, seek backward, and reproduce the same readings.
- Inspect a terrain point and verify that its visible class/slope and snapshot ID match the engine inputs.
- Compare otherwise identical runs with changed wind, fuel, or slope; verify the documented directional/arrival-time differences. Hiding the landscape layer must leave results unchanged.
- Attempt ignition on water; receive useful feedback and keep the placement tool usable.
- Cancel placement/movement, undo a draft edit, recover a failed save, and verify that panning or clicking the toolbar never places an object.
- Change a completed scenario; verify a new draft revision and no reuse of incompatible old frames.
- Switch Fire / Estimate / Compare without leaking ground truth to inference or mixing time/revision.
- In Live, ingest a real API packet, inspect charts, and explore history while new data continues to arrive.
- Repeat the main flow on keyboard and touch; verify map visibility, focus, and inspector recovery.

Use Playwright against the built app [U8]. Freeze time and environmental/map fixtures for screenshot baselines. Review the first captures manually, keep key objects and overlays unmasked, and retain behavioural checks alongside visual comparisons. No application-browser checks are claimed by this planning document.

## 8. Deterministic simulation and time controls

An administrator can create an area, place sensors, add one or more ignition events, choose a historical or forecast weather period, and start a scenario. Allow optional scenario-only wind/weather overrides with visible labels.

Timeline controls: play, pause, step, speed selection, drag/keyboard seek, return to live, and a visible selected timestamp/time zone. Simulation clock, wall clock, and a viewer's playback cursor are separate values.

Use UTC internally. Display the scenario's selected IANA time zone and handle daylight-saving transitions. Real historical observations cannot be changed by rewinding a simulation.

Reproducibility requirements:

- Seed all random noise and uncertainty draws. Record seed, RNG state, engine version, fuel settings, and environmental snapshot identifiers.
- Use fixed simulation output times and stable numerical stepping. Rendering speed must not change results.
- Write checkpoints, initially every minute of simulation time, plus an ordered event log.
- To seek backward, restore the nearest checkpoint and replay deterministically. Replaying must not duplicate persisted observations or alarm transitions.
- Changing an ignition, sensor location, weather override, or model parameter after results exist creates a new scenario revision and invalidates only affected derived outputs.
- Keep one viewer's historical cursor independent of another viewer and of real-time ingestion.

### Simulated sensor response

For every sensor, interpolate the frozen weather data at its location and simulated time, then add persistent device bias and temporally correlated noise. Calculate the environmental response consistently but publish only channels supported by that sensor profile; a smoke-only sensor must not contribute invented temperature evidence. Begin with configurable example noise of about plus/minus 0.5 degrees Celsius and plus/minus 3 humidity percentage points; these are scenario settings, not hardware accuracy claims.

Use distance to the **active fire front**, not distance to the original ignition point. The requested 50 m response radius is a tunable simulation assumption.

A simple continuous proximity factor is:

```text
q(d) = max(0, 1 - d / responseRadiusM)^2
targetTemperature = ambientTemperature + temperatureGain * intensity * q(d)
```

Move the reported temperature toward the target with a response-time constant, rather than jumping instantly. Configure a clear demonstration scenario whose sensor passes 30, 60, and 70 degrees as fire approaches. Do not force every real fire or every sensor to follow that sequence.

Model smoke separately: a near-fire contribution plus wind-advected puffs with diffusion, decay, and delayed sensor response. Smoke may arrive downwind before the fire reaches 50 m. Clamp the normalized output to 0–100 and retain saturation flags. This is a test observation model, not a calibrated atmospheric dispersion model.

Model humidity consistently with the ambient state and heating, using an explicitly documented approximation; do not equate air relative humidity with fuel moisture. Include optional faults: sensor dropout, stuck values, delayed packets, measurement spikes, and smoke without local fire. Such scenarios are necessary for evaluating false alarms.

## 9. Fire propagation model

Implement a transparent surface-fire baseline before training ML. Use Rothermel's rate-of-spread work [R1], standard fuel-model definitions [R2], and the directional growth approach documented by Finney [R3]. Document which parts are implemented and which are approximations; do not describe a simplified grid engine as a complete FARSITE implementation.

### Spatial representation

Use a local metric grid with fuel, moisture state, elevation/slope, fire arrival time, burning duration, remaining fuel, and state: unburned, burning, burned out, or non-burnable. The initial 25 m grid is computational resolution, not a claim of 25 m real-world prediction accuracy.

The grid and terrain inspector share the same immutable environment snapshot and effective fuel overrides. Store its projection, extent, cell size, source/no-data masks, class-to-fuel mapping, and checksum. Map style, zoom, and layer visibility are presentation settings and must never enter simulation calculations. Replacing a numerical environmental input creates a new scenario revision.

Validate landscape behaviour with controlled fixtures: water blocks local spread, a slope changes the expected directional travel time, and changing a configured fuel profile changes rates according to that profile. Do not assume all forest spreads faster or slower than all grassland. Prevent diagonal shortcuts across non-burnable barriers when constructing grid neighbours.

Propagate using directional edge travel times or a numerical arrival-time/front method. Recompute rates as weather changes. Use a time step that cannot skip entire grid cells at the highest local spread rate; check convergence with a smaller step and finer grid. Avoid visible square-grid bias and zero-delay propagation through many cells in one update.

### Inputs and weights

| Factor | Representation |
| --- | --- |
| Wind | Speed and direction as a vector; dominant directional control. Preserve uncertainty and gust information. |
| Fuel/land cover | Fuel-model parameters and class fractions, with explicit administrator overrides. |
| Temperature and humidity | Influence drying/fuel-moisture estimates and background sensor expectations. |
| Precipitation | Recent accumulation and moisture recovery. |
| Terrain | Elevation, slope and aspect; combine wind and slope effects consistently. |
| Latitude/longitude | Locate weather, terrain, seasonality and training samples; use local metres for distance, and validated spatial encodings for ML. |
| Season/time | Cyclic hour/day-of-year features and fuel condition. |

Convert meteorological wind direction, which describes where wind comes **from**, into travel direction. For east/north components use `u = -speed * sin(direction)` and `v = -speed * cos(direction)`, with degrees converted to radians. Interpolate vectors rather than averaging 359 and 1 degrees as 180 degrees. Estimate mid-flame wind with an explicit fuel/canopy adjustment rather than directly substituting 10 m wind into every spread formula.

Support the requested forest, forest-steppe, and steppe categories:

- Steppe: start from mapped grassland and a documented grass fuel profile.
- Forest: choose a timber-litter/understory profile; tree cover alone does not specify ground fuel.
- Forest-steppe: represent a grass/woodland mosaic or recorded class fractions, not a globally available land-cover class that the source does not contain.
- Water and designated non-burnable surfaces block the baseline surface-fire model. Unknown cover remains unknown or uses an explicit, labelled fallback.

Extract initial physical parameters from the published fuel tables, record the selected model and units, and allow regional adjustment. Do not invent a universal ordering such as forest always spreading faster than grassland. Empirical multipliers and ML coefficients must be distinguished from sourced physical parameters.

The first complete release models surface fire, wind changes, moisture, slope, burnout, barriers, and multiple ignitions. Crown fire, long-distance ember spotting, detailed combustion, suppression, and building-fire behaviour are explicit later extensions, not hidden capabilities of the initial model.

## 10. Detection and correction from sensor evidence

Separate device health from fire evidence. A disconnected device is not evidence of no fire.

1. Estimate each device's expected temperature and humidity for its location and time using weather and an optional learned device bias.
2. Extract temperature anomaly, rate of rise, smoke level/rate of rise, boolean smoke reports, persistence, and quality flags.
3. Produce normal, suspicious, and critical states using configurable thresholds, consecutive-sample requirements, and hysteresis. Do not average a critical temperature away in a chart/downsampling pipeline.
4. Keep several candidate ignition locations and times. Use backward wind-aware smoke influence and thermal proximity to initialize candidates; include a no-fire/sensor-fault hypothesis.
5. Propagate a small ensemble of hypotheses under uncertain wind, fuel, spread, and sensor-response parameters.
6. Compare predicted observations with actual observations at each sensor's observation time, including when each sensor first became abnormal.
7. Update hypothesis weights, normalize, and resample/rejuvenate when necessary. Retain multiple plausible origins when observations do not identify one centre.

Conceptual update:

```text
logWeight[k] += reliability(sensor)
                * log P(new observation | hypothesis[k], observation model)
```

Use robust residual likelihoods so a single faulty device cannot collapse all hypotheses. Process each observation once, model temporal correlation or reduce redundant evidence weight, and cap the influence of closely spaced correlated devices. More repeated packets from one sensor must not masquerade as many independent witnesses.

Healthy sensors reporting no anomaly can reduce probability only where a hypothesis predicts they should detect a signal. Use recent wind history and sensor response delay; do not estimate an ignition centre by averaging triggered sensor coordinates.

For delayed data, perform a bounded update/replay and issue a revised prediction. Preserve previous prediction versions. In historical evaluation, `receivedAt <= issuedAt` determines what was actually knowable; later-arriving observations belong only to explicitly labelled retrospective reconstruction.

Output three separate spatial quantities:

- `pBurningNow`: estimated probability that a cell is actively burning at the selected time.
- `pReachedByTime`: estimated probability that fire has reached a cell by a future time, including cells that may already have burned out.
- `pIgnitionOrigin`: posterior distribution of possible ignition locations/times.

Compute weighted ensemble frequencies with an uncertainty floor/prior and explicit calibration status. Estimate arrival-time quantiles conditional on arrival, and retain probability of no arrival within the horizon.

Use a fixed legend, for example low probability below 20%, yellow around 50%, orange around 70%, and deep red above 90%. Unknown/no-data uses a separate pattern. Do not use a marker-density heatmap or viewport-dependent colour normalization as if it were a probability map.

## 11. Basic TensorFlow model and historical evaluation

Keep the initial model simple: a small dense network, for example 32 ReLU units, 16 ReLU units, and one sigmoid output. Compare it with persistence, a simple statistical classifier, and the physical baseline. A larger neural network is not a prerequisite.

### Define the prediction target before training

The initial real-data target is **satellite-observable active fire in a cell at a declared future observation window**, beginning with a daily horizon on an approximately 1 km grid. This is distinct from an exact perimeter or an exact local arrival time.

Use the Next Day Wildfire Spread benchmark to establish the pipeline [R4]. For a geographically configurable model, build a second, versioned regional dataset from georeferenced VIIRS fire masks, FIRMS event discovery, historical weather, land cover, and elevation. Prefer periods consistent with the land-cover snapshot, initially 2022 onward. Sample multiple climates and vegetation classes before claiming broad geographic support.

### Dataset construction

1. Discover historical fire events and group neighbouring observations into event windows.
2. Obtain fire masks and coverage/quality information for inputs and targets. Use observed no-fire cells as negatives; exclude cloud, missing, unknown, and low-quality labels according to a declared policy.
3. Preserve georeferencing. Regrid to a documented metric grid and aggregate labels without creating false fine-scale detail.
4. Join environmental variables by valid time and geographic location. Keep forecast issue time and observation availability in the manifest.
5. Include current/neighbouring fire state, distance and bearing to known activity, wind speed and vector components, temperature, humidity with a named definition, precipitation, land-cover fractions, slope, season, and spatial features.
6. Include latitude/longitude through documented spatial or cyclic encodings. Fit regularization and run geographic holdouts so the model cannot succeed merely by memorizing places.
7. Treat sensor evidence as a separate runtime assimilation input unless actual labelled historical sensor data exists. Synthetic sensor samples may train a response model, but are not evidence of real-world forecast accuracy.
8. Produce streamed training shards and a manifest with source versions, units, sample counts, filtering, splits, and checksums.

The published benchmark may not contain every feature needed by the production schema. Use a named benchmark feature subset. Add coordinates/land-cover features through georeferenced extraction when they are genuinely available; do not fabricate them. In particular, check whether a dataset's humidity is relative or specific humidity and convert only with the required supporting variables.

### Training, evaluation, and model promotion

- Train with seeded runs, normalized numerical inputs, class imbalance handling, minibatches, and early stopping.
- Split by complete fire event and separated geographic/time blocks, not random neighbouring pixels. Prevent overlapping event chips from leaking into different splits.
- Fit normalization and calibration only on their permitted training/validation partitions. Evaluate final performance once on held-out data.
- Report precision/recall, PR-AUC, Brier score, reliability curves, and per-region/fuel performance. Evaluate synthetic localization with origin error and arrival-time error separately.
- Use archived forecasts available at issue time when assessing operational forecasting. If reanalysis is used, call the result a retrospective experiment.
- Export TensorFlow model files, normalizer, feature schema, supported scale/horizon/domain, calibration parameters, dataset manifest, and a short model card.
- Do not promise an accuracy percentage before evaluation. If the neural model does not improve the relevant baseline, retain it as an evaluated experimental model and keep the better baseline active.

### Combine ML with the propagation model

For a horizon and target where both models are valid, combine their calibrated predictions with a validation-selected blend, for example:

```text
pFinal = (1 - alpha) * pPhysical + alpha * pML
```

Both terms must describe the same event, cell scale, and time window. Aggregate the physical ensemble to the ML target scale before blending. Fit or select `alpha` on held-out validation data; do not give ML an arbitrary dominant weight.

A daily 1 km model must not silently modify minute-level 25 m predictions. The detailed short-horizon forecast remains driven by the physical ensemble and sensor assimilation until matching training labels support an ML correction. The UI may show both outputs with their different resolutions.

If the location is outside the validated model domain, features are missing, or the model cannot load, use the physical model and expose the fallback reason. Worldwide map availability does not mean a US-trained model is validated worldwide.

### Required prediction entry point

Implement a typed, independently testable function in the analysis package:

```typescript
async function predictFireSpread(input: {
  area: GeoJSON.Polygon;
  issuedAt: string;
  requestedTimes: string[];
  observations: ValidatedObservation[];
  previousPosterior?: FirePosterior;
  weatherSnapshot: WeatherSnapshot;
  landscapeSnapshot: LandscapeSnapshot;
  satelliteEvidence?: SatelliteObservation[];
  modelVersion?: string;
  config: PredictionConfig;
  seed: number;
}): Promise<PredictionResult>;
```

The result contains probability grids, origin hypotheses, arrival-time summaries, input cutoff, model/data versions, calibration status, quality warnings, and computation diagnostics. Simulation ground truth is intentionally absent from this interface.

## 12. Ubuntu deployment deliverables

Create these files during implementation:

| File | Responsibility |
| --- | --- |
| `compose.yaml` | PostgreSQL/PostGIS, pinned tested image, health check, persistent volume, loopback-only database port. |
| `deploy/dryspell-web.service` | Express/static/WebSocket service on port 4000. |
| `deploy/dryspell-worker.service` | Background simulation, inference, and import worker. |
| `deploy/dryspell-db.service` | systemd wrapper for starting/stopping the Compose database without deleting its volume. |
| `deploy/dryspell-maintenance.service` and `.timer` | Retention, aggregation, and configured backup jobs. |
| `scripts/install.sh` | Idempotent Ubuntu installation, build, migrations, service installation, health checks, and firewall configuration. |
| `scripts/start.sh`, `scripts/stop.sh`, `scripts/status.sh` | Simple local/service lifecycle commands. |
| `scripts/backup.sh`, `scripts/restore.sh` | Coordinated database, model/config, and grid-artifact backup/restore. |
| `scripts/smoke-test.sh` | HTTP, authorization, ingestion, WebSocket, static routing, and worker checks. |
| `.env.example`, `config/admin.example.cjs` | Documented configuration, without real secrets. |

Installation behaviour:

1. Detect Ubuntu version, architecture, available disk, existing Docker/Node installations, and port conflicts. Use current official installation guidance [T2, T8].
2. Install only required dependencies; use lockfiles and a tested Node/TensorFlow combination. Build the React client and server packages.
3. Create a dedicated unprivileged `dryspell` service user. Root is used for installation and firewall/service operations, not normal application execution.
4. Store private configuration in `/etc/dryspell`, application releases under `/opt/dryspell`, and persistent application files under `/var/lib/dryspell`. Protect credentials from other users and static serving.
5. Start PostgreSQL, wait for readiness, and apply migrations under a migration lock. Never delete an existing volume as part of ordinary installation or upgrade.
6. Install and verify service units, enable boot startup, and restart only this platform's units. Add restart limits, graceful termination, and journal logging [T9].
7. Bind the application to `0.0.0.0:4000`. WebSocket uses the same port; the worker needs no public port. Bind PostgreSQL to loopback, or keep it entirely private if the application is later containerized.
8. If UFW is active, add `4000/tcp` without resetting rules. Do not enable an inactive firewall or alter SSH access merely to open one port. Report other active firewall managers and configure them deliberately [T7].
9. If a cloud security group or router blocks access, report the exact remaining rule. A local script cannot guarantee that an external firewall has been opened without provider access.
10. Verify health, static client routing, one authenticated sample reading, WebSocket delivery, worker operation, restart recovery, and database persistence.

Keep port 4000 available as requested. For Internet-facing credential use, provide an optional TLS reverse-proxy configuration using HTTPS/WSS, normally on 443, while retaining 4000 as the application port. Do not present plain HTTP credentials as encrypted. Additional ports are opened only for an enabled deployment feature.

Provide a one-command documented entry point, such as `sudo bash scripts/install.sh --port 4000`, with flags for noninteractive configuration. Missing administrator credentials should be supplied or securely generated during setup and displayed only through an appropriate local setup channel.

## 13. Resource and performance strategy

The reference hardware is a deployment and measurement target, not a feature cap. Keep resolution, ensemble size, concurrency, and forecast horizon configurable.

- Begin with one web process, one analysis worker, and one database. Queue expensive analysis instead of executing it in an HTTP handler.
- Start with 32–64 ensemble members, active-front processing, typed arrays, compressed checkpoints, and bounded in-memory caches; benchmark before changing defaults.
- Train/import in a separate CLI job, optionally on another machine, and load the exported model for inference. Allow local CPU training when the operator chooses it.
- Avoid running a browser test suite, large dataset import, training, and production analysis simultaneously on the reference machine.
- Read raster windows and stream dataset shards. Bound provider concurrency, PostgreSQL pools, WS queues, and chart point counts.
- Coalesce redundant pending prediction jobs; retain the newest cutoff and ensure skipped intermediate observations still inform the next result.
- Display analysis progress, current prediction age, and cancellation controls when a large area/horizon takes longer.

Initial measurable targets, to be verified rather than advertised as achieved:

- 30 sensors submitting once per second in a stress fixture, with no loss of acknowledged readings.
- API ingestion p95 below 500 ms and visible live updates within 2 seconds on the reference test setup.
- Normal map/filter/chart interactions remain responsive during analysis.
- Cached timeline seeks usually complete within 1 second; uncached seeks show progress.
- A documented benchmark for the default area, grid, ensemble, and horizon, including elapsed time, peak RSS, CPU, and database growth.

If a target is missed, profile and adjust scheduling/storage/numerics first. Report the measured tradeoff; do not quietly remove ML, terrain, time controls, or other requested functions.

## 14. Verification and E2E acceptance

Write tests around observable behaviour and scientific invariants. A passing browser suite establishes application behaviour, not real-world wildfire prediction accuracy.

| Area | Required checks |
| --- | --- |
| Ingestion | Valid partial/full packets, 0/100 boundaries, invalid/NaN/range rejection, unknown device, wrong token, idempotency, batch retries, late/out-of-order packets, committed data after restart. |
| Authorization | Anonymous users cannot create/move/delete sensors or mutate scenarios; direct HTTP and WS attempts fail; logout/expired sessions fail; credentials are absent from built assets. |
| CRUD | Login, create sensor on map/by coordinates, edit, cancel movement, save movement, reload, archive/restore, permanent-delete confirmation, correct historical locations. |
| Live updates | Inject telemetry through the real API and see marker, list, charts, and alerts update without reload; reconnect and recover missed events without duplication. |
| Charts and filters | All three measurements, custom intervals, missing-data gaps, synchronized cursors, map/list filter agreement, URL state, clear-all and empty states. |
| Simulation | Place each sensor profile and ignitions directly on the map; supported-channel outputs, gradual heating, early downwind smoke, critical alarms, burnout, run/replay controls, deterministic seek, and revision-safe editing. |
| Determinism | Same seed/config/input snapshots give the same scenario; seek/replay and uninterrupted runs agree within declared numerical tolerance. |
| Physics | Wind-from conversion, calm symmetry, faster downwind than upwind travel under equal conditions, barriers including diagonal crossings, slope direction, configured fuel effects, moisture sensitivity, grid/time-step convergence, and map/engine snapshot agreement. Layer visibility and basemap changes must not affect outputs. |
| Inference | Timing of multiple detections changes the origin posterior; no truth access; healthy negative observations constrain hypotheses; faulty/stale sensors do not force certainty. |
| Temporal integrity | Replay before an alert does not use later readings; operational replay excludes late-arriving data and future weather runs; live updates continue while a viewer examines history. |
| Probability rendering | Fixed 0–1 legend, distinct unknown state, current-burning versus reached-by-time distinction, no automatic density scaling. |
| Providers | Timeouts, 429s, stale cache, missing terrain, absent NASA key, invalid response, longitude wrapping, and provider recovery. |
| ML | Reproducible preprocessing, matching train/inference units, event/geographic split checks, model load, calibration metadata, baseline comparison, unavailable/out-of-domain fallback. |
| Deployment | Fresh install, repeated install, database persistence, worker crash/restart, service reboot startup, static SPA routing, port binding, backup and restore. |
| Usability | Keyboard navigation, visible focus, accessible dialogs, colour-independent statuses, desktop and narrow-screen layouts, no unexpected browser errors. |
| Visual quality | Section 7 composition/identity gates: full physical-map workspace, minimal tools, working object placement, readable overlays/charts, contextual inspection, reviewed desktop/mobile captures, and complete loading/error/empty states. A recoloured dashboard fails. |

Use Playwright against the built React app and actual Express server, with a real test PostgreSQL instance. Mock external weather/map/satellite responses for deterministic CI; do not mock internal telemetry, authentication, persistence, or WebSocket delivery in the main E2E path. Keep an opt-in live-provider smoke test separate [T10].

Exercise MapLibre interaction, marker dragging, layer toggles, and timeline controls in a real browser. Configure CI WebGL/software rendering as needed and provide a clear fallback UI if WebGL is unavailable. Retain traces/screenshots on failure. Start with one Playwright worker on the reference server and run a broader browser matrix where resources permit.

## 15. Implementation milestones

Complete all milestones for the requested product. The ordering provides reviewable increments; it does not redefine the project as a smaller prototype.

| Milestone | Work | Completion evidence |
| --- | --- | --- |
| M0 — Contracts and research | Finalize source adapters, units, API schema, temporal semantics, source manifest, and known modelling assumptions. | OpenAPI draft, sample packets, source documentation, and reproducible sample scenario specification. |
| M0D — Map-simulator design | Read section 7 and UI_DESIGN_RESEARCH.md; compare two compact canvas compositions with the same landscape fixture, then choose the working direction. | Recorded composition choice, object symbols/tokens, rendered placement/selected/running/mobile states, and initial composition/identity review. |
| M1 — Application foundation | Workspace, Express/static React, Postgres/PostGIS, migrations, login, config, health checks. | Fresh local startup and protected mutation integration tests. |
| M2 — Sensor objects and telemetry | Sensor profiles/capabilities, CRUD, location history, real ingestion, credentials, durable outbox, live delivery, history. | Different sensor profiles persist correctly; a real API packet updates the browser; unauthorized mutations fail. |
| M3 — Map workspace | Implement full-map composition, object palette, direct placement, contextual inspection/charts, transport, and secondary filters/settings. Use labelled development fixtures until M4/M5 supply the engine. | Placement/CRUD and keyboard/touch journeys, reviewed canvas screenshots, no default dashboard layout, and a usable map while inspecting objects. |
| M4 — Working physical landscape | Weather/current/archive, land cover, elevation, OSM enrichment, shared effective-grid contract, caches, terrain inspector, and optional overlays. | Terrain inspector matches engine input fixtures; provenance, missing coverage, and provider recovery are verified. |
| M5 — Complete simulator journey | Surface-fire engine, capability-aware sensor response, multiple ignitions, deterministic clock, checkpoints, revision-safe editing, and connected map/WS/chart updates. | Place sensors on prepared terrain, ignite, run, inspect, and rewind without leaving the map. Controlled wind/fuel/slope/barrier fixtures alter results as documented; display-only changes do not. |
| M6 — Inference | Detection features, candidate origins, ensemble correction, uncertainty, probability layers. | Blind synthetic tests demonstrate localization updates without ground-truth leakage. |
| M7 — Satellite history and ML | FIRMS integration, coverage-aware dataset pipeline, small TensorFlow model, evaluation, export, scale-matched combination. | Real historical benchmark results, model card, trained artifact, and documented domain/fallback. |
| M8 — End-to-end quality | Full simulator and real-data E2E flows, failure cases, all section 7 gates, accessibility, load and resource measurements. | Test report, reviewed visual baselines, UX_REVIEW.md, terrain-effect evidence, and measured performance; no unresolved blocking interaction or identity defects. |
| M9 — Ubuntu delivery | Install/start scripts, Compose, services, firewall handling, backup/restore, operational README. | Clean Ubuntu installation and deployment smoke tests; unresolved external prerequisites stated explicitly. |

Expected package boundaries are `apps/web`, `apps/server`, `packages/contracts`, `packages/simulation`, `packages/inference`, and `packages/data-sources`, plus `db`, `scripts`, `deploy`, `tests`, and `docs`. Keep simulation and inference usable without a browser or HTTP server.

At completion, deliver the implementation, lockfiles, migrations, administrator/device setup instructions, API documentation, reproducible scenarios, trained-model or explicitly documented training prerequisites, scientific assumptions, citations, design tokens and references, reviewed UI states and UX findings, E2E results, benchmark results, and Ubuntu deployment instructions. Never label missing data access, unexecuted tests, an unreviewed interface, or an untrained model as completed work.

## 16. Source references

These references support data selection and modelling decisions. Engineering defaults in this plan, including the 50 m sensor-response radius, noise amplitudes, alert thresholds, grid size, and ensemble count, are proposed configuration values unless explicitly tied to a source.

### Fire research

- **[R1] Rothermel, R. C. (1972).** *A Mathematical Model for Predicting Fire Spread in Wildland Fuels.* USDA Forest Service, INT-RP-115. Rate-of-spread foundation and its assumptions. [Publication](https://research.fs.usda.gov/treesearch/32533) · [PDF](https://research.fs.usda.gov/download/treesearch/32533.pdf).
- **[R2] Scott, J. H., and Burgan, R. E. (2005).** *Standard Fire Behavior Fuel Models: A Comprehensive Set for Use with Rothermel's Surface Fire Spread Model.* RMRS-GTR-153. Fuel definitions, selection guidance, and parameter tables. [Publication](https://research.fs.usda.gov/treesearch/9521) · [PDF](https://research.fs.usda.gov/download/treesearch/9521.pdf).
- **[R3] Finney, M. A. (1998; revised 2004).** *FARSITE: Fire Area Simulator—Model Development and Evaluation.* RMRS-RP-4. Directional growth, weather/terrain interactions, and model limitations. [Publication](https://research.fs.usda.gov/treesearch/4617) · [PDF](https://research.fs.usda.gov/download/treesearch/4617.pdf).
- **[R4] Huot et al. (2022).** *Next Day Wildfire Spread: A Machine Learning Data Set to Predict Wildfire Spreading from Remote-Sensing Data.* IEEE TGRS 60. Public daily wildfire ML benchmark. [Author publication page](https://research.google/pubs/next-day-wildfire-spread-a-machine-learning-dataset-to-predict-wildfire-spreading-from-remote-sensing-data/) · [Paper](https://arxiv.org/abs/2112.02447). The paper links the authors' dataset and extraction code; follow those links and verify current access during implementation.

### Data sources

- **[D1] Open-Meteo Forecast API.** [Documentation](https://open-meteo.com/en/docs).
- **[D2] Open-Meteo Historical Weather API.** [Documentation](https://open-meteo.com/en/docs/historical-weather-api).
- **[D3] Open-Meteo Single Runs API.** [Documentation](https://open-meteo.com/en/docs/single-runs-api).
- **[D4] NASA FIRMS.** [Service](https://firms.modaps.eosdis.nasa.gov/) · [Area API](https://firms.modaps.eosdis.nasa.gov/api/area) · [Map-key registration](https://firms.modaps.eosdis.nasa.gov/api/map_key/). User-supplied starting reference: [NASA Earthdata FIRMS tools page](https://www.earthdata.nasa.gov/data/tools/firms#nasa-active-fire-data). The tools page returned HTTP 403 during this research; the official FIRMS service and API documentation were accessible.
- **[D5] NASA FIRMS Fire Map interpretation.** [Official map and detection notes](https://firms.modaps.eosdis.nasa.gov/map/index.html).
- **[D6] NASA VIIRS active fire products.** [VNP14IMG catalogue](https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VNP14IMG/) · [Collection 2 375 m User Guide](https://ladsweb.modaps.eosdis.nasa.gov/archive/Document%20Archive/Science%20Data%20Product%20Documentation/VIIRS_C2_AF-375m_User_Guide_1.2.pdf) · [Daily gridded product catalogue](https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/VNP14A1). Verify product collection, geolocation, and QA definitions for the selected files.
- **[D7] ESA WorldCover.** [Data access and licence](https://esa-worldcover.org/en/data-access) · [2021 v200 dataset DOI](https://doi.org/10.5281/zenodo.7254221).
- **[D8] OpenStreetMap Overpass API.** [Documentation](https://wiki.openstreetmap.org/wiki/Overpass_API) · [Licence FAQ](https://osmfoundation.org/wiki/License/Licence_and_Legal_FAQ).
- **[D9] Copernicus DEM.** [Open-data catalogue and access](https://registry.opendata.aws/copernicus-dem/).
- **[D10] Open-Meteo terms.** [Hosted service conditions](https://open-meteo.com/en/terms).
- **[D11] OpenStreetMap Foundation.** [Raster tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

### Implementation documentation

- **[T1] TensorFlow.js in Node.js.** [Packages and production considerations](https://www.tensorflow.org/js/guide/nodejs).
- **[T2] Node.js.** [Supported release status](https://nodejs.org/en/about/previous-releases).
- **[T3] PostgreSQL.** [Partitioning documentation](https://www.postgresql.org/docs/current/ddl-partitioning.html).
- **[T4] MapLibre GL JS.** [Documentation](https://maplibre.org/maplibre-gl-js/docs/).
- **[T5] Apache ECharts.** [Project and documentation entry point](https://echarts.apache.org/en/index.html).
- **[T6] TanStack Table.** [Column filtering](https://tanstack.com/table/v8/docs/guide/column-filtering).
- **[T7] Ubuntu Server.** [Firewall documentation](https://ubuntu.com/server/docs/how-to/security/firewalls/).
- **[T8] Docker.** [Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/).
- **[T9] systemd.** [Service unit documentation](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html).
- **[T10] Playwright.** [Test configuration](https://playwright.dev/docs/test-configuration).

### Frontend and UX references

- **[U1] Anthropic, frontend-design skill.** [Official SKILL.md](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) · [Upstream licence](https://github.com/anthropics/skills/blob/main/skills/frontend-design/LICENSE.txt). Selected for its subject-specific design process and visual critique; the Dryspell requirements in section 7 remain authoritative for this project.
- **[U2] IBM Carbon Design System.** [Data visualization guidance](https://www.carbondesignsystem.com/building-blocks/data-visualization/overview). Reference for information hierarchy and chart presentation, not a requirement to copy its visual identity or replace ECharts.
- **[U3] Radix Primitives.** [Introduction and interaction foundations](https://www.radix-ui.com/primitives/docs/overview/introduction).
- **[U4] IBM Plex.** [Official typeface repository and licence](https://github.com/IBM/plex).
- **[U5] W3C WAI.** [Understanding contrast requirements](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- **[U6] W3C WAI.** [Understanding target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- **[U7] W3C WAI.** [Understanding focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).
- **[U8] Playwright.** [Visual comparisons and screenshot baselines](https://playwright.dev/docs/test-snapshots).
- **[U9] Paul Bakaus, Impeccable.** [Upstream skill and mode definitions](https://github.com/pbakaus/impeccable/blob/main/plugin/skills/impeccable/SKILL.md). Secondary reference for task-oriented interface refinement. See UI_DESIGN_RESEARCH.md for tooling and workflow limitations.
- **[U10] Vercel, web-design-guidelines.** [Upstream skill](https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md) and its linked current interface guidelines. Use for implementation review, not as a visual identity generator.
