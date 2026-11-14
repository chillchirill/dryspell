# Integration contract 1.1.0

The authoritative TypeScript definitions are packages/contracts/src/index.ts. Amendments are coordinator-owned and announced before dependents change.

Revision1.1 adds optional simulated fault windows, per-device declared temperature ranges, typed connection/freshness status and posterior temporal memory. Existing profile capabilities and units remain compatible. Engine1.1.2 retains source-sample delayed delivery: a sample keeps its observation ID/time; receivedAt is scheduled delivery. Multiple samples may be delivered in one frame. Database time_sec indexes delivery ticks, while observation.simulationTimeSec records source time. Observation ID, not delivery tick, is the uniqueness key.

Added routes include bounded POST environment/prepare, GET environments, revisioned POST scenarios/:id/inputs, GET sensors/status, GET satellite with observation/receipt cutoff, and POST predictions/daily. Daily ML jobs use an operator-configured model directory and explicit 1km/24h feature schema; no client-selected filesystem path or invented features. Missing/unpromoted models return explicit fallback. Details and bounds are in API.md.

Coordinates are WGS84 longitude/latitude degrees; distances, grid cells and elevation use metres. Row-major cells run west to east, south to north. Local projection metadata accompanies every landscape. Temperature is Celsius, humidity percent RH, smoke normalized percent index (not air composition), wind metres/second from meteorological north clockwise. UTC ISO strings are used on the wire. Sensor profiles publish only declared channels. Undefined is missing, never zero; freshness is relative to the selected time and expected interval.

## Time semantics

Wall clock schedules work and receipt timestamps only. recordedAt is observation time; receivedAt is server receipt. startTime + timeSec identifies authoritative simulation time. Engine steps and samples are fixed and seeded. Run queues computation from the authoritative time; Pause run stops future progression after a committed step. Replay Play/Pause, playback speed and seek affect only that viewer. Seek returns a whole matching scenario/revision/environment/time frame and never persists duplicate observations. A post-run edit creates a new draft revision at time zero, preserving prior versions. Weather overrides also create immutable new input snapshots.

## HTTP

All routes below use /api/v1. Responses are JSON; errors use ApiError. auth/login POST {username,password}, auth/logout POST, auth/session GET. Session mutations send X-CSRF-Token and same-origin checks. sensors GET/POST, sensors/:id GET/PATCH/DELETE; readings GET ?from=&to=&cursor=&limit=. sensors/:id/credentials POST creates a separately scoped ingestion token. telemetry POST TelemetryPacket and telemetry/batch POST {readings:TelemetryPacket[]} use Bearer device token; return per-item accepted/duplicate/rejected. sensors mutations use Sensor fields with server-generated IDs and timestamps.

scenarios GET/POST, scenarios/:id GET/PATCH; POST actions /run /pause /stop /clone. PATCH accepts name, sensors, ignitions, environmentId, config and expected revision. Conflicts are 409. POST creation may omit fields to use prepared sample defaults. GET scenarios/:id/state?at=seconds&revision=N returns SimulationFrame. GET scenarios/:id/workspace returns WorkspaceSnapshot. GET scenarios/:id/readings?sensorId=&to=seconds returns ValidatedObservation[]. GET environment returns EnvironmentSnapshot (or ?id=). GET sources returns provenance/provider status. GET incidents; POST incidents/:id/acknowledge or /confirm. POST predictions queues PredictionInput; GET predictions/:id returns job/result. /health/live and /health/ready are outside API prefix.

## WebSocket

/ws?context=simulation&scenarioId=ID&cursor=CURSOR supports durable event resume. WsEnvelope cursors are decimal strings, monotonically ordered database sequence IDs. Fresh connections receive a snapshot boundary; expired cursors receive resync.required. Filtered cursor gaps are valid. Deduplicate eventId. Only subscription requests are accepted; persistent mutation requires HTTP authorization. Slow clients reconnect from the last applied cursor. scenario.progress payload is SimulationFrame; sensor.reading payload is ValidatedObservation.

## Package entry points

data-sources exports createSampleEnvironment(): EnvironmentSnapshot and provider adapters. simulation exports simulateFrame(scenario, environment, timeSec): SimulationFrame, createCheckpoint(scenario,environment,timeSec): SimulationCheckpoint and restore/replay helpers. Inference exports predictFireSpread(input: PredictionInput): Promise<PredictionResult>. Worker imports these source package exports through workspace names.

Persistence uses JSONB for bounded domain documents plus relational IDs, timestamps, uniqueness, spatial locations and indexes. Numerical frames/checkpoints are bounded/compressed; no per-cell per-animation-row storage. External failures are explicit unavailable/stale states. No fake persistence fallback may claim PostgreSQL integration.

## sandbox-v1
Additive browser-worker contract in packages/contracts/src/sandbox.ts; existing domain contract1.1 stays compatible. Commands: load(scenario,environment,generation), run(speed), pause, seek(timeSec), dispose. Every response carries generation and computedUntilSec; frame carries scenario/revision/environment/time/checksum. Ignore messages from obsolete generations. Load restores the frontier from scenario.authoritativeTimeSec; seek chooses the saved viewer cursor. Numerical and observation integration remain five seconds; speed affects scheduling only.

GET /api/sandbox/environment reads the attributed existing terrain fixture. Its bundled synthetic weather must be replaced before a fresh Run. GET /api/sandbox/weather?latitude=...&longitude=...&startTime=ISO returns WeatherSnapshot with explicit UTC offsets, Celsius, percent RH, m/s, meteorological wind-from degrees and preceding-hour precipitation millimetres. Requests are bounded to current starts, six-hour coverage and a15-minute/32-location cache. HTTP503 indicates unavailable weather and must not create a fictional reading.

SandboxDocument version1 stores scenario, environment, cursorSec and computedUntilSec locally. Authentication is not applicable to private browser edits; database publication remains a future explicit integration boundary.

## Sandbox regional-map and model additions — 14 November 2026
These backward-compatible fields extend the existing shared contracts without changing telemetry routes or persistence boundaries. `LandscapeCell.sourceClassCode?: number` retains original numeric ESA classification; `ecologicalZone?: string` retains an optional source label. Neither tile color nor display-layer selection is an engine input. The terrain inspector and engine consume the same immutable environment snapshot ID. `SandboxDocument.engineVersion?: string` identifies the model that produced the saved frontier. Older or absent identity invalidates computed output, resets the cursor/frontier to zero and visibly requests a rerun while preserving scenario objects, duration and weather. Current model is `surface-grid-1.2.0`.

The anonymous server exposes `GET /api/sandbox/map/tiles/{layer}/{z}/{x}/{y}.png`, restricted to `landcover` (zoom 6–14) and `ecoregions` (zoom 3–14) with valid XYZ indices. It reads the fixed local map service on 127.0.0.1:4177, recolors land-cover display pixels, preserves alpha and returns PNG. Failures return HTTP 503 with an error and Retry-After; they do not substitute numerical environmental data. Bounded display caching is separate from IndexedDB scenario persistence. `GET /api/sandbox/environment` returns the prepared 40,000-cell snapshot including original source codes. No arbitrary-area analytical endpoint is claimed.

New sandbox durations are 3,600, 10,800 or 21,600 seconds; legacy shorter inputs remain supported. Fixed five-second numerical ticks and deterministic reconstruction are independent of playback scheduling. The saved weather snapshot must cover the complete selected duration.

## sandbox-v2: area and duration
`POST /api/sandbox/environment/prepare` accepts SandboxAreaRequest `{center:{longitude,latitude},sizeM?:number,startTime:ISO,durationSec:number}` and returns EnvironmentSnapshot on success. Server validates a provider-covered center and bounded local area (default 5 km); grid resolution adapts to at most 200 cells per side. Provider failure is explicit HTTP 503 and the client retains the previous experiment. Source class codes/elevation/water/attribution remain analytical inputs. New local areas may be selected anywhere provider coverage exists, including dateline-crossing bounds.

`validSandboxDuration` and `sandboxHoursToSeconds` replace fixed six-hour limits: positive custom hours round to five-second ticks, with safe integer/UTC date validation. Weather endpoint accepts durationSec. Beyond actual provider coverage, the last conditions can be extended as an explicit scenario assumption, recorded in provenance parameters `extensionPolicy: hold-last-conditions`, `forecastEndSec` and `extensionEndSec`, and visibly disclosed. This is not a provider forecast. Weather snapshots remain immutable once running. Runtime event `historyStartSec` identifies the oldest retained observation window; clients prune bounded chart histories, and rewind regenerates historical measurements. Internal sensor integration and render speed remain separate.
