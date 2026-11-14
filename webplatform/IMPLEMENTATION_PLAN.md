# Dryspell: IoT Fire Monitoring and Spread Prediction

English implementation plan for Codex CLI. Research checked on 13 November 2026. Expanded frontend and UX specification added on the same date.

## 1. Objective and confirmed decisions

Build a working web platform that receives real sensor readings, manages sensor locations, simulates wildfire and sensor behaviour, and estimates the current fire location and future spread from observations and environmental data.

The application must provide an interactive map, live updates, historical charts, a rewindable timeline, and a probability layer. Simulation must be useful for testing the detection algorithm, not just for drawing an expanding circle.

| Topic | Decision |
| --- | --- |
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

- Public read-only dashboard; administrator login for mutations.
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
| Mapping | MapLibre GL JS with GeoJSON sensor layers and fixed-scale raster/grid probability overlays. Add a small custom map interaction for placing and moving sensors. |
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

Store an immutable internal ID, unique external `deviceId`, display name, real/simulated source, coordinates, optional elevation, hardware/calibration profile, expected reporting interval, tags, enabled state, and creation/update timestamps.

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

Default dashboard subscriptions cover all 30 sensors in the selected context. Support subscriptions by context/device/area without leaking simulation data into live views. Filter changes affect visibility, not whether the database records incoming measurements.

On connection, establish a consistent snapshot/cursor boundary and deliver subsequent events. On reconnect, resume from a retained cursor or require a fresh snapshot. Deduplicate replayed events. Add ping/pong, exponential reconnect backoff, bounded send buffers, and slow-client handling.

Use a database transaction for telemetry, latest-state updates, and outbox entries. Acknowledged data survives a process restart even if WebSocket delivery happens later. PostgreSQL notifications may wake consumers but must not be the only durable event store.

Core entities:

| Entity | Main contents |
| --- | --- |
| `sensors`, `sensor_locations`, `device_credentials` | Identity, effective-dated geometry, calibration, reporting intervals, authentication. |
| `telemetry`, `sensor_latest`, `telemetry_hourly` | Immutable readings, cached current values, aggregates with min/max/count and gaps. |
| `incidents`, `incident_evidence`, `audit_log` | Alarm transitions, contributing readings, acknowledgement, administrator changes. |
| `scenarios`, `scenario_versions`, `scenario_events` | Area, clock, random seed, ignition/weather edits, immutable revision history. |
| `simulation_checkpoints`, `simulation_readings` | Versioned state snapshots and generated observations, isolated from real telemetry. |
| `environment_snapshots`, `external_detections` | Versioned inputs and satellite observations with provenance. |
| `analysis_jobs`, `prediction_runs`, `prediction_frames` | Job state, inputs, output metadata, compressed spatial frames. |
| `model_versions`, `dataset_manifests` | Feature schema, training lineage, metrics, calibration, supported domain. |
| `sessions`, `event_outbox` | Login sessions and durable delivery. |

Index `(sensor_id, recorded_at)`, source/context/time, job status, and spatial geometry. Keep large grid frames compressed in a managed data directory with database metadata, hashes, atomic writes, and coordinated backup. Do not store a JSON object per cell per animation frame. Introduce telemetry partitioning only when measured volume warrants it [T3].

## 7. Frontend design, map interaction, and UX specification

This section is a required implementation specification, not an optional styling pass. A technically functional screen is incomplete until its composition, interaction states, responsive behaviour, and visual review meet the criteria below.

### 7.1. Design skill and required workflow

Use **Anthropic's `frontend-design` skill** as the design workflow for frontend implementation and visual review [U1]. Its upstream source is:

<https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md>

Before writing frontend components, Codex must read this entire section and the complete skill. Reuse an available installation of the skill; otherwise retrieve and read its official source in the implementation environment. Record the reviewed revision or content checksum and access date in `docs/DESIGN_REFERENCES.md`. If a copy is installed, preserve its upstream licence and attribution. Reading a linked skill does not mean it has been installed in a different Ubuntu/Codex environment.

The project-level `AGENTS.md` connects this requirement to frontend work. The skill supplies a design process; this plan supplies Dryspell's product decisions. Resolve stylistic choices in favour of the specified monitoring workflow, readability, and accessibility. Do not add a marketing hero to the application because a general design reference discusses landing pages.

Use the following workflow without introducing a mandatory approval pause:

1. Identify the operator's task, the information they need first, and the decisions available on each screen.
2. Review a few relevant references: NASA FIRMS for spatial monitoring, Carbon for information and chart hierarchy, and this specification for Dryspell's identity [D5, U2]. Record useful principles rather than copying another product's screen.
3. Define the layout and design tokens before building the whole component library.
4. Build one representative monitoring screen with realistic sensor data, then its selected-sensor, alert, and mobile states. Use rendered browser layouts or visual wireframes rather than ASCII diagrams.
5. Inspect actual browser screenshots and complete the primary user journeys. Correct spacing, hierarchy, legibility, and interaction problems before expanding to all screens.
6. Apply the same system to administration, historical playback, and simulation. Repeat the visual and interaction review after integration.

The result should feel purpose-built for environmental monitoring. Avoid an interchangeable dashboard template, decorative effects unrelated to the data, and claims that visual polish guarantees prediction accuracy.

### 7.2. Visual direction

**Direction: a calm, precise field-monitoring console with the map as its main working surface.**

Use a light, cool-neutral application shell, white inspection surfaces, restrained evergreen actions, and a low-saturation basemap. Reserve warm signal colours for temperature and fire evidence. Convey character through geographic context, typography, aligned readings, and well-composed controls.

The initial view opens directly into monitoring. Do not add a promotional welcome screen, oversized heading, ornamental statistic cards, fake testimonials, AI-generated scenic imagery, or an animated background. Site branding is a compact Dryspell wordmark; a custom illustrated logo is a separate task.

The visual hierarchy is: **location and time context, relevant sensors/incidents, selected evidence, then advanced configuration**. Secondary information remains reachable without competing with the main task.

Design rules:

- Group by task and meaning. Use panels for persistent tools, rows for comparable sensors, and dialogs for focused decisions.
- Use consistent alignment and spacing; leave breathing room around meaningful groups while keeping a useful amount of data visible.
- Make one primary action apparent within the current task. Read-only monitoring does not need a large call-to-action button.
- Show units, freshness, and data origin close to the values they qualify.
- Keep risk, connection health, and selection visually distinguishable.
- Use subtle transitions to explain a user action. Live readings should not make the entire interface flash or move.

### 7.3. Design tokens and component styling

Define semantic CSS variables in one token file and use them in React, MapLibre styling, and the ECharts theme. These are initial design values; refine them through browser review while preserving their roles.

| Token/role | Initial value | Usage |
| --- | --- | --- |
| Application background | `#F4F6F8` | Shell and quiet page background. |
| Surface | `#FFFFFF` | Inspector, dialogs, menus, and table surface. |
| Primary text | `#18212B` | Headings, primary readings, important labels. |
| Secondary text | `#526172` | Supporting information and timestamps. |
| Decorative separator | `#D5DDE5` | Low-emphasis grouping; not the sole boundary of an interactive control. |
| Control boundary | `#788696` | Input outlines and controls where a visible boundary is necessary. |
| Primary action | `#21604B` | Main buttons and selected navigation, with readable foregrounds. |
| Selected surface | `#E4EFEB` | Quiet selected-row or selected-tab background. |
| Focus indicator | `#246EA5` | Clear keyboard focus ring with offset. |
| Warning | `#8A5200` on `#FFF4D6` | Stale data and caution messages, accompanied by text/icon. |
| Critical | `#B42332` on `#FFF0F0` | Critical evidence and destructive actions, with explicit labels. |
| Temperature series | `#A84B15` | Temperature chart line. |
| Humidity series | `#246EA5` | Humidity chart line. |
| Smoke series | `#586474` | Smoke-index chart line. |

Use **IBM Plex Sans** for interface text and **IBM Plex Mono** only for device identifiers, coordinates, and code-like values [U4]. Use tabular numerals for changing measurements. Keep ordinary labels in the main sans-serif family. Self-host the required font files, retain their licence, and include Latin and Cyrillic glyph coverage for future Ukrainian text.

Typography starting points: 14–16 px body text, 13 px secondary metadata, 18–20 px panel titles, and 24–28 px selected readings. Prefer weights 400, 500, and 600. Do not shrink essential labels to fit; reflow the layout. Use sentence case and short concrete labels.

Use a 4 px spacing basis with an intentional scale of 4, 8, 12, 16, 24, and 32 px. Default control heights are 36–40 px on desktop and at least 44 px for primary touch controls. Use roughly 6 px control corners and 10 px dialog corners. Main map/sidebar boundaries can remain square. Shadows belong mainly to floating overlays and dialogs.

Use Radix Primitives for dialog, menu, popover, tabs, tooltip, and slider behaviour, then style them with the shared tokens [U3]. Prefer CSS Modules for component-specific styling and a small global reset. Keep one icon family, a consistent stroke weight, and textual labels for unfamiliar actions. A component library does not replace the design decisions in this section.

Treat a dark theme as a later deliberate design task; a complete, reviewed light theme is the initial requirement. Do not implement an automatic colour inversion and call it a finished second theme.

### 7.4. Information architecture and screen ownership

| Screen | Primary purpose | Main interaction |
| --- | --- | --- |
| Monitor | Understand current or historical conditions in a selected area. | Select a sensor/incident, inspect evidence, change time or layers. |
| Sensors | Compare and administer device records. | Search/filter/sort; open a sensor; create or edit with administrator access. |
| Incidents | Follow suspected and confirmed events and their evidence. | Inspect the timeline and contributing observations; acknowledge/confirm as administrator. |
| Simulations | Configure, run, and compare saved scenarios. | Place devices/ignitions, control time, compare truth and estimate. |
| Sources and model | Understand freshness, provenance, resolution, and model status. | Inspect current inputs, missing data, and prediction limitations. |
| Settings | Configure credentials, retention, providers, and defaults. | Administrator-only forms with clear save feedback. |

Keep the active area, data context, selected sensor, filters, and time understandable while moving between views. Preserve meaningful navigation state in the URL so Back/Forward and a copied read-only link behave predictably. Never put credentials in that URL.

The application has an explicit **Live**, **History**, or **Simulation** context. Selecting a future timestamp additionally shows **Forecast** and the forecast issue time. A historical or simulated display must never retain an unqualified Live badge.

### 7.5. Desktop layout and responsive composition

For a large desktop, use a compact top bar, narrow navigation rail, sensor/incident list on the left, central map, optional right inspector, and a bottom time bar. The top bar carries the area, context, connection summary, and account control. Navigation labels must be available on focus and in the expanded navigation.

| Region | Initial sizing | Behaviour |
| --- | --- | --- |
| Top bar | About 56 px high | Remains stable when values update; wraps or simplifies at smaller widths. |
| Navigation rail | About 64 px wide | A small number of destinations; expands into a labelled menu. |
| Left list | About 288–320 px wide | Search, compact status counts, filters, and sensor/incident rows. |
| Map | Remaining space | The largest surface when the inspector is closed; protect a useful minimum width. |
| Right inspector | About 380–420 px wide | Opens for a selected sensor/incident; scrolls internally when needed. |
| Time bar | About 80–96 px collapsed | Expands for event tracks and detailed playback controls. |

At 1440 px and wider, the list and inspector may coexist. At 1024–1439 px, show one full side panel at a time when both would squeeze the map below roughly 560 px. Opening the inspector preserves the list state and provides a clear return action.

At 768–1023 px, use an overlay drawer or bottom inspector and a collapsible list. At mobile widths, the map is the base screen and Map/List is an explicit switch; the inspector becomes a bottom sheet or full-height panel. The sheet must have buttons to expand/close, not require dragging. Preserve numeric coordinate entry and the complete administrator flow on touch screens.

Test 1440×900, 1280×800, 768×1024, and 390×844, plus 320 CSS px reflow and 200% zoom. Do not create horizontal page scrolling. If a data table needs horizontal scrolling, contain it within a labelled region. Keep the timeline and selected status accessible with the on-screen keyboard open.

### 7.6. Map composition, layers, and interaction

The default screen is a monitoring dashboard: map, sensor list, status counts, timeline, and collapsible layer controls. An administrator can open a Simulation workspace in the same application.

Map layers:

- Real sensors and simulated sensors with distinct symbols and labels.
- Device state: normal, suspicious, critical, stale, offline, disabled, and unknown.
- Estimated current fire probability, probability of fire reaching an area by the selected time, and a separate simulated ground-truth overlay.
- Optional NASA hotspot markers with acquisition time, source, and footprint information.
- Optional wind arrows; animation can be added with a reduced-motion alternative.
- Optional ambient-temperature raster, land-cover layer, and selected-area boundary.

Wind and temperature overlays must use the selected timeline time and environmental snapshot. Label their source resolution and freshness; visually smooth interpolation is not new measurement precision.

Use a quiet basemap with readable place names, subdued roads, and restrained vegetation colours. Keep attribution, scale, and legend visible. Sensor hit areas may be larger than their drawn symbols. Dense or overlapping sensors need an explicit disambiguation list or expansion behaviour; clicking must not select an arbitrary hidden marker.

Use marker shape/outline to distinguish real and simulated devices, an inner status glyph to indicate an alert, and a separate selection ring. Critical state must remain recognizable on top of a red probability region. Keep the selected sensor identifiable even while it receives new values.

Interaction rules:

- A marker or list-row click opens the same inspector and synchronizes selection.
- Preserve the current zoom and view unless the user chooses Locate, Fit area, or Follow selected sensor. Automatic updates must not repeatedly pan the map.
- When opening an inspector, pan only as needed to keep the selected marker in the usable map area; account for panel padding.
- Show one small hover/focus preview with name, readings, and freshness. Place detailed graphs in the persistent inspector, not in a tiny map popup.
- Use a deliberate placement/edit mode for administrator changes. A normal click on the map must not create or move anything.
- Layer controls show visibility, opacity where meaningful, time, and an accessible legend. Group them as Sensors, Fire, Weather, and Landscape.
- Temperature and fire probability are mutually exclusive filled rasters by default to avoid ambiguous colours. Allow deliberate comparison through switching or synchronized views. Wind arrows can sit above either layer without overwhelming markers.
- Distinguish predicted boundaries, satellite detections, and simulated truth by line/symbol treatment as well as colour. Truth comparison is off by default in monitoring.
- When tiles fail, preserve the sensor list, coordinate readout, and available overlays. Show a useful map error rather than a blank application.

### 7.7. Sensor inspector and chart design

Clicking a sensor opens a panel with current values, last communication, source, location, quality flags, calibration, and three synchronized charts: temperature, humidity, and smoke index. Show detected alarm events, weather baseline where available, and gaps rather than fabricated connecting values. Support ranges such as 1 hour, 24 hours, 7 days, and a custom interval.

Inspector order:

1. Device name and ID, real/simulated label, connection health, and close/locate actions.
2. Three aligned values with units, observation time, and freshness. Keep units visually secondary but readable.
3. A concise alert/evidence explanation when relevant.
4. Date-range controls and the three synchronized charts.
5. An event list and collapsible metadata/calibration details. Administrator edit actions stay in a consistent location.

Use three vertically aligned plots with a shared time axis; do not combine Celsius and two percentages on an unexplained multi-axis graph. Humidity and smoke use 0–100% scales. The temperature plot can autoscale with visible limits and explicit threshold annotations. A weather baseline uses a labelled dashed line; projected values are dashed or shaded and clearly separated from observations.

Use one measurement colour consistently across value, line, tooltip, and legend. Draw chart gridlines lightly, keep axes readable, and show units. Hover, keyboard inspection, and touch inspection should reveal the same timestamp and values across all three plots. Tooltips must remain inside the visible panel.

Decimation must preserve peaks and gaps. Show the selected aggregation interval and retained sample count when a long range is summarized. Do not smooth away a brief critical reading. A chart with no data must explain whether the period is empty, the device has not reported, or data could not be loaded.

Live follow is enabled for the latest time range. Panning or zooming a chart pauses follow and exposes a clear Resume live action. Do not jump the chart back to now while the user is examining an earlier event.

### 7.8. Sensor list, filters, and information density

Use one shared filter model for map markers and the TanStack Table sensor list [T6]:

- Device ID/name search, tags, real/simulated, scenario, and enabled/archive state.
- Alarm/connection status, freshness, selected map area, and distance from an incident.
- Temperature, humidity, and smoke ranges; missing values are a distinct option.
- Land-cover category, time window, and evidence-quality flags.
- Clear all, visible matching count, and URL-persisted non-sensitive filters.

A compact list row shows name, status, three aligned readings, and last-seen age. Show a small set of high-value filters directly; place advanced ranges and metadata in a Filters panel with an active-filter count. Active filters appear as removable chips with an obvious Clear all action.

Use stable sorting while the user is interacting. Do not reorder the list on every incoming value and move a row out from under the pointer. If an active dynamic sort has changed substantially, provide a controlled refresh or reorder at a safe interaction boundary.

Display contextual counts, such as 8 of 30 sensors, and distinguish No sensors configured from No sensors match these filters. A filtered-out selected device remains in the inspector with an explanation and a Show in list action.

Keep table headings visible within the table region. Right-align comparable numerical readings and use tabular numerals. Preserve full IDs and names through accessible details rather than relying on hover-only truncation. Thirty devices do not require an elaborate virtualized interface unless measured performance justifies it.

### 7.9. Timeline and playback UX

The time bar contains a readable date/time and time zone, play/pause where applicable, step controls, a slider, playback speed for simulation, and Return to live. Context is visible even when the bar is collapsed.

Use separate, labelled tracks for sensor alarms, ignition events, and available prediction frames. Differentiate recorded history from forecast time using a background boundary and a Now/Forecast start marker. Keep tick density appropriate for the current range.

Dragging previews the selected timestamp promptly. Debounce expensive state requests, cancel obsolete requests, and apply only the response matching the current cursor/context. Preserve the previous complete frame with a Loading selected time indicator until the new frame is ready; do not assemble a map from mismatched times.

All linked views must agree on the selected context and time: marker readings, chart cursor, weather layer, probability legend, and incident evidence. Historical data arriving over WebSocket may update the stored history, but must not yank the viewer back into live mode.

Provide keyboard slider operation, a direct date/time input, and controls to jump to the previous/next event. State the current simulation speed plainly. The viewer's playback control must not unexpectedly pause or rewind another viewer's scenario run.

### 7.10. Administrator and scenario workflows

**Add a sensor:** choose real or simulated, enter the basic identifying fields, select a map location or enter coordinates, review a visible pending marker, and save. Show field labels and units persistently. After success, select the saved device and confirm it in the list. A failed save retains the entered information.

**Move a sensor:** enter Edit location, show the original and proposed position, allow drag or coordinate entry, and provide Save location and Cancel. Ordinary navigation stays separate from editing. Cancel restores the original marker; Save failure does not falsely present the proposed position as persisted.

**Archive or delete:** use explicit wording with the device name and the effect on history. Keep archive the convenient default for devices with readings. Permanent deletion requires the deliberate confirmation already specified in section 5. Do not use the same button appearance for Locate and Delete.

**Create a scenario:** select an area, set its start time/environmental inputs, place simulated sensors, add ignition events, and run. Show these as meaningful stages, preserve drafts, and explain the next incomplete step. Advanced fuel and uncertainty settings live in expandable groups rather than blocking the basic setup.

**Compare a scenario:** expose an explicit Truth and estimate comparison. Start with aligned layer switching; add synchronized split views only if space and interaction remain clear. Both views must share the same scenario revision and time.

**Session expiry:** explain that editing requires login again, preserve the unsaved draft, and restore the intended form after successful login. Do not lose a user's entered coordinates or scenario settings.

### 7.11. Alerts, failures, loading, and empty states

Do not merge three separate facts into one badge: a device can be online, reporting an abnormal value, while the prediction worker is delayed. Present device connection, fire evidence, and forecast freshness separately.

| State | Required presentation and recovery |
| --- | --- |
| First load | Stable panel/chart placeholders; show the application structure immediately. Avoid a full-screen spinner for unrelated requests. |
| No devices configured | Short explanation and an administrator Add sensor action; viewers see a clear read-only message. |
| No filter matches | Keep active filters visible and offer Clear filters. |
| Device has never reported | Show Waiting for first reading; do not draw zero-valued charts. |
| Stale device reading | Retain the last value with its timestamp and a stale label. |
| WebSocket reconnecting | Quiet persistent connection status and last update; continue showing retained data. |
| Weather unavailable | Show cached-data age or an unavailable state; explain which forecast inputs are affected. |
| Analysis running/late | Keep the previous result with its issue time and an Updating indicator; allow cancellation of an explicit long job. |
| Critical reading | Persistent in-app alert and incident entry with device, value, time, and an Inspect action. |
| Save failed | Inline error near the affected form, preserved input, and a meaningful retry action. |
| Map/WebGL unavailable | A functional sensor list, charts, and clear explanation of the unavailable map view. |
| Permission denied | Clear explanation and login/return action without pretending the mutation succeeded. |

Critical alerts must not disappear as short toasts. Acknowledging an alert records that it was seen; it does not clear measurements, stop the simulated fire, or confirm a real incident. Confirmation, acknowledgement, and resolution use distinct labels and events.

Deduplicate repeated alerts from the same continuing condition. Avoid a new toast for every sensor tick. Audio notifications are off by default and are not required to recognize a critical state.

Use concrete copy such as Last reading 8 minutes ago, Forecast updated 2 minutes ago, Changes could not be saved, and View incident. Avoid generic success messages that conceal what changed. Developer details such as API route names and worker implementation belong in diagnostics, not the primary operator flow.

### 7.12. Accessibility and motion

Provide numeric coordinate entry and a table-based selection alternative to map dragging. The timeline, dialogs, filters, and charts must be usable with a keyboard. Show textual statuses and patterns as well as colour.

Target WCAG 2.2 AA for the application UI. Check actual rendered text/background combinations, aiming for at least 4.5:1 for normal text and 3:1 for large text; test meaningful graphical objects and control boundaries separately [U5]. Do not assume that a colour passing on white will pass over a map.

Use a visible focus indicator that is not covered by sticky headers, drawers, or the timeline [U7]. Restore focus when a dialog closes. Ensure controls have accessible names, form errors are associated with fields, and selected/expanded states are conveyed programmatically.

Use at least 24×24 CSS px targets or the relevant spacing accommodation, with approximately 44×44 px touch targets as the product preference [U6]. Map markers may use transparent hit areas, with an alternative list for densely packed devices.

Use polite live announcements for important status changes, not for every incoming measurement. Expose chart values and event history through accessible text/table alternatives. Hover-only tooltips are insufficient.

Use restrained CSS transitions, approximately 120–180 ms for controls and 180–240 ms for panels. Respect `prefers-reduced-motion`; disable particle wind animation and unnecessary transition movement when requested. Never use flashing or perpetual pulsing as the only alarm signal.

### 7.13. Frontend implementation boundaries

Keep the UI modular around product behaviour:

| Module/component family | Responsibility |
| --- | --- |
| `AppShell`, `AreaSwitcher`, `ContextHeader` | Navigation, responsive composition, area/context/time identity. |
| `MonitoringMap`, `LayerControls`, `MapLegend` | Map lifecycle, layers, marker interaction, and fixed semantic scales. |
| `SensorList`, `SensorFilters`, `SensorInspector` | Shared selection/filter state and device evidence. |
| `TelemetryCharts`, `RangePicker`, `ReadingSummary` | Synchronized historical and current measurements. |
| `TimeController`, `EventTrack`, `PlaybackControls` | Viewer cursor, history/forecast separation, scenario playback. |
| `IncidentPanel`, `ConnectionStatus`, `SourceStatus` | Incident evidence and independent freshness/health states. |
| `SensorEditor`, `LocationEditor`, `ScenarioEditor` | Validated drafts, explicit mutations, and recoverable failures. |
| Shared UI primitives | Buttons, fields, menus, dialogs, badges, tooltips, and consistent focus/error states. |

Use TanStack Query for server-owned resources and keep transient view state separate: selected sensor, open panel, map camera, filters, and time cursor. One shared controller owns the selected time/context; components must not invent their own independent current time.

Keep the MapLibre instance mounted during ordinary telemetry updates. Update source data and relevant layers instead of rebuilding the map. Patch only affected sensor state, clean up subscriptions, and batch visible updates so WebSocket traffic does not rerender every chart and panel.

Cancel stale history/prediction queries. A late response for sensor A must not replace the inspector after the user has selected sensor B. Use request keys containing sensor/context/time/revision as appropriate.

Persist harmless viewing preferences, such as layer choice and panel size, locally. Keep authentication secrets out of client persistence. Default to confirmed server responses for important mutations; if optimistic UI is used, implement visible rollback and error recovery.

### 7.14. Design deliverables and review gates

Frontend implementation must produce:

- `docs/DESIGN_REFERENCES.md`: selected skill source/revision, a small set of reference principles, font/icon licences, and reasons for the visual direction.
- Shared CSS design tokens, a chart theme, and matching map-layer style definitions.
- A component-state gallery covering buttons, fields, statuses, dialogs, empty/error states, and keyboard focus. It may be a development-only route; a separate component service is not required.
- Browser captures of monitoring overview, selected sensor, critical incident, historical replay, scenario editing, and mobile inspection using deterministic fixtures.
- `docs/UX_REVIEW.md`: reviewed viewports, completed user journeys, discovered issues and fixes, accessibility checks, and outstanding limitations.

Review each screen with the following questions:

1. Can an operator identify the area, time, live/history/simulation context, and data freshness without opening settings?
2. Is the most relevant observation easy to find, with units and a clear next action?
3. Is the map usable after a panel opens, and can the selected device still be located?
4. Do typography, spacing, controls, charts, and map symbols follow one coherent system?
5. Are uncertainty, missing values, stale data, and forecasts visibly distinguishable?
6. Does every visible control work, including cancellation, failure recovery, keyboard operation, and mobile interaction?

Rate hierarchy, composition, consistency, readability, interaction clarity, and responsive behaviour from 0 to 4 during review. Each category must reach at least 3 before frontend sign-off, with no blocking usability or accessibility defects. This is a structured internal critique, not a claim that visual quality can be proven by an automated score.

### 7.15. Visual and usability acceptance scenarios

Use realistic deterministic fixtures: a 30-device overview with normal, stale, offline, missing, and critical states; long names and IDs; zero and 100% smoke; high temperature; absent weather; and an active filter. Keep sample data clearly identified.

Required browser journeys:

- Open monitoring, find a named device, inspect all three measurements, and return to the overview without losing the map position.
- Open a critical incident, identify contributing sensors and timestamps, then acknowledge it as administrator without removing the evidence.
- Add a sensor, cancel a location change, save a different location, reload, and verify the correct persisted position and feedback.
- Apply several filters, select a device, change a filter so it no longer matches, and recover through the inspector's Show in list action.
- Scrub into history while real packets continue to arrive; verify the display remains consistently historical until Return to live is used.
- Run a scenario, change playback speed, seek backward, and compare truth and estimate at the same timestamp.
- Interrupt WebSocket/network access, inspect retained data and reconnect status, restore access, and verify recovery without duplicate alerts or context loss.
- Repeat the main monitoring and editing flows with keyboard-only input and on a touch-sized viewport.

Use Playwright screenshot comparisons for stable, reviewed states [U8]. Freeze time, seed data, use fixed map fixtures/camera, wait for fonts and chart rendering, and disable nonessential animations in those tests. Run comparisons in a consistent browser/OS environment. Do not mask the sensor markers, probability layer, or key controls to make a defective screenshot pass.

Inspect the first screenshot baselines manually. A screenshot matching an unreviewed baseline does not establish professional design. Update baselines only after checking the actual visual change and preserving the behavioural tests.

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

For every sensor, interpolate the frozen weather data at its location and simulated time, then add persistent device bias and temporally correlated noise. Begin with configurable example noise of about plus/minus 0.5 degrees Celsius and plus/minus 3 humidity percentage points; these are scenario settings, not hardware accuracy claims.

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
| Simulation | Add sensors/ignitions, gradual heating inside the configured radius, early downwind smoke, 70-degree critical alarm, burnout, pause/play/speed/seek. |
| Determinism | Same seed/config/input snapshots give the same scenario; seek/replay and uninterrupted runs agree within declared numerical tolerance. |
| Physics | Wind-from conversion, calm symmetry, faster downwind than upwind travel under equal conditions, barriers, slope direction, moisture sensitivity, grid/time-step convergence. |
| Inference | Timing of multiple detections changes the origin posterior; no truth access; healthy negative observations constrain hypotheses; faulty/stale sensors do not force certainty. |
| Temporal integrity | Replay before an alert does not use later readings; operational replay excludes late-arriving data and future weather runs; live updates continue while a viewer examines history. |
| Probability rendering | Fixed 0–1 legend, distinct unknown state, current-burning versus reached-by-time distinction, no automatic density scaling. |
| Providers | Timeouts, 429s, stale cache, missing terrain, absent NASA key, invalid response, longitude wrapping, and provider recovery. |
| ML | Reproducible preprocessing, matching train/inference units, event/geographic split checks, model load, calibration metadata, baseline comparison, unavailable/out-of-domain fallback. |
| Deployment | Fresh install, repeated install, database persistence, worker crash/restart, service reboot startup, static SPA routing, port binding, backup and restore. |
| Usability | Keyboard navigation, visible focus, accessible dialogs, colour-independent statuses, desktop and narrow-screen layouts, no unexpected browser errors. |
| Visual quality | Section 7 token consistency, reviewed desktop/mobile screenshots, readable map overlays, stable panel composition, complete loading/error/empty states, and recorded UX review. |

Use Playwright against the built React app and actual Express server, with a real test PostgreSQL instance. Mock external weather/map/satellite responses for deterministic CI; do not mock internal telemetry, authentication, persistence, or WebSocket delivery in the main E2E path. Keep an opt-in live-provider smoke test separate [T10].

Exercise MapLibre interaction, marker dragging, layer toggles, and timeline controls in a real browser. Configure CI WebGL/software rendering as needed and provide a clear fallback UI if WebGL is unavailable. Retain traces/screenshots on failure. Start with one Playwright worker on the reference server and run a broader browser matrix where resources permit.

## 15. Implementation milestones

Complete all milestones for the requested product. The ordering provides reviewable increments; it does not redefine the project as a smaller prototype.

| Milestone | Work | Completion evidence |
| --- | --- | --- |
| M0 — Contracts and research | Finalize source adapters, units, API schema, temporal semantics, source manifest, and known modelling assumptions. | OpenAPI draft, sample packets, source documentation, and reproducible sample scenario specification. |
| M0D — Frontend design foundation | Read the selected frontend-design skill and section 7; define tokens, screen composition, representative states, and a realistic fixture. | Design references, a rendered monitoring composition, selected-sensor/alert/mobile states, and an initial visual critique before broad UI implementation. |
| M1 — Application foundation | Workspace, Express/static React, Postgres/PostGIS, migrations, login, config, health checks. | Fresh local startup and protected mutation integration tests. |
| M2 — Real sensor workflow | Sensor CRUD, location history, ingestion, credentials, durable outbox, live delivery, history. | A packet sent to the new API persists and updates the browser; unauthorized writes fail. |
| M3 — Monitoring interface | Implement the section 7 design system and UX flows: map, list, all three charts, filters, status/incident UI, responsive composition, and interaction states. | Playwright monitoring/CRUD journeys, reviewed browser screenshots, keyboard/touch checks, and consistent map/chart/control styling. |
| M4 — Environmental inputs | Weather/current/archive adapters, land cover, elevation, OSM enrichment, caches, optional overlays. | Source provenance visible; recorded fixtures and provider failure tests pass. |
| M5 — Simulation | Surface-fire engine, synthetic sensors, multiple ignitions, deterministic clock, replay/checkpoints. | Seeded scenario reproduces gradual sensor response and is stable under seeking. |
| M6 — Inference | Detection features, candidate origins, ensemble correction, uncertainty, probability layers. | Blind synthetic tests demonstrate localization updates without ground-truth leakage. |
| M7 — Satellite history and ML | FIRMS integration, coverage-aware dataset pipeline, small TensorFlow model, evaluation, export, scale-matched combination. | Real historical benchmark results, model card, trained artifact, and documented domain/fallback. |
| M8 — End-to-end quality | Full E2E flows, failure cases, section 7 visual/usability review, accessibility checks, load and resource measurements. | Test report, reviewed visual baselines, UX_REVIEW.md, and measured performance; no unresolved blocking interaction defects. |
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
