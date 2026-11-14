# Independent implementation review

Reviewer: independent QA agent, 14 November 2026. No reviewed implementation files were authored or modified by this reviewer. Initial contract revision: 1.0.0; final follow-up: 1.1.0, engine 1.1.2. Review covered the working tree while frontend/backend integration continued; no release commit was supplied. All searches and writes stayed inside webplatform. This report is not a release acceptance certificate. Historical handoffs below retain their original evidence and pending statuses; the final follow-up section supersedes those statuses.

**Final handoff:** no known unresolved P1/P2 implementation finding from this review. R11's environmental-extent boundary fix is source-verified only; an actual extent-switch browser journey was not executed. R12 and the chart/fire/estimate/native-zoom visual defects are closed for the inspected final captures. The coordinator reports the final actual-stack run passing 84 tests in 18 files, six Chrome E2E journeys, restart/load checks and HTTP/static/auth/WebSocket smoke checks. Provider access, real historical training, scientific accuracy and Ubuntu/reference-machine verification remain explicitly incomplete. See the final disposition at the end for evidence ownership.

## Executed evidence

- Read AGENTS.md, IMPLEMENTATION_PLAN.md, UI_DESIGN_RESEARCH.md, WORK_STATUS.md and CONTRACTS.md; inspected server persistence/auth/telemetry/socket/worker, simulation/inference, frontend map/history/charts, maintenance and deployment sources.
- `npx tsx tests/review/reproduce.ts` initially reproduced duplicate-evidence posterior corruption and future-issued-weather leakage. Independently reran after coordinator fixes: duplicate posterior exactly equal; unavailable-at-cutoff weather rejected.
- `npx tsx tests/review/database.ts` used the actual PostgreSQL test database, with an explicit `_test` database guard. The second outbox transaction could not allocate its event until the first committed; ordered cursors were 20 and 21. The test also ran the actual maintenance script twice: two 91-day-old readings were aggregated before raw deletion; count 2, minimum 20, maximum 80 and mean 50 survived the second pass. Review-tagged data was cleaned up.
- Independently requested `http://127.0.0.1:4000/health/ready`: HTTP success, database connected, worker healthy, prepared landscape ready, FIRMS explicitly unavailable because FIRMS_MAP_KEY is missing.
- No full browser journey or visual acceptance was performed by this reviewer in this handoff. The coordinator owns browser evidence. No Ubuntu installation, reboot, backup restoration, load target, real-data model training or scientific accuracy was independently verified.

## Findings and fix status

| ID | Severity | Finding and reproduction | Status at handoff |
|---|---|---|---|
| R1 | P1 | **Outbox cursors could skip acknowledged committed data.** In `apps/server/src/db.ts` event allocation and `socket.ts` cursor polling, transaction A could allocate N, B allocate/commit N+1, a viewer advance to N+1, then A commit N and remain invisible forever. Snapshot boundaries had the same race. | **Resolved and verified against PostgreSQL.** Event allocation now holds a transaction advisory lock through commit; pool-level emission is wrapped in a transaction. Two-transaction check passed. |
| R2 | P1 | **History moved yesterday's readings to today's sensor coordinates.** `App.tsx` previously fetched current sensors for History and `TerrainMap.tsx` rendered their current locations. Reproduce by recording at A, moving to B, then selecting the earlier time. | **Resolved in source; browser/API regression pending.** Frontend now requests `/sensors?at=...`; backend selects the effective-dated location. |
| R3 | P1 | **Old History cursors returned empty charts.** `/sensors/:id/readings` previously defaulted `from` to wall-clock now minus 24 h even with an older `to`; frontend supplied only `to`. Reproduce a cursor more than 24 h old: from exceeded to. | **Resolved in source; historical API regression pending.** Defaults now derive from selected `to`, range validation exists, frontend sends the selected range. |
| R4 | P1 | **Duplicate observations changed inference despite once-only processed IDs.** `packages/inference/src/index.ts` deduplicated during likelihood updates but used duplicates in candidate generation and correlation weighting. `[A,B]` and `[A,A,B]` both processed IDs A/B, yet no-fire probability changed from 0.4018855779 to 0.3622359902. | **Resolved and independently rerun.** Deduplication occurs before candidate/correlation computation; exact posterior equality now holds. |
| R5 | P1 | **Operational replay admitted future weather forecasts.** `predictFireSpread` accepted an input issued 2026-01-01 00:10 with weather issued 2026-01-02, without rejection or warning. Observation receipt filtering alone did not prevent this leakage. | **Resolved and independently rerun.** Future-issued weather is rejected unless explicitly retrospective. |
| R6 | P1 | **Retention could corrupt hourly aggregates and discard never-aggregated raw rows.** `scripts/maintenance.ts` clipped aggregation at now minus retention, then overwrote a complete oldest hour with only its suffix before deleting the prefix. On first maintenance, older rows were excluded from aggregation and deleted. | **Resolved and verified against PostgreSQL.** All completed raw hours aggregate before deletion; raw cutoff is rounded to an hour. Two-pass test retained count/min/max/mean. |
| R7 | P1 | **Dense Live histories can show stale inspector values while the marker is current.** Backend history is ascending with LIMIT; frontend requested 1,200 records from 24 h and selected its latest from that truncated set, while the marker used sensor_latest. Reproduce with over 1,200 packets and a critical final packet, reload and inspect before another packet arrives. At one packet/minute, this starts after 20 h. | **Assigned to frontend/backend; verification pending.** Inspector must use authoritative latest observation independently of bounded chart history. Chart query must fetch/paginate a recent matching window. |
| R8 | P2 | **Antimeridian rendering and picking diverged from engine geometry.** `TerrainMap.tsx` used raw east minus west in cellAt, polygon and fitBounds, while the engine wraps longitude. A prepared crossing extent (west positive, east negative) produces backwards/large geometry and wrong terrain cells. | **Assigned; source/rendered regression pending.** Share wrapped mapping and check actual crossing extent. |
| R9 | P2 | **Persisted checkpoints were not consumed by worker restart.** The worker imported only simulateFrame/createCheckpoint and recomputed from the start after process loss. Checkpoint persistence existed, but no restore path used it. Deterministic recomputation may remain correct, but the required checkpoint recovery/performance path was incomplete. | **Assigned; restart regression pending.** Restore the nearest compatible stored checkpoint and verify resumed frames match uninterrupted frames. |

P1 findings affect correctness or accepted-data delivery. P2 findings remain required scope and cannot be marked complete merely because the prepared local fixture works.

## Acceptance gaps requiring explicit tracking

The simulation/inference author's handoff identifies remaining internal implementation work: synthetic dropout/stuck/spike/delayed fault configuration; spatial convergence evidence and grid directional bias; hypothesis rejuvenation/resampling; richer temporal evidence and independent localization evaluation; daily ML runtime integration/model promotion; TFRecord CRC verification. These are implementation or validation gaps, separate from external data access. The empirical engine must not be described as complete Rothermel/FARSITE implementation.

Real historical model training still requires georeferenced complete-event/geographic/time split metadata and benchmark shards. A successfully parsed public byte range does not establish a leakage-safe corpus or trained model. Missing FIRMS credentials, incomplete provider execution and absent Ubuntu verification remain external/verification gaps. No scientific prediction accuracy follows from browser or deterministic tests.

The coordinator reported three integrated tests and 16 package tests passing before the latest review fixes, and an initial Chrome composition inspection. Those are coordinator-reported results, not independently rerun here; the final handoff must state the latest actual command results and remaining browser/visual gates.

## Reviewed fix identities

SHA-256 recorded after independent recheck (later implementation edits may supersede these):

- `packages/inference/src/index.ts`: `E4676825F7DCCB89751D8171B74C53090BCBE4290F986808927482357699648E`
- `apps/server/src/db.ts`: `B371B1FAE733AD023C1427384FAB9A186C18D6881BE8446FF55128DDF03077D9`
- `scripts/maintenance.ts`: `07F1345C853E85BB03100B3B79D9B4A2FC55A16CDAD4243DE5348741C98EDE57`

Review-owned reproduction scripts are in tests/review. They exercise actual source functions and PostgreSQL; they do not replace internal services with fixtures and claim integrated success. The small scientific fixture used to isolate inference bugs is explicitly synthetic.

## Modelling 1.1 follow-up review

Contract 1.1.0 / surface-grid-1.1.0 / sensor-ensemble-1.1.0 reviewed on 14 November 2026. Scope: the new 16-neighbour propagation stencil, explicit fuel subset, fault windows, temporal sensor memory, resampling/rejuvenation and daily model fallback. The review did not restart the stopped application stack or run a build.

Executed `npx vitest run packages/simulation/src/advanced.test.ts packages/inference/src/inference.test.ts packages/inference/src/ml.test.ts`: **15 tests passed** (4 simulation, 7 inference, 4 ML). This includes synthetic CPU train/export/load and promotion/domain/scale gates, not real historical training. Duplicate-posterior preservation and future-weather cutoff tests continue to pass. Inspected resampling preserves no-fire/fire mass and recomputes arrivals after rejuvenation. The extended stencil checks its crossed intermediate cells; residual angular bias and the equivalent-dead fuel approximation remain modelling limitations, not a scientific accuracy claim.

### R10 — P1: delayed observations arrive early, repeat IDs and disappear at window end

**Affected file:** `packages/simulation/src/index.ts`, `frameFromState`, active fault/delay/observedSec logic. **Status: reproduced; fix pending at this handoff.**

Run `npx tsx tests/review/modelling-v11.ts`. For a 20-second delay active over sample window `[0,30)`, the current engine emits sample 0 at frame 0, then repeats the same observation ID at frames 5, 10, 15 and 20 with different receipt timestamps. At frame 30 it jumps to sample 30, permanently omitting samples 10, 15, 20 and 25. The persistence layer's ON CONFLICT keeps the first, incorrectly early receipt of sample 0. The existing delayed checkpoint test checks one interior time and therefore misses startup/window transitions.

Expected semantics: evaluate faults at the observation sample time, schedule that sample's receipt at sample time plus delay, emit nothing before it is due, and deliver queued samples after the delay window ends. Observation IDs must remain stable and each receipt should be emitted once. Multiple due samples may occur for one device at a delivery tick; consumers must choose current readings by observation time while retaining all arrived history. Rewind/checkpoint tests must include delay startup and ending transitions.

Other status updates based on source inspection: worker now imports and restores persisted checkpoints (R9 source fix, hard-restart verification belongs to the coordinator); frontend contains historical-location/latest-reading and wrapped-geometry changes (R2/R3/R7/R8 still require their rendered/API regressions). The coordinator reports newly added TFRecord CRC32C validation and a successful known-vector/valid-record/corruption check; the reviewer has not independently rerun that Python check.

## Final focused follow-up — contract 1.1.0 / engine 1.1.2

Reviewed the integrated working tree on 14 November 2026. No implementation edits or build were performed by this reviewer. The coordinator retained ownership of the running application and browser harness. The following checks were **executed independently** in this follow-up:

- `npx tsx tests/review/modelling-v11.ts`: passed. The revised reproduction enumerates every delivered observation rather than selecting only the first reading for a sensor. All 13 sample times from 0 to 60 seconds are delivered exactly once. Samples in the delay window arrive 20 seconds later, including queued receipts after the window ends; current and delayed samples coexist at delivery tick 30. No early receipt or duplicate observation identity remains.
- `npx tsx tests/review/reproduce.ts`: passed. Duplicate evidence produces exactly the same posterior (no-fire probability 0.41251331184313367), and future-issued operational weather is rejected.
- `npx vitest run packages/simulation/src/advanced.test.ts packages/inference/src/inference.test.ts packages/inference/src/ml.test.ts`: **15 passed**. These use explicit synthetic fixtures, including a small CPU TensorFlow train/export/load check; they do not establish historical training or predictive accuracy.
- `npx tsx tests/review/history.ts`: passed against the actual guarded PostgreSQL `_test` database and actual Express routes through an isolated loopback Supertest server. Unique review fixtures were cleaned up, with no global truncation or changes to the main database. Historical sensor coordinates returned A while current coordinates returned B. An older-than-one-day chart request returned 1,200 recent records out of 1,201, with the final critical 71-degree observation first. The authoritative latest route returned the same critical value.
- `npx vitest run apps/web/src/geography.test.ts`: **2 passed**. Wrapped longitudes map to the same cell, outside coordinates are rejected, and an antimeridian extent is represented as a short continuous interval.
- Visually inspected retained actual-browser captures `output/playwright/03-selected-rewind.png` and `output/playwright/08-mobile-inspector.png`. Desktop and mobile use the map workspace, contextual inspector and bottom transport. The desktop capture contains the known empty chart and crowded axis that the frontend owner was fixing during this review; that old image cannot establish the corrected chart's visual acceptance. This was artifact inspection, not a newly executed browser journey.

### Superseding finding status

| Finding | Final status and evidence |
|---|---|
| R1 / R6 | Resolved and independently verified against PostgreSQL during the first review; no contradicting regression found in the final source review. |
| R2 | Resolved; historical/current location API regression independently passed. Frontend source requests the historical cutoff. Full browser movement/replay evidence belongs to the coordinator. |
| R3 | Resolved; old-cutoff API regression independently passed. Frontend source sends the corresponding selected-time range. |
| R4 / R5 | Resolved; independent reproductions rerun successfully on the current source. |
| R7 | Resolved in source and API regression. Recent bounded history and authoritative latest both contain the critical final sample; frontend inspector includes authoritative marker readings. The separate chart rendering correction still requires refreshed browser evidence. |
| R8 | Resolved in source and geometry tests. A rendered antimeridian journey was not independently executed. |
| R9 | Resolved in source; worker restores compatible persisted checkpoints, checks engine identity and validates ownership/authoritative time before committing. Coordinator's actual process restart evidence reports deterministic recovery; the reviewer did not independently kill/restart the worker. |
| R10 | Resolved; independent delay-window reproduction now verifies every sample, startup, window ending, duplicate identity and overlapping receipts. |

No additional P1 or P2 defect was reproduced in this focused final pass. This statement is bounded by the checks above and is not a claim that all deployment, provider or scientific acceptance criteria have passed.

### Coordinator-reported integrated evidence

The coordinator reports `npm run verify:stack` passing **70 tests in 15 files and 2 Chrome E2E journeys**, with compiled Express/static React, actual PostgreSQL/PostGIS, worker and WebSocket delivery. The reviewer read the retained evidence artifacts but did not independently rerun this complete harness:

- `docs/evidence/restart-check.json`: worker hard-restart/checkpoint determinism and web restart session preservation; 313 telemetry rows before and after restart.
- `docs/evidence/load-check.json`: 300 acknowledged, persisted and WebSocket-delivered packets across 30 devices in approximately 10.1 seconds; ingestion p95 446 ms and WebSocket p95 372 ms. This is a Windows/Docker burst measurement, not the required Ubuntu reference-machine endurance certification.
- `docs/evidence/database-recovery.json`: actual PostgreSQL dump/restore into a separate test database and container restart. This does not establish full Ubuntu installation/reboot or configuration/model-artifact recovery.

### Remaining acceptance boundaries

The earlier internal modelling gap list is historical: fault configuration/queued delivery, the extended stencil and blocker checks, temporal memory and resampling, daily model loading/promotion gates, and TFRecord CRC validation now have implementation and focused test evidence. The fire model remains a documented equivalent-dead fuel subset with residual directional/discretization limits. Nothing here certifies scientific prediction accuracy or equivalence to a complete operational FARSITE model.

FIRMS live access still requires `FIRMS_MAP_KEY`; the OSM environmental endpoint is blocked in this environment; leakage-safe real training requires complete georeferenced event/geographic/time split metadata and benchmark shards; Ubuntu installation, reboot and reference-machine resource/endurance verification remain incomplete. Sample datasets and deterministic provider fixtures must remain labelled separately from live-provider verification. Fresh browser chart evidence after the pending frontend correction must be supplied by the coordinator before closing that visual gate.

Review-owned scripts and this report are the only files modified by this reviewer. Final integration steps are to retain refreshed chart captures, rerun checks affected by any subsequent fixes, and carry the external/deployment boundaries into the final delivery report.

## Narrow final integration review — chart, snapshots and compression

Reviewed the subsequent working-tree changes on 14 November 2026: `apps/web/src/App.tsx`, `TelemetryCharts.tsx`, short-height rules in `workspace.module.css`, HTTP compression in `apps/server/src/app.ts`, bounded WebSocket compression in `socket.ts`, and the regional normalized-data converter. No implementation files, database rows or browser sessions were changed by this reviewer during this pass.

Read the current [Vercel review procedure](https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/web-design-guidelines/SKILL.md) and [interface rules](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md), accessed 14 November 2026. Applied them to the changed interface files within the authoritative map-workspace brief; no installed skill package or full accessibility certification is claimed.

The chart merge now rejects mismatched sensor/scenario/revision observations, applies both observation and receipt cutoffs, deduplicates identities and retains received frame observations while persisted history loads. The chart keeps missing values separate from zero, renders a single received point, uses linked time axes and exposes an exact-value table. The actual-browser artifact `output/playwright/11-chart-rewind-regression.png` was independently inspected: three series are present, the smoke zero line remains visible, missing humidity is explicitly labelled in the table, and the bottom time labels are readable. The scrolled inspector clips the upper temperature plot in this particular capture; this is a scroll position, not evidence that the chart is absent. This closes the formerly empty/crowded chart finding for the captured state.

The coordinator's chart E2E source was also inspected: it delays delivery of an actual history response while retaining the real authentication, database, worker and state routes. It verifies the immediate frame observation, then three merged rows after releasing history. This reviewer did not rerun that browser test while the coordinator's full-stack harness was active.

Snapshot consumption checks matching scenario/environment identities and revision before replacing workspace cache. The environment query avoids a redundant default-environment request when a scenario is selected. HTTP compression has a 4 KiB threshold; WebSocket compression uses the same threshold, disables context takeover and limits concurrent compression to two operations. No material new defect was reproduced in these changes; sustained memory/CPU behavior remains a deployment measurement rather than a source-review conclusion.

Independently executed `npx vitest run packages/inference/src/regional.test.ts` after the Vitest 5.1 upgrade: **9 tests passed**. Inspected converter behavior includes union-area coverage accounting, cloud/unknown/bad-quality exclusion, explicit observed negatives, issue/receipt cutoffs, previous-mask-only spatial context, georeferenced 1 km outputs and disjoint event/geographic/month split checks. These inputs are normalized synthetic records. The converter explicitly does not decode raw VIIRS swaths/HDF files, and these tests do not constitute real satellite training/evaluation or demonstrate scientific accuracy. The coordinator reports zero npm audit findings after dependency upgrades; this reviewer has not independently rerun npm audit.

Final selected/composition/native-200%-zoom capture inspection is pending the coordinator's refreshed artifacts at this point in the review log. Earlier external-provider, training-data and Ubuntu/reference-machine limitations remain in force.

### Creation-path regression found by the coordinator's expanded harness

The coordinator's new ten-minute progression browser test exposed that scenario POST discarded supplied ignition/configuration fields, leaving Run disabled. This was a real API defect found by that harness, not independently discovered by the reviewer. The coordinator corrected `apps/server/src/domain.ts:newScenario` to parse the existing edit schema, retain supplied inputs while keeping revision 1, normalize simulated sensors, and validate ignition terrain and time zone. The route resolves the requested environment before calling the constructor.

Independently inspected this fix and executed `npx vitest run apps/server/src/scenario.test.ts`: **2 tests passed**. They verify supplied inputs/seed zero/profile capabilities and rejection of invalid terrain/configuration/time zone/unknown fields. No material defect was identified in the fix. Compiled API and browser rerun evidence was still pending the coordinator's rebuild at this entry.

### Snapshot cancellation and native zoom follow-up

The coordinator subsequently reported 82 non-browser tests plus restart/load checks passing, with 4 of 6 browser tests passing. The browser failures exposed the creation bug above and a snapshot-cancellation race: cancelling an in-flight query with `revert:false` without waiting could leave `CancelledError` visible over the Coordinates control. This was discovered by actual browser execution after the earlier source review; the earlier source-only result must not be read as proof that runtime snapshot handling passed.

Reviewed the corrected `App.tsx` snapshot handler: it now waits for cancellation using default state reversion, reads the latest cache/revision after cancellation, then writes the snapshot. The coordinator also moved the desktop error banner below the placement hint and lifted the narrow-screen legend above map attribution. These corrections need the coordinator's rebuilt browser rerun; this reviewer did not reproduce the cancellation race independently.

Independently inspected updated `output/playwright/12-native-zoom-200.png` and `13-native-zoom-inspector.png` from the actual native Chrome zoom test. All five compact object tools remain visible above transport, and the sensor-list inspector and its close control remain accessible in the captured layout. The test source sets native zoom to 2, asserts a 720 CSS-pixel viewport and device-pixel ratio 2, and hit-tests each tool. The retained images still show the known lower legend/attribution overlap that prompted the subsequent CSS correction. Refreshed composition/selected/legend evidence and the complete successful browser rerun remain pending at this log entry.

### Vector-rendering migration and final source findings

The coordinator reported the expanded compiled-stack harness passing 84 non-browser tests, restart/load checks and six browser journeys. Subsequent visual inspection nevertheless found a missing fire footprint despite populated engine cells. This demonstrates why state/API assertions alone did not establish map rendering. The coordinator added the MapLibre 6 worker URL and rendered-feature assertions for both fire and estimate layers. The reviewer checked `TerrainMap.tsx` against the official [MapLibre v6 migration guide](https://github.com/maplibre/maplibre-gl-js/blob/main/docs/guides/v5-to-v6-migration-guide.md), accessed 14 November 2026: bundled applications require explicit worker configuration. The installed 6.18 worker is self-contained, and the code configures its same-origin URL before Map construction. Rendered-vector verification remains pending the new browser rerun at this entry.

Independently inspected refreshed captures 03, 06, 07, 08, 12 and 15. The selected-temperature chart is now populated and shares the transport cursor. The shelf and strip studies show the same terrain/scenario; the chosen strip leaves more central terrain visible. Mobile inspection and touch rewind retain the map, contextual sheet and bottom time controls. These composition conclusions do not establish vector fire/estimate visibility before the new assertions pass.

| ID | Severity | Reproduction / affected source | Current status |
|---|---|---|---|
| R11 | P2 | `apps/web/src/TerrainMap.tsx:38`: select an environment with a different extent. Existing effective raster uses `updateImage` and the camera fits new bounds, but the boundary GeoJSON is only created in the initial branch and never updated, leaving the dashed prepared-area boundary at the old extent. | Confirmed in source; browser switch journey not independently executed. Reported to coordinator to update boundary data alongside raster coordinates. |
| R12 | P2 | `apps/web/src/workspace.module.css` final short-height media rule: updated `12-native-zoom-200.png` shows legend/notice at left 12 CSS px underneath left navigation controls. The compass/zoom strip obscures the Active fire key and part of the basemap notice. | Independently observed in the refreshed native-zoom artifact; reported to coordinator to keep legend/notice to the right of navigation controls. |

Subsequent source recheck: R11 now calls `setData` on the boundary source whenever the effective environment image changes. R12 now offsets short-height legend and notice to 82 CSS px from the left. Both are resolved in source; rendered recheck remains pending.

The coordinator's ten-minute progression check reached 590 of 600 simulated seconds before its 120-second wall-clock deadline. The coordinator increased that verification deadline to 180 seconds and removed repeated database transfer/parsing of the immutable environmental snapshot by adding a four-entry worker-local cache. Reviewed cache correctness: keys are immutable environment IDs; only successful reads insert; FIFO eviction bounds entry count to four; process restart clears the cache; new weather/terrain snapshots use new IDs; current consumers do not mutate cached snapshots. Worker jobs run sequentially. No new correctness issue was identified. The bound is by entry count, not bytes, so Ubuntu/reference-machine memory verification remains necessary. The coordinator is rerunning the full stack because worker code changed.

## Final disposition after rebuilt stack verification

The coordinator reports the final rebuilt harness successfully completed **84 tests in 18 files, all six Chrome browser journeys, worker/web restart checks, the telemetry load check, and HTTP/static/auth/WebSocket smoke checks**. This includes the revised rendered-fire and rendered-estimate assertions, scenario creation, chart history, touch flow and native zoom. These whole-stack results were executed by the coordinator, not independently rerun by this reviewer. The final restart artifact records deterministic worker recovery and 1,227 telemetry rows before/after web restart. The final load artifact records 300 acknowledged/persisted/WebSocket-delivered packets, ingestion p95 288 ms and WebSocket p95 238 ms over 10.1 seconds on Windows/Docker.

Independently inspected the final artifacts:

- `14-ten-minute-fire.png`: actual orange burning cells and dark burned interior render over terrain, with the transport at 00:10:00 and the scenario completed. The formerly missing fire layer is visibly corrected.
- `05-compare.png`: visible yellow estimated-fire cells, fixed probability legend, explicit uncalibrated/estimated-state wording, and matching 12:00:10 estimate/transport times. The dashed prepared-area boundary also renders. This verifies the displayed state, not prediction accuracy.
- `12-native-zoom-200.png` and `13-native-zoom-inspector.png`: the fire legend is now readable to the right of the map navigation controls; all five object tools, transport and inspector close control remain reachable. R12 is closed for these captured states.
- `15-touch-simulation-rewind.png`: mobile map, selected combined sensor, three capability-aware measurements, paused run and rewind cursor at zero remain in one workspace. This is visual inspection of the coordinator's actual touch-test capture, not a separate touch execution by the reviewer.
- The refreshed selected-chart, mobile-inspector and paired shelf/strip compositions were inspected earlier in this same final pass. The chart's selected time agrees with transport; the strip and shelf use the same scenario/terrain, and the chosen strip preserves central landscape visibility.

R11 remains **resolved in source, extent-switch journey unexecuted**; no rendered extent-switch claim is made. The coordinator-discovered creation, cancellation and MapLibre migration defects have source fixes and passing final affected browser evidence. No additional unresolved P1/P2 was found in this bounded review.

Final external/verification limits remain: FIRMS live credentials, the blocked OSM endpoint, actual VIIRS mask/geolocation/quality acquisition, complete leakage-safe historical training metadata/corpus and real evaluation, Ubuntu installation/reboot and reference-machine resource/endurance measurements. The regional converter and small TensorFlow tests use labelled synthetic inputs; no unavailable provider, untrained historical model or scientific accuracy criterion is certified here.

Reviewer write ownership is released after this entry. Only this report and `tests/review/**` were modified by the reviewer; no implementation source or shared configuration was authored.
