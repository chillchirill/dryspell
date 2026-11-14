# Work status

## Current result: arbitrary-location preparation and custom hours implemented
The compiled anonymous sandbox runs at http://127.0.0.1:4001. Use this area prepares real local terrain anywhere covered by ESA/Copernicus providers; menu coordinates and 1–20 km width are available. Custom positive decimal hours replace the fixed duration choices. The server acquires sufficient real forecast data and explicitly marks constant-condition continuation beyond available coverage. Source classes, elevation and weather remain one immutable snapshot for map, inspector and engine.

All implementation and review slots are released. Root integrated sandbox-v2, bounded provider caches, deterministic long-run reconstruction and bounded receipt-time history/checkpoints. Final build and typecheck passed; independent verification passed 105 unit tests and seven distinct browser cases across documented runs. Root owns the integrated tree and status; no subagent spawned agents, and at most two of our subagents ran concurrently. Existing map/4000 services and iot were not changed.

Actual Carpathian and California analytical area acquisition passed. Independent six-case browser verification passed real-area preparation, four profiles/run/reload, 12.5-hour reconstruction/rewind, custom durations, legacy imports, cancellation/failure preservation and responsive controls. Final short-height legend fix and tile retry received targeted checks; latest final results are appended below. This supersedes the fixed-Glendalough/six-hour limitations in historical entries.

Provider coverage remains a real boundary (including polar/missing raster tiles). No world-sized simultaneous grid, instantaneous arbitrary-duration replay, scientific accuracy or Ubuntu deployment certification is claimed. Weather remains Open-Meteo, not WeatherAPI. Full historical platform/provider/ML blockers below remain separate.

## Previous regional map / six-hour delivery
The latest revision runs at http://127.0.0.1:4001 on Windows loopback only. Actual map-service land-cover and ecological-zone tiles are integrated with a natural palette: visible forest/grass/steppe, wheat cropland and neutral towns. The outlined 25 m numerical grid retains original ESA source classes and the same environmental snapshot in the inspector and engine. New experiments default to six hours with 1/3/6-hour choices. Engine `surface-grid-1.2.0` increases downwind spread linearly below the existing safety cap; north-up display, eight-direction tests and explicit old-model rerun migration prevent ambiguous direction/history interpretation.

Final build, workspace typecheck and 68 unit tests in 14 files passed. Independent QA verified all 11 distinct Chrome cases across the initial ten-pass/one-locator-failure run and three passing focused reruns. Actual six-hour worker reconstruction, deterministic rewind, layer/checksum independence, migration, mobile touch and native 200% zoom passed. Coordinator and reviewer inspected final browser captures. Actual upstream/proxy map tiles passed separately; weather E2E uses labelled external fixtures. See `SANDBOX_REVIEW.md` and `TEST_REPORT.md` for exact evidence and limits.

All delegated agents have released ownership. Root owns the integrated tree. Frontend, Simulation and independent Reviewer worked in exclusive files without spawning children; no more than two of our subagents were active concurrently, reserving capacity for the external map agent. Shared contracts gained optional source-class/ecological labels and saved engine identity; contract additions are documented in `CONTRACTS.md`. No map files, existing map service, original port-4000 service, firewall or iot files were changed.

Remaining boundary: regional visualization works beyond the prepared area, but numerical simulation is still limited to the outlined Glendalough landscape. An arbitrary-area analytical grid/elevation API remains pending with the map project. Weather currently uses Open-Meteo, not WeatherAPI. Browser memory/endurance, scientific calibration and the historical production/Ubuntu blockers below remain unverified. Next independent milestone is the analytical-area handoff; no blocking defect remains in this bounded revision.

## Previous sandbox delivery
The simplified sandbox is running at http://127.0.0.1:4001 with no login or PostgreSQL dependency. The user rejected the previous workspace UX; this new entry replaces that journey while preserving the older application. Dark geographic styling follows the supplied reference. Four capability-aware profiles, direct placement/drag/move, ignition, real Open-Meteo weather, browser-worker run/pause/seek, charts, local recovery and export/import are delivered.

Verification: final build and typecheck passed;36 unit tests in9files passed. Independent QA passed a full7-browser suite plus3focused browser cases after layout refinements (8distinct cases), including native200%zoom and visible10-minute fire. Live provider HTTP acquisition was separately verified; browser tests replace only external weather. Final copy-only pause hint correction was built after those tests. No known blocking review finding remains. See SANDBOX_REVIEW.md and SANDBOX.md.

All subagents released ownership. Actual Frontend, Simulation and independent QA worked in exclusive directories; root handled server/weather/contracts/config/integration. At most2our subagents ran concurrently, reserving a slot for the external map agent. No subagent delegated.

User-authorized read-only inspection of D:/dryspell/map and its4177API confirmed actualPostgreSQL-backed point land-cover/weather acquisition. Arbitrary-area simulation integration remains incomplete: its API needs an analytical area grid and elevation data. Exact handoff is docs/MAP_INTEGRATION.md. No map files, DB schema or existing services were changed; no iot access occurred. Current simulation uses the existing attributed numerical WorldCover/Copernicus terrain with real frozen Open-Meteo weather. No scientific forecast-accuracy claim is made.

Original delivery records follow for history.

## Historical platform delivery summary — 14 November 2026

The compiled application is running on **127.0.0.1:4000 only**, with the main PostgreSQL database and analysis worker healthy. No Windows firewall rule was added. Local process IDs and logs are under ignored `data/private/`; test login credentials are in ignored `.env.test`. Original AGENTS.md, IMPLEMENTATION_PLAN.md and UI_DESIGN_RESEARCH.md content was preserved; no `../iot/` files were inspected or changed.

Contract **1.1.0**, engine **surface-grid-1.1.2**. All subagents have completed and released ownership. Actual frontend, backend, simulation and independent-review roles were used; no subagent delegated, and the maximum was coordinator plus three active subagents. Coordinator owns the integrated working tree, contracts, dependencies and this status file.

| Milestone | Current status |
| --- | --- |
| M0 / M0D | Contracts, explicit clocks, architecture, source references, two same-fixture compositions and rendered design decision delivered. |
| M1 / M2 | Compiled application, actual PostgreSQL/PostGIS persistence, authentication, device CRUD/history, real telemetry, credentials, durable WS and alarms implemented and integration-tested. |
| M3 / M5 | Full-map workspace and all sensor profiles; placement, save/reload, ignition, actual fire progression, charts, pause/replay/rewind, touch/keyboard and revision-safe editing verified. |
| M4 | Real prepared WorldCover/DSM terrain and live/archive/single-run weather acquired. Shared terrain inspection, environmental adapters and immutable overrides implemented. Overpass live enrichment remains unverified after provider failures. |
| M6 | Observation-only inference, temporal evidence, resampling and fixed-scale probability layers implemented and tested with explicit synthetic scenarios. No field accuracy claim. |
| M7 | FIRMS adapter, coverage-aware normalized regional preprocessing, TensorFlow training/export/evaluation/runtime pipeline implemented. **Incomplete:** live FIRMS key, raw VIIRS collection decoding/acquisition, georeferenced complete-event training corpus, real historical training/evaluation and production promotion. |
| M8 | **Local acceptance passed:** 84 tests in 18 files; six complete Chrome journeys plus one focused responsive-layout journey. Actual worker/web restart, WS load and DB restore checks passed. Broader browser/screen-reader and reference-machine endurance verification remain unexecuted. |
| M9 | Ubuntu scripts, Compose, systemd services and operational documentation delivered; shell syntax checked. **Incomplete:** clean Ubuntu installation, reboot, coordinated config/artifact restore and reference-machine verification. Windows localhost restriction was retained. |

Latest full-stack load: **300/300 packets persisted and delivered**, ingestion p95 **288 ms**, WS p95 **238 ms**. A short Windows/Docker run is not a 2-CPU/3-GB Ubuntu certification. Restart preserved 1,227 acknowledged telemetry rows and reproduced the uninterrupted frame checksum. `npm audit` reports zero vulnerabilities. See [TEST_REPORT.md](TEST_REPORT.md), [UX_REVIEW.md](UX_REVIEW.md) and [INDEPENDENT_REVIEW.md](INDEPENDENT_REVIEW.md).

Independent review has no known unresolved P1/P2 defects. R11 (boundary refresh after changing extent) is source-fixed; that specific browser journey was not executed. The final browser captures visibly show actual fire and estimate layers; the test now verifies rendered features, following correction of the MapLibre6 worker asset. The final tablet legend fix passed a focused browser overlap check at 1280, 768, 390 and 320 pixels.

Next steps requiring unavailable inputs/capabilities: provide FIRMS_MAP_KEY; obtain licensed VIIRS masks/geolocation/QA and complete-event/geographic/time metadata, plus matching physical forecasts; complete and validate collection-specific raw decoding; train/evaluate on real held-out data; restore Overpass access; and execute deployment/reference-load checks on an authorized clean Ubuntu machine. These are visibly incomplete, not silently represented by fixtures or UI test passes.

The dated entries below preserve the actual implementation and handoff history; this summary supersedes earlier pending statuses.

## Current execution boundary

User clarified Windows development/testing must stay on localhost. HTTP/WS local configuration, server fallback and verification harness now bind127.0.0.1:4000. No Windows firewall rule was changed; no public port opening or Ubuntu deployment is authorized for this Windows verification run. Docker PostgreSQL remains loopback-only127.0.0.1:55432. Future deployment scripts are deliverables, not executed deployment.

## Baseline — 2026-11-14

Read AGENTS.md, IMPLEMENTATION_PLAN.md and UI_DESIGN_RESEARCH.md. Only these three files existed. User changes: AGENTS.md and IMPLEMENTATION_PLAN.md modified, UI_DESIGN_RESEARCH.md untracked. Preserved untouched. No prior implementation milestones completed.

Node 24.14.1 and npm 11.11.0 available. Docker CLI 29.4.0 installed; daemon initially unavailable. PostgreSQL, actual provider access, browser, training and Ubuntu execution not yet verified.

## M0 contract handoff

Created workspace foundation, shared contracts v1.0.0, ARCHITECTURE.md and CONTRACTS.md before delegation. Defined capabilities/units, WGS84 coordinates, immutable environment IDs, revisions, error/WS/API envelopes and explicit clock semantics. This is implementation scaffolding, not verified acceptance.

Exclusive ownership: coordinator owns packages/contracts, all package/config/lock files, docs/WORK_STATUS.md, architecture/contracts, deployment, root scripts and integration tests. Frontend owns apps/web implementation and docs/DESIGN.md, DESIGN_REFERENCES.md, UX_REVIEW.md. Simulation owns packages/simulation, packages/inference and docs/MODELLING.md, ML.md. Backend owns apps/server, packages/data-sources, db, data/sample and docs/API.md, SOURCES.md (excluding package manifests). No subagent may spawn others. Maximum active agents: coordinator + three.

Next: start bounded implementation roles, restore Docker availability, install dependencies, integrate actual PostgreSQL/worker/WS journey, then independent review in a vacated slot. M1–M9 remain incomplete until executed evidence is recorded.

## Implementation handoff — in progress

Three actual agents active: frontend, simulation, backend; no children delegated and concurrency remains four total. Shared contract remains v1.0.0; added matching scenario prediction read route to documented API. Frontend has read Anthropic and Vercel sources and recorded the initial strip/shelf decision; rendered review is still pending. Simulation core and inference exports are written, with package-local invariant tests not yet executed. Backend schema, session/telemetry/CRUD/WS and worker sources are written; real integration is pending dependencies and sample acquisition.

Coordinator created Docker Compose, Ubuntu lifecycle/install/backup/restore/maintenance scripts and services, OpenAPI draft, actual-backend integration tests and Playwright configuration. Docker Desktop was started successfully; PostGIS image download is in progress. npm install initially failed because geotiff 2.1.4 is unavailable; corrected to registry-reported 3.0.5, then restarted installation. No lockfile/build/test success yet.

Executed Ubuntu WSL checks: bash -n passed install.sh, backup.sh, restore.sh. systemd-analyze verify could not verify deployment dependencies: WSL has no /usr/bin/node or docker.service; Windows-mounted permissions also emitted executable/world-writable warnings. Installer explicitly uses mode 0644 for installed service files. This is not a clean Ubuntu deployment test.

External data status: NASA FIRMS_MAP_KEY absent. Official Next Day Wildfire Spread source links Kaggle shards and Earth Engine export; public shard listing accessible, smallest eval shard about 187 MB, complete event/geographic split metadata not yet obtained. No real model has been trained or scientifically validated. These remain visible M7 prerequisites while other work continues.

Integration review issues sent to exclusive backend owner: reset transient worker retry state after success, explicitly fail exhausted leases, handle long-running lease work; align SESSION_SECURE and RAW_RETENTION_DAYS; permit bounded full prediction bodies and connect provider imports to immutable prepared area snapshots. Fixes and checks remain pending.

## Numerical implementation handoff / independent review

Simulation agent finished and released its ownership. Independent reviewer started in the vacant slot; now active coordinator + frontend + backend + reviewer. Reviewer writes only docs/INDEPENDENT_REVIEW.md and tests/review; it authored no reviewed implementation. No concurrency above four.

Simulation agent executed 15 numerical tests: 14 passed initially, one cached environment-mismatch defect fixed; successful rerun still pending dependency recovery. Python benchmark-converter syntax passed. A dependency-free Node numerical benchmark of 200x200 cells, 30 sensors and six hours took 10.25s; first frame103ms, cached seek30ms, sampled RSS111MB and exact checkpoint replay match (packages/simulation/benchmark-results.json). This is a numerical benchmark, not integrated DB/WS performance or scientific accuracy.

Known scientific implementation gaps at handoff: empirical rather than complete published fuel parameterization; spatial grid convergence not yet demonstrated; configurable synthetic faults missing; inference resampling/rejuvenation and extensive anomaly features incomplete; daily ML runtime promotion not connected; no real training/evaluation. Public Kaggle HTTP206 range parsed 4096 real pixels but no required event/date/geographic identities. These are incomplete requirements, not completed M6/M7 claims.

Dependency retry: second install failed ECONNRESET and rolled back partial modules. Retrying with lower download concurrency and cached packages. Chromium download failed too; installed Chrome will be used for browser tests. Backend genuine bounded COG acquisition encountered range timeouts; retries underway. No substitute synthetic geography is being presented as acquired terrain.

## M1–M5 integration evidence

Dependency recovery succeeded; lockfile generated. PostGIS17/3.5 image downloaded and pinned to its verified digest. Created dedicated dryspell_test database, applied SQL migration and seeded actual acquired landscape. Real sample: glendalough-9b9d9c7ba15f, 200x200 cells, 25m resolution; bounded real WorldCover2021 and Copernicus DSM extraction, explicitly synthetic dry weather. Live Open-Meteo adapter also fetched24 hourly samples, retained separately. FIRMS unavailable without key; Overpass acquisition failed, so no OSM enrichment success claimed.

Actual web+worker+database readiness passed on port4000. Three integration tests passed: server-enforced authorization/CSRF/origin; committed capability-aware telemetry, numeric zeros, duplicates, wrong tokens, partial packets and WS delivery; worker run/pause/seek, four profile outputs and immutable old-revision replay. Combined controlled harness later passed40 tests including outbox concurrency and geometry tests. Current browser E2E still in progress. Initial Chrome1440x900 physical-map composition manually reviewed and retained; first E2E failures were a test locator and a concurrent build's empty output directory. Build scheduling is now coordinator-only.

Independent reviewer executed reproductions and confirmed fixes: duplicate evidence before posterior candidate selection; exclusion of future-issued weather; serialized outbox commit ordering; complete-hour retention and repeated aggregate preservation. History cutoff/location and dense-history current reading fixes are in source, awaiting browser regressions. Worker restored-checkpoint restart path now implemented, pending restart exercise.

## Contract1.1.0 and subsequent ownership

Added optional simulation fault windows to Sensor and optional sensor memory to FirePosterior. Backward-compatible wire extension; root owns schema. Frontend and reviewer completed their handoffs and released write ownership. Simulation agent resumed in vacant reviewer slot to close internal modelling gaps; backend finishing validation/integration. Root owns frontend integration fixes and all builds/browser verification until explicitly reassigned. Never more than four active agents.

## Follow-up quality closure

Controlled stack run passed40 tests including the three actual integrations. Browser progressed through four profile placements and reload, then found placement enabled before environment loading completed. Frontend fixed loading guards and added explicit overlapping-object selection, fault configuration, satellite/connection-health views and lightweight metadata polling instead of repeatedly transferring immutable terrain. Latest compiled build succeeds; browser rerun pending final backend source freeze.

Independent focused review reproduced delayed-sample boundary defect R10. Simulation owner fixed it in engine1.1.1: queued source observations emit once at their scheduled receipt, drain after fault windows end, and can coincide.26 modelling tests, typecheck and original reproduction passed. Backend migration003 removes delivery-tick uniqueness so all coincident observations persist; dedicated actual integration assertion added. Old engine checkpoints require a new scenario revision.

Modelling additions: explicit equivalent-dead GR1/GR2/GR3 published parameter options,16-neighbour propagation with supercover barriers, deterministic faults, posterior temporal memory and ESS-triggered resampling, domain/scale-gated daily TensorFlow artifact runtime. Synthetic training/export/load/inference executed successfully; historical training remains unavailable. Numerical benchmark now21.48s six-hour workload,58ms cached seek,113MB sampled RSS; tested oblique angular error2.33%. These do not establish field prediction accuracy.

Root added TFRecord CRC32C verification; Python known-vector, valid-record and corrupt-record tests passed. Backend now has immediate critical alarm plus persistence/hysteresis, hardware ranges, status transitions, satellite read cutoffs, daily model jobs and coalesced real-observation work. Final actual restart/load/browser checks pending. No Ubuntu installation/reboot/firewall/backup-restoration result is yet claimed.

## Compiled localhost acceptance — 2026-11-14

`npm run verify:stack` completed successfully against compiled Express/static React, actual Docker PostGIS, the compiled analysis worker and real WebSocket delivery: 70 tests across 15 files, then two Chrome browser journeys passed. The main journey placed all four profiles, persisted/reloaded, rejected water ignition, ran, paused, rewound, inspected terrain and requested an observation-only estimate. Touch Live ingestion preserved numerical zero and unsupported channels; incoming readings did not move History's cursor.

Hard worker restart consumed a persisted checkpoint and resumed with the same frame checksum as uninterrupted computation; web restart retained the authenticated session and telemetry. See docs/evidence/restart-check.json. Actual 30-device/300-packet load stored and delivered every packet: ingestion p95 446 ms, WebSocket p95 372 ms, elapsed 10.114 seconds. This short Windows/Docker check is not a sustained test on the reference Ubuntu hardware. Actual pg_dump/restore and Docker database restart retained data (docs/evidence/database-recovery.json); Ubuntu coordinated backup scripts remain unexecuted.

Performance closure: surface-grid-1.1.2 computes the initial 40,000-cell prepared variable-weather frame in 484 ms. Optimized/reference arrival differences were below 0.000118 seconds on the compared crop; full-grid step convergence is recorded in packages/simulation/prepared-benchmark-results.json. This establishes implementation consistency, not scientific prediction accuracy.

Browser visual inspection found a selected-rewind chart showing no readings despite a current measurement, plus crowded time labels. Frontend agent reactivated exclusively for apps/web/src/App.tsx, TelemetryCharts.tsx and optional tests/e2e/chart.spec.ts; it must not build or spawn agents. Independent reviewer reactivated with exclusive docs/INDEPENDENT_REVIEW.md and tests/review ownership. Root owns all other files, build/server scheduling and status. Total active: root + frontend + reviewer (three). Paired composition captures initially caught a loading state; root will replace them with loaded same-fixture views. Next: fix chart, rerun affected browser checks, finalize visual review and fresh local startup.

## Final refinement handoff

Frontend chart fix merged: delivered frame observations and bounded history share scenario/revision/sensor identity and both observation/receipt cutoffs. The focused real-backend browser regression passed with actual history deliberately delayed, including zero smoke, missing humidity and three observations after rewind. Main browser rerun encountered a slow initial landscape fetch while another software-rendered Chrome instance ran concurrently; trace showed duplicated6.5MB landscape responses, not a failed API. Removed the extra environment query, consume the WS snapshot directly and added bounded HTTP/WS compression. Browser suites now run sequentially.

Native Chrome200% zoom was actually enabled in an isolated profile (1440 physical pixels,720 CSS pixels,devicePixelRatio2). It revealed the final tool beneath transport in short windows; added a horizontal short-height palette and a native-zoom hit-testing regression. Refreshed build/browser checks pending.

Dependency audit found vulnerabilities in the initial MapLibre5 and Vitest3 dependency trees. Updated MapLibre6.18 and Vitest5.1, adjusted the named namespace import, and added standard HTTP compression. `npm audit` now reports zero vulnerabilities. Typecheck passes. Root owns dependency/configuration changes; original user planning files remain untouched.

Backend runtime integration handoff adds guarded real daily-job and geographic WS/reconnect tests, not yet executed. Independent reviewer completed final actual test-DB History/latest checks and delayed-delivery reproduction, with no new P1/P2 findings; chart screenshot recheck remains pending. Reviewer and frontend/backend agents released writes. Simulation agent alone is active with root, implementing normalized coverage-aware regional dataset preprocessing in packages/inference and docs/REGIONAL_DATASET.md. Actual rawVIIRS access and real training remain incomplete; no normalized fixture is claimed to be real satellite evidence.

## Final browser corrections

A broader six-journey browser run passed chart synchronization, keyboard recovery, touch Live and actual native200% zoom, and exposed two defects. Scenario creation ignored supplied ignition/config fields; newScenario now shares the edit schema and ignition/time-zone rules, retains all supplied inputs and keeps initial revision1. Two focused regression tests passed, independently rerun by the reviewer. Snapshot fetch cancellation could leave a CancelledError banner even after valid WS data arrived; cancellation now completes with state reversion before installing the snapshot. Error banners and narrow-screen legends/notices were repositioned to keep tools and attribution readable.

The rebuilt stack has now passed84 tests across18 files, including the new scenario-creation checks. Hard-restart/checkpoint and session/telemetry preservation passed again. Final browser rerun is in progress, with action timeouts bounded to20 seconds so obstructed controls fail promptly. Touch coverage now includes actual coordinate placement, ignition, Run, Pause and rewind, in addition to Live data. No implementation agent is active; root coordinates final checks and the independent reviewer reviews captures/source changes only.

## Sandbox restart — implementation in progress
User rejected the previous UX. New anonymous sandbox is the active scope; earlier acceptance does not imply acceptance of its UX. Contract sandbox-v1 supplements unchanged domain contract1.1. Existing map/server/database/data files are read-only during this stage. External map/PG agent owns that integration. Root owns contracts, configuration, weather server, integration and status. Frontend owns apps/sandbox/src/ui and canvas; Simulation owns apps/sandbox/src/runtime and packages/simulation/src. Maximum two implementation subagents while external agent works; no children delegate. Preview will bind127.0.0.1:4001 only. No new verification claimed yet.

### Sandbox handoff: weather and host foundation
Created independent Express/static host and sandbox-v1 contract. Real Open-Meteo acquisition executed successfully on Windows:11 hourly values, valid UTC coverage beyond six hours, sample=false. Three weather-boundary unit tests passed (zero preservation, missing rejection, historical-start rejection). Added scripts sandbox:build/start/dev; main server and DB untouched. Frontend and simulation agents actively own their exclusive directories. Dependency @noble/hashes added for portable engine hashing; npm audit reported zero vulnerabilities. Actual sandbox browser checks pending.

### Sandbox server live check
Compiled independent server started on127.0.0.1:4001. GET health reports anonymous-sandbox/database-not-required. Actual HTTP weather request returned11 hourly samples from Open-Meteo with sample=false. Frontend assets still under implementation; this check does not claim the browser journey works yet. Process started in managed terminal session; original4000 service unchanged.


### User steering: map service and dark visual reference
User authorized read-only D:/dryspell/map inspection and requested complete visual restyling toward supplied charcoal-map reference. Map API4177 health/sample verified live with actualPostgreSQL/WorldCover/Open-Meteo; no external files/services modified. It currently has point samples/PNG tiles, not simulation-ready area grids, and elevation=null. docs/MAP_INTEGRATION.md documents exact missing area endpoint and integration contract. Continue deterministic prepared numerical terrain, not guessed imagery physics. Frontend owner is applying the dark composition. Reviewer has independently passed29simulation/runtime/weather tests and is exercising browser acceptance.

### Integrated sandbox verification
Compiled app verified with real browser Web Worker and independent local IndexedDB; no scenario mutations or requests to the old platform/DB. Root's numerical/runtime/weather/import/geography run passed36tests in9files. Independent seven-browser suite passed on the dark build: fourprofiles/run/inspect/pause/seek/reload; drag/move/cancel/undo; mobiletouch; nativeChrome200%zoom; staleweatherresponse; hour-oldweatherretry; New/Undo whileweatherpending. Actual Open-Meteo through the new HTTP server was checked separately from deterministic external-weather browser fixtures. Root reviewed same-state strip/shelf and mobile captures. Final CSS fixes for attribution and short-height notice/scale overlap are undergoing focused review; ten-minute fire visualcheck pending.

## Map visibility, six-hour horizon and linear wind revision
User requested legible regional/local land cover, integration of map's real tile delivery, restrained crop/town colors, longer runs and explicitly linear downwind wind-speed influence. Root owns contracts/server/proxy/data acquisition and physics integration; Frontend owns sandboxUI/canvas; Simulation completed sixhour runtime/direction audit and released; independent reviewer now owns tests/sandbox andreviewreport. Never more than two of our subagents active concurrently; externalmapagent slot reserved. No externalmapfiles/services changed.

Actual proxy acquisition from4177 verified both ESA and RESOLVE tiles through4001. Source class color replacement is display-only: crops#c6aa66,buildings#8b949b; matchingforest/grass/shrub/water palette. Reacquired original ESA analytical40kclass values usingboundedCOG ranges into data/sandbox/environment.json; numerical and displayed working-area snapshot retainoriginalcodes. No RGB-derived fuel inference. Sixhour cap21600; oldshort inputs accepted. Wind directionauditpassed8directions; north-up fixesbearing mismatch. Following explicit userclarification, rootimplemented linear headwindfactor andreciprocal backing with8m/sfinalsafetycap, bumpedengine1.2.0. Unknown/older modelhistory must resetandvisiblyrequest rerun, preservingobjects/weather. Unitrun68tests14files passed; integratedbrowserverificationpending.

## Completed map/wind handoff
Final build and typecheck passed. Independent reviewer released all writes after 68 unit tests and 11 distinct passing browser cases across documented runs. Closed north-up keyboard rotation, old-model migration and mobile attribution/control overlap findings. Root inspected final mobile/native-zoom captures. All delegated roles idle; root retains integration ownership. Run/restart instructions: docs/SANDBOX.md. Actual numerical area integration remains the next external handoff, while local prepared-area simulation and map tiles are usable now.

## Active arbitrary-area / custom-duration revision
User requires selecting any provider-covered territory and entering arbitrary hours. Baseline inspected; preserve all existing work and services. Contract sandbox-v2 is established before delegation: SandboxAreaRequest {center, sizeM?, startTime, durationSec}, POST /api/sandbox/environment/prepare -> EnvironmentSnapshot; failure leaves current scenario intact. Local analytical grid uses at most 40,000 cells with resolution adapted to selected size, no fixed geographic fixture. Numeric duration accepts positive hours rounded to fixed five-second ticks, bounded only by safe integer/UTC representability. Forecast coverage beyond available samples uses an explicitly labelled frozen last-condition scenario assumption, not claimed forecast data. Runtime retains bounded recent chart observations; seek reconstructs earlier time deterministically. Optional SandboxEvent.historyStartSec communicates retention cutoff.

Exclusive owners: root contracts/config/manifests/server/data-sources/API/docs WORK_STATUS; Frontend ui/canvas and SANDBOX_DESIGN/SANDBOX_UX; Simulation packages/simulation and sandbox runtime plus SANDBOX_RUNTIME. Reviewer starts after an implementation slot releases, owns tests/sandbox and SANDBOX_REVIEW. No subagent may spawn agents; at most two implementation agents concurrently, preserving external-map slot. Root implements analytical acquisition using existing bounded ESA/Copernicus adapters; map project remains read-only.

## Arbitrary-area/custom-duration integration handoff
Frontend and Simulation have released exclusive ownership. Root integrated sandbox-v2, real analytical area acquisition, arbitrary positive hours, long-run bounded histories and explicit forecast extension. Root initial combined suite passed104tests/20files; simulation added its exactlegacychecksum test and rootadded tileburst queue regression subsequently, with focusedchecks passing. Finalbuild now index-B6-qwP3H.js/index-BR1X36HM.css, worker simulation.worker-DLgWZGqL.js. Server remains127.0.0.1:4001 only. ActualAPI acquisition: Carpathians andCalifornia 1km/1600cells,8.9s/7.7s. Actual1000-hourweatherHTTP contains380samples includingexplicitheld-conditiontail,not1000hourforecastdata.

Independentreviewer active on tests/sandbox and SANDBOX_REVIEW only. Sixfocusedbrowsercases passed includingrealareaPOST/run/reload/12.5hworkerrewind,custom12.5/48/1000hourinputs,legacy0.5h,failed/cancelledarea preservation,320/390/nativezoom. Tile recovery casepassedrealretryafterexplicitfailurefixture. ReviewerfoundP2 expandedlegendbehindtoolsat200%zoom; rootboundedshortheightlayerpanelwithscroll,finalaffectedreviewpending. RootactualCLI verifiedCarpathianacquisition/custom12.5h andinspectedcapture; coldregionaltileburstexposedproxycapacityfailures, fixed8active/96queued boundedrequests andRetrylayer control. No unresolvednumericalfinding; finalresponsiveverificationremains.

## Final arbitrary-area/custom-hours result
All implementation and independent-review slots are released; root owns integrated source. Contract sandbox-v2, engine surface-grid-1.2.0. Final build/typecheck passed;105unit tests/20files andseven distinct Chrome cases passed across documentedruns. Finaldesktop/mobile/native200%captures inspectedbyroot/reviewer. ReviewfindingsS6(short-heightlegend) andS7(tileburst/recovery) resolved. Test-onlyBodyInittypingfixed; finaltypecheckexit0. The appremainsrunningon127.0.0.1:4001; nofirewallorpublicbindchanges. Run/useinstructions: SANDBOX.md. Arbitrary-location numerical preparation andcustomhours arecompletewithin documentedprovider/date/resourceboundaries. No activehandoff orblockingdefectremainsforthisrequest; historicalML/provider/Ubuntumilestones areunchanged.
