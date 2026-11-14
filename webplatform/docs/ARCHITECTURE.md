# Dryspell architecture

Contract revision: 1.1.0. The baseline contained project instructions only. All implementation stays inside webplatform.

Express serves compiled React and HTTP/WebSocket on port 4000. PostgreSQL/PostGIS is authoritative for sessions, real observations, scenarios, immutable revisions, jobs and durable outbox. A separate Node process claims leased jobs, runs deterministic simulation and inference, writes checkpoints and observations, and emits outbox events. The web process delivers committed events; socket loss cannot undo acknowledged telemetry.

Packages: contracts (wire/domain types), simulation (pure deterministic engine), inference (observations-only estimation and experimental ML), data-sources (bounded providers and immutable prepared sample). apps/server owns persistence, auth, API and worker. apps/web owns the geographic workspace. No browser or HTTP dependency is permitted in the scientific packages.

Simulation truth and inference have distinct inputs. PredictionInput deliberately contains no Scenario, Ignition, SimulationFrame or truth raster. Environmental snapshots are immutable and include numerical grid, weather and provenance. Terrain inspection reads the exact grid used by the engine. Presentation state never enters the engine.

Anonymous viewers inspect and replay; all persistent changes require a server-side administrator session. Device credentials authenticate only allowlisted telemetry. Configuration secrets stay outside static assets. Real data and simulated observations have separate persistence contexts.

Worker tasks use leases and revision checks. A result from an obsolete scenario revision must not advance the active revision. Checkpoints and output times are deterministic and unique by scenario/revision/time. Each browser's cursor is local view state.

The worker holds a PostgreSQL advisory lock for its process lifetime. Its replacement immediately reclaims abandoned leases after that connection closes. Simulation commits recheck scenario revision, authoritative time and job ownership under row locks. Compatible persisted checkpoints restore engine state after a hard restart; an engine-version change requires a new scenario revision. Multiple delayed observations can arrive for one sensor on the same delivery tick, so observation identity, rather than delivery time, controls idempotency.

Durable outbox allocation is serialized through commit with a transaction advisory lock. Heavy telemetry analysis bookkeeping precedes event allocation to minimize that lock's duration. Every accepted packet and corresponding event commit together. WebSocket viewers receive a filtered committed snapshot and subsequent ordered events; reconnect can resnapshot when an old cursor is unavailable.

Daily model requests run as durable worker jobs. Production model absence remains an explicit scale-qualified fallback. The operational estimator uses observations, receipt cutoffs and available-at-issue weather; it cannot read simulation truth. Hourly weather refresh creates a new immutable environmental snapshot and never mutates a historical run's inputs.

Windows development binds HTTP/WS to127.0.0.1:4000 and PostgreSQL to127.0.0.1:55432. No local firewall change is required or performed. Ubuntu delivery scripts are separately documented, unexecuted deployment artifacts.

## Anonymous sandbox (sandbox-v1)
The new apps/sandbox entry is independent of the administration App, PostgreSQL and WS. It serves compiled React and a narrow weather proxy through its own Express process on127.0.0.1:4001. Existing services stay on their existing addresses. The temporary MapLibre adapter reads the existing attributed terrain fixture; it does not acquire new geographic data.

A browser Web Worker uses the same deterministic simulation package as the server. Local IndexedDB stores a versioned document containing scenario, immutable environment, cursor and computed frontier. Reload restores a paused viewer. Local edits never call protected persistent mutation routes. Real-device authorization remains unchanged.

EnvironmentProvider, MapPort and local document storage are replacement boundaries for the external map/PostgreSQL work. Weather is fetched from Open-Meteo, aligned to scenario start and frozen within a composite environment ID. No synthetic weather is silently substituted. Forecast availability time is recorded as retrieval time, not misrepresented as provider model issue time.

## Anonymous sandbox regional map boundary
The sandbox at loopback 4001 compiles React and a dedicated numerical Web Worker separately from the existing authenticated platform. Express provides weather, the prepared immutable analytical environment and a bounded same-origin PNG adapter to the existing map service at loopback 4177. Regional tile colors and layer visibility stay in the presentation path; the worker receives analytical cells and frozen weather, never tile RGB. Prepared cells retain original ESA numeric classes for inspection and display. IndexedDB stores scenario inputs, model identity, cursor and frontier; an incompatible model requires a visible rerun instead of silently rewriting old results. This path does not persist sandbox experiments in PostgreSQL. Arbitrary-area analytical terrain remains a separate integration dependency documented in MAP_INTEGRATION.md.

## Arbitrary-location/custom-duration architecture update
The anonymous sandbox now prepares analytical areas directly through shared bounded raster adapters. POST /api/sandbox/environment/prepare validates coordinates and a 1–20 km local width, uses at most 200 cells per side, obtains ESA classes and Copernicus heights, and returns one terrain/weather snapshot. An eight-entry memory cache and two concurrent preparations bound provider work; requests for the same terrain deduplicate. No fixture relocation, tile-color analysis or database write is used. The external map service remains the display provider, not a blocker for numerical area preparation.

Custom positive hours replace the fixed duration menu and runtime cap. Forecast requests are bounded to the provider's available 16-day request range; after actual complete coverage, a labelled constant-condition tail extends the scenario to the requested end. A frozen scenario records that assumption. Directional rate tables use bounded six-hour chunks, sensor checkpoints are capped at512, and chart/history transport retains a six-hour receipt-time window. Cooperative deterministic reconstruction recovers older observations. Duration does not allocate a horizon-sized raster or observation buffer, though numerical work for an uncached seek remains proportional to elapsed simulation time.
