# Independent anonymous sandbox review

Reviewer: independent QA agent, 14 November 2026. Scope: the anonymous application at `http://127.0.0.1:4001`, `apps/sandbox`, the shared simulation runtime and sandbox contracts. The existing application on port 4000, its database, services and the independent IoT project were not accessed or changed. Reviewer writes are limited to this report and `tests/sandbox/**` (plus browser-generated test artifacts). No sandbox implementation files were authored by the reviewer.

**Final result:** no unresolved blocking finding in this bounded review. All 29 simulation/runtime/weather tests passed. Seven complete browser journeys passed, followed by three focused checks on the final layout build (two repeated layout journeys plus one additional fire-capture journey). Native 200% zoom, touch, changing readings, deterministic reload/rewind and visible fire were independently exercised/inspected. External weather in these E2E tests is a labelled fixture; live-provider and scientific accuracy claims are not inferred from those results. Historical pending entries below are superseded by the final disposition.

## Executed checks

- `npx vitest run packages/simulation apps/sandbox/src/runtime apps/sandbox/server/weather.test.ts`: **29 passed in seven files**. This includes numerical/session/runtime tests and three external-weather boundary fixture tests.
- Actual `GET /health/live` on 4001 returned `status: ok`, `mode: anonymous-sandbox`, `database: not-required`.
- Real Chrome desktop journey reached placement of all four profiles and ignition, changing worker-generated readings, pause, seek to ten seconds, local save and reload. Values after reload matched the pre-reload values. The first test attempt failed on the reviewer's `innerText` versus `textContent` table assertion, not a numerical discrepancy; the assertion was corrected. The complete desktop journey is not yet marked passed.
- `npx playwright test --config playwright.sandbox.config.ts --grep 'mobile touch'`: **one passed**. Actual touch-enabled Chrome at 390 × 844 placed a combined sensor and ignition, ran, paused and rewound. It detected no horizontal document overflow or protected `/api/v1`/port-4000 traffic. The resulting capture was independently inspected.
- Source review covered server routes, weather cache/cutoffs, worker scheduling/generation/seek semantics, immutable simulation sessions, local draft parsing/storage, UI history and canvas interaction. `createSimulationSession` clones and freezes inputs, retains numerical state separately and uses fixed ticks; the HTTP server does not import PostgreSQL or authentication.

The browser tests replace **only the external Open-Meteo weather response** with a labelled deterministic fixture. The prepared terrain is obtained from the actual sandbox endpoint; the compiled React interface, IndexedDB, actual browser Web Worker and numerical engine execute normally. This does not establish live Open-Meteo availability; the coordinator checks that separately. The fixture's provenance explicitly names it as a browser-test response; it uses the provider-response contract so the UI can exercise frozen-weather persistence.

## Findings

| ID | Severity | Reproduction and affected source | Status |
|---|---|---|---|
| S1 | P1 interaction blocker | At 1440 × 900, open a sensor or experiment inspector, then click Close inspector. MapLibre's top-right zoom controls overlap and intercept the close control. Affected stacking/placement in `apps/sandbox/src/ui/sandbox.css` and `canvas/MapCanvas.tsx`. Visible in the initial failed-test screenshot. | Resolved and independently verified in desktop export/drag and native-zoom browser journeys. Updated captures show the close control above map controls. |
| S2 | P2 state race, source finding | An older `prepareWeather` completion guards the document update by scenario ID but still unconditionally sets weather readiness/message afterward. Changing/importing/undoing the experiment while the request is pending can therefore apply readiness to a different document. | Resolved with request generation and original document identity/time guards. Independent browser regression delays the old request, creates a newer experiment, then releases the old failure; newer weather and Run remain usable. |
| S3 | P2 expiry retry, source finding | The first S2 guard compared the current document start to a newly calculated request start without committing that new start, discarding successful weather after an hour. `toggleRun` and Retry weather were affected. | Resolved by retaining the original identity/time guard and atomically committing requested start plus weather. Independent controlled-browser-Date test advances two hours, retries and verifies aligned start/weather plus actual worker progression. |

## Pending final verification

Rerun all browser journeys against the final coordinator build, including palette drag/movement/cancel/undo, complete desktop reload/export, mobile touch and native Chrome 200% zoom. Reinspect the fixed inspector close control and final responsive captures. The reviewer does not claim these pending checks passed. Scientific forecast accuracy, other browsers and sustained browser-memory endurance are outside the executed evidence.

## Superseding browser results

On the compiled dark sandbox build `index-Bl4IJBcd.js`, independently executed `npx playwright test --config playwright.sandbox.config.ts`: **all seven tests passed in 2.5 minutes**. These are actual Chrome journeys using the real browser worker, engine, local storage and prepared terrain endpoint:

1. Anonymous four-profile placement plus ignition, Run, changing readings, Pause, seek to ten seconds, identical readings after IndexedDB reload, rewind and export. Actual capabilities are `[3,1,1,1]`; single-channel profiles show two unsupported channels. No protected API or port-4000 traffic and no uncaught page errors were observed.
2. Mouse palette drag, marker movement, cancelled placement and undo restoring the original location.
3. Touch-enabled mobile placement, Run, Pause and rewind at 390 × 844, with no horizontal document overflow.
4. Native Chrome zoom 2, asserting 720 CSS pixels and device-pixel ratio 2 at a 1440 × 900 physical viewport, hit-testing every placement tool, placing and inspecting a sensor, and closing the inspector.
5. A delayed older weather failure cannot replace a newer experiment's weather/readiness.
6. A controlled two-hour browser-Date advance permits weather retry with matching scenario/weather time origins and a runnable worker.
7. Undo during a pending new-experiment weather request restores the previous objects and frozen runnable weather; the late discarded failure does not appear.

`npm run typecheck` passed after correcting a nullable assertion in reviewer test code. Two earlier browser runs were deliberately interrupted while the coordinator rebuilt assets; they are not counted as completed suites. After the attribution-only CSS build, focused mobile/native-zoom tests passed again, but that run was interrupted before fire capture when a final notice/scale overlap correction was requested. Final focused fire/mobile/zoom execution and visual inspection remain pending immediately below; earlier pending wording is historical.

The reviewer inspected dark desktop, mobile and native-zoom captures. Close-control occlusion is fixed. Two minor short-height presentation overlaps (ordinary placement notice crossing the chart edge, legend crossing map scale) were reported; the coordinator is suppressing ordinary notices while inspection is open and separating scale/legend, while preserving errors. This is visual refinement, not a failure of the seven completed behavioral journeys.

## Final layout and fire verification

On final compiled assets `index-Dutt6mjG.js` / `index-CSw98fRX.css`, independently ran:

`npx playwright test --config playwright.sandbox.config.ts --grep 'mobile touch|native Chrome|ten-minute'`

**All three passed in 1.0 minute:** mobile touch 15.2 seconds, native Chrome 200% zoom 15.0 seconds, and ten-minute browser-worker fire capture 29.2 seconds. Together with the seven-test suite above this covers eight distinct browser cases; it is not represented as one eight-test run on a single build. The final changes between builds were layout/attribution/notice refinements, with the affected layouts rerun.

Independently inspected final `output/playwright/sandbox-review-mobile.png`, `sandbox-review-native-zoom.png` and `sandbox-review-fire.png`. Mobile tools, transport and inspector close control remain reachable; attribution is readable beneath transport. At native 200% zoom the ordinary notice no longer crosses the inspector, and scale and fire legend are separated. The public zoom controls reveal actual orange burning cells and a darker burned interior after more than 600 simulated seconds. The fire check drives the real UI/worker and saves an image; visible fire is established by this human-style image review, not a hidden map API or a mocked internal frame. The test checks time progression and protected-route absence automatically.

The coordinator subsequently identified that the optional paused-notice timestamp could lag a final in-flight frame and changed only that redundant wording to “Simulation paused.” The reviewer does not claim the post-wording rebuild was the exact bundle used for the runs above; no numerical or control logic changed in that text correction.

S1, S2 and S3 are resolved with passing affected browser checks. The coordinator's pending-new-weather Undo correction is independently verified. No uncaught page errors appeared in the monitored primary journey, and the test request monitors recorded no protected `/api/v1` calls or traffic to the existing application on 4000.

Limitations: Chrome only; no scientific wildfire-forecast certification; no extended memory/endurance test; real Open-Meteo availability was separately checked by the coordinator rather than inferred from deterministic E2E weather. Local persistence belongs to the browser and origin, not PostgreSQL. The integration with the other geographic/database work remains outside this sandbox review. The physical terrain fixture is real prepared data; the weather response fixture is synthetic and clearly identified in test source/provenance.

Reviewer ownership of `tests/sandbox/**` and this report is released after this entry. No implementation changes are pending from the reviewer.

## Six-hour simulation and regional-map revision — 14 November 2026

Review reopened for the six-hour horizon, regional map integration and explicitly requested linear wind response. This section supersedes the earlier revision's test counts and model assumptions. Scope remains the anonymous sandbox on port 4001. Live map checks read the already-running upstream on port 4177; the reviewer did not inspect or modify that service's files, start/stop it, or access port 4000 or a database.

### Independent executed evidence

- `npx vitest run packages/simulation apps/sandbox`: **68 tests passed in 14 files** after the `surface-grid-1.2.0` change. Tests cover the eight wind directions, linear headwind increments below the safety cap, reference/optimized equivalence, water barriers, six-hour history/reconstruction and bounded runtime behavior. These numerical invariants are not empirical wildfire validation.
- `npm run typecheck`: passed with the updated reviewer tests.
- `npx tsx tests/sandbox/map-probe.ts`: passed against **actual HTTP upstream 4177 and proxy 4001**, with no tile fixtures. At tile `12/1975/1333`, both layers returned 256 × 256 PNGs. Recoloring retained alpha; ecological-zone bytes were unchanged; all land-cover pixels in that tile were display-recolored. Fetching tiles did not change the environment response. Detailed hashes and timestamps are retained in `tests/sandbox/map-probe-result.json`.
- The actual sandbox environment contains 40,000 cells with preserved numeric ESA source classes, snapshot `glendalough-9b9d9c7ba15f-classes-4e4b0eb212bd`. Observed local source classes are 10, 20, 30, 50, 60, 80 and 90. There is no class-40 cropland cell in this local 25 m fixture; the reviewer does not infer actual local cropland coverage from the legend or a conditional palette assertion. The coordinator separately reports checking a regional tile containing crop and town colors.

The browser journeys continue to replace only the external weather response with a labelled, constant six-hour fixture. Compiled React, IndexedDB, the real browser worker, actual numerical engine, prepared environmental endpoint and actual regional tile HTTP paths are exercised. This distinguishes real map integration from fixture-driven weather reproducibility.

### Findings and disposition for this revision

| ID | Severity | Reproduction and affected source | Disposition |
|---|---|---|---|
| S4 | P2 directional interpretation | In `apps/sandbox/src/canvas/MapCanvas.tsx`, disabling mouse/touch rotation alone leaves MapLibre keyboard rotation active. Focus the map and press Shift+Right; the viewport can rotate while the wind arrow assumes north-up. | Coordinator added `keyboard.disableRotation()`. Independently verified in Chrome by marker-position invariance after the shortcut, plus the west-to-east weather label and east-pointing arrow transform. |
| S5 | P2 saved-model integrity | A stored frontier without a model identity can silently be reconstructed using the new wind law, changing historical results. Affects draft restoration/import in `apps/sandbox/src/ui/draft.ts` and `ui/App.tsx`. | Coordinator added model identity and explicit old/unknown-model invalidation. Source and unit coverage reviewed; independent browser migration verification recorded below when complete. Objects, weather and an imported 1,800-second duration must survive while historical time resets. |

Independent source review confirms both reference and optimized propagation call the same linear positive-along-wind multiplier, with reciprocal positive backing response and the existing 8 m/s final spread cap. Rendering layer state is separate from numerical environmental inputs. The crop display color does not introduce a new calibrated fuel model: current crop fuel behavior remains a documented herbaceous assumption. Neither the ecological-zone display nor tile RGB is used as physical input.

### Browser execution and image review

On compiled `index-DFkYwdNd.js` / `worker-hbQrqRx1.js`, the complete 11-case suite finished with **10 passed and one reviewer-locator failure**. The duration select has the correct accessible combobox name; the original exact `getByLabel` locator included nested option text and timed out before changing the duration. The test was corrected to use its accessible role and name. This failure is not counted as a successful migration check.

The ten passing cases include the original four-profile/run/readings/pause/reload/rewind journey, mouse movement/cancel/undo, mobile touch, native Chrome 200% zoom, expired-weather retry, two late-weather race regressions, ten-minute visible fire, and these new integrated checks:

- **Actual six-hour reconstruction and rewind:** a clearly declared saved-frontier input fixture with current model identity and frontier 21,600 was imported through the public UI. The real worker computed to `6:00:00`, displayed the final 200 reading rows, returned to ten seconds with exactly three rows, and reproduced both earlier and six-hour checksums on repeated seeks. This case passed in **42.0 seconds**. It does not claim six hours of wall-clock playback, nor replace internal worker computation with mocked frames.
- **North-up and layer independence:** west-origin weather displays an eastward arrow; keyboard rotation no longer moves the marker. Switching to ecological zones and back to land cover preserves the actual worker-frame checksum and exported scenario/environment. Both tile layers are real upstream-backed requests in this test.

Independently inspected `sandbox-sixhour-landcover.png`, `sandbox-sixhour-ecoregions.png`, `sandbox-sixhour-rewind.png` and `sandbox-review-fire.png` under `output/playwright/`. The same outlined effective terrain remains visible under both regional contexts, with readable provenance/legend text. Rewound sensor chart time matches the timeline. The ten-minute capture shows actual orange burning cells around a dark burned interior. Pixel appearance is visual evidence of rendering, not validation of wildfire realism.

The coordinator found two responsive overlaps in separate live captures and adjusted mobile layer width and space reserved for expanded attribution. Final focused duration/migration, mobile and native-zoom checks on the rebuilt CSS/provider-label revision are pending below; no pending check is represented as passed.

### Final result for the six-hour/map revision

On rebuilt `index-CpJLKkqp.js` / `index-OwmWRxb6.css`, independently executed:

`npx playwright test --config playwright.sandbox.config.ts --grep 'six-hour horizon|mobile touch|native Chrome'`

**All three passed in 45.1 seconds:** mobile touch 14.6 seconds, native 200% zoom 13.9 seconds, horizon and migration 13.9 seconds. Alongside the preceding ten passed cases, all **11 distinct browser cases** have passed; this is accurately reported as a ten-pass/one-test-locator-failure full run followed by a three-pass focused run, not a single clean 11-case run on one bundle. Only responsive CSS and provider attribution text changed between those builds.

The corrected duration case verified fresh six-hour defaults, actual 1/3/6-hour selector values and timeline bounds, and import of a legacy 30-minute experiment with old model identity. The UI visibly reports “Wind model updated; run again.”; the imported duration remains 1,800 seconds, objects and source classes survive, the current model identity is exported, and cursor/frontier reset to zero. **S5 is resolved with independent browser evidence**, in addition to source/unit checks. S4 is likewise resolved.

The strengthened mobile test hit-tested both regional-layer buttons and both zoom buttons, explicitly expanded map attribution and checked that the transport sits above it, then completed touch place/run/pause/rewind. Independently inspected refreshed `sandbox-review-mobile.png` and `sandbox-review-native-zoom.png`: layer controls and navigation are separated, attribution is readable below transport, and the contextual inspector close control remains reachable. The short-height inspector scrolls; the capture does not imply all chart rows fit simultaneously.

**No unresolved blocking defect was reproduced in this bounded revision review.** Remaining limits: Chrome only; synthetic external weather in E2E; live tile checks cover the specified regional tiles and current local upstream availability, not every geographic tile or deployment; no six-hour wall-clock endurance run; no claim of scientifically calibrated wildfire prediction. Six-hour replay is real worker computation with an explicitly constructed saved-frontier input. Broader production/Ubuntu delivery and external provider credentials are outside this sandbox verification.

Reviewer ownership of this report and `tests/sandbox/**` is released. Integration actions: retain the map service on its documented local endpoint, run the sandbox build/server as documented, and keep the model-version migration and regression tests when changing numerical laws.

## Arbitrary-area and custom-duration revision — sandbox-v2

The independent review was reopened for real area preparation, numeric durations, long-run bounded history and cancellation. Reviewer ownership remains test/report-only; implementation was authored by the coordinator and implementation agents. Earlier six-hour **duration limit** statements are historical. The current six-hour bound applies to retained reading history, while users may choose longer positive durations within the documented safe tick/date range.

### Source review and executed integration

Reviewed `server/area.ts`, `server/weather.ts`, `server/map.ts`, `ui/App.tsx`, draft/history/weather helpers, the browser runtime, map geography/rendering, shared sandbox-v2 contracts and raster preparation. The new-area endpoint acquires actual ESA WorldCover and Copernicus DSM windows, then freezes server-side Open-Meteo conditions. A new scenario is installed only after validation; request generations and abort controllers discard stale/cancelled changes. Shortening/lengthening duration creates a new revision and resets computed results. Display tiles remain separate from analytical cells. Long weather coverage explicitly carries a hold-last-conditions assumption after provider coverage rather than claiming a thousand-hour forecast.

Before the final tile-queue refinement, independently executed `npx vitest run packages/simulation apps/sandbox packages/data-sources`: **104 tests passed in 20 files**. `npm run typecheck` passed. Final reruns are recorded below.

On compiled `index-CWOFg6TT.js` / `index-Ek6aPwj7.css`, worker `simulation.worker-DLgWZGqL.js`, six focused browser cases all passed in **2.6 minutes**:

1. Touch placement/run/pause/rewind at 390 px, including attribution/transport separation.
2. Native Chrome 200% zoom: actual CSS width 720 and DPR 2, placement and inspection reachable.
3. Numeric durations 1, 3, 6, **12.5, 48 and 1,000 hours** applied through the UI. A legacy 0.5-hour import remains editable; old-model frontier invalidation remains explicit. The 1,000-hour hold-weather label is verified with a **labelled external-weather fixture**, not a live thousand-hour forecast.
4. **Real arbitrary-area journey, 52.4 seconds:** the UI submitted center 48.4 N, 24.5 E and width 1 km to the actual `POST /api/sandbox/environment/prepare`. No successful internal endpoint was mocked. HTTP 200 returned 1,600 cells, real raster provenance and server-side Open-Meteo coverage through 12.5 hours. The old sensor was replaced by the new empty area; all four profiles and ignition were placed; Run/Pause, ten-second readings, local save/reload and exact early checksum were verified. An explicitly constructed current-model saved-frontier input then requested 45,000 seconds. The **real browser worker** reconstructed it, retained the recent six-hour chart window starting at 6:30:00, displayed the latest 200 rows through 12:30:00, and reproduced both ten-second and final checksums on repeated rewind/seek. This is real numerical computation, not 12.5 wall-clock hours of playback.
5. Cancelled and failed area preparation retain the prior scenario/environment and leave Run usable. This case deliberately substitutes an HTTP 503 **failure fixture** for the area endpoint; it is failure-handling evidence, separate from case 4's real integration.
6. A 320 px viewport exposes the added area action and numeric duration. Final stronger field reachability checks are recorded below.

The initial/default-scene weather in the E2E helper is synthetic and labelled. Case 4's replacement area uses server-side live weather from the real area preparation request; the browser's weather-route fixture does not intercept that server-side provider call. The reviewed live-area capture shows the returned freezing-temperature conditions, distinct from the helper's constant 25 °C fixture. Requests to protected `/api/v1` routes and port 4000 were monitored and absent.

Independently inspected `sandbox-arbitrary-area-live.png` and `sandbox-twelve-hour-history.png`: the new area boundary/terrain, changing measurements and synchronized ten-second/12.5-hour timeline are rendered. The long-run chart starts at 6:30:00, and burning/burned ground truth is visible separately from readings. These images do not establish field-calibrated scientific prediction accuracy.

### New findings

| ID | Severity | Reproduction / affected source | Disposition |
|---|---|---|---|
| S6 | P2 responsive readability | At native Chrome 200% zoom (720 × 450 CSS viewport), the added Use this area row makes the expanded map legend extend behind the object tools. The attribution/provenance paragraph is partly occluded. Affects `.sb-map-layers` in `ui/sandbox.css`; reproduced in the independently inspected native-zoom capture. | Coordinator bounded the short-height panel and added internal scrolling. Final bounding-box and content-reachability checks pending below. |
| S7 | P2 regional layer recovery, coordinator reproduction | A normal area jump can exceed the original proxy limit of 12 distinct pending tiles, producing transient 503s and a sticky layer error. Affects `server/map.ts` and `canvas/MapCanvas.tsx`. The coordinator reproduced the actual burst; reviewer source inspection confirmed the hard rejection and absent retry control. | Coordinator added a bounded queue with eight active / 96 pending requests and a Retry layer control. Independent recovery test passed against `index-Chg2ayec.js`: forced initial 503 tile failures, then actual upstream-backed 200 responses after Retry; numerical environment and frame checksum stayed unchanged. Final rerun below. |

The queue unit test uses a provider-response fixture; actual retry delivery uses the real regional tile proxy/upstream after removing the explicit failure fixture. Those are separate pieces of evidence. No claim is made that every geographic tile or every external outage was tested.

### Final focused checks for sandbox-v2

On `index-B6-qwP3H.js` / `index-BR1X36HM.css` with the unchanged numerical worker, independently ran:

`npx playwright test --config playwright.sandbox.config.ts --grep 'mobile touch|native Chrome|320px|regional tile failure'`

**All four passed in one minute:** mobile 13.9 seconds, native 200% zoom 24.2 seconds, narrow area form 9.5 seconds, tile recovery 12.6 seconds. The native-zoom test now scrolls the full legend paragraph into view, checks that the paragraph fits inside the panel and that the panel ends above the object tools. The 320 px test fills all three coordinate/width fields and hit-tests the Prepare this area button after scrolling it into view. These checks verify reachability, not merely DOM presence.

Independently inspected refreshed `sandbox-review-native-zoom.png`, `sandbox-area-mobile-320.png` and `sandbox-tile-recovery.png`: legend text is unobscured inside the scrollable panel; narrow area inputs and preparation control are reachable; actual geographic tiles reappear after Retry. **S6 and S7 are resolved with affected browser checks.** Across this revision, seven distinct browser cases passed through the initial six-case run, recovery-only run and final four-case run; no single seven-case execution is claimed.

The final unit rerun passed **105 tests in 20 files**. The subsequent workspace typecheck exposed a compile-only issue in the newly added coordinator-owned tile-queue test: `new Response(bytes)` receives `Buffer<ArrayBufferLike>`, which TypeScript does not accept as `BodyInit` under this workspace configuration (`apps/sandbox/server/map.test.ts`, line 5). Reported to the coordinator for a typed byte-array copy; final typecheck disposition follows below. No production runtime failure was inferred from that test typing issue.

Remaining verification limits: actual new-area browser integration covers one 1 km Carpathian area; other successful acquisition locations are coordinator evidence. Twelve-and-a-half-hour reconstruction uses real prepared inputs and the actual worker but an explicit saved-frontier input fixture. The 48/1,000-hour UI tests establish accepted duration and correct weather-assumption presentation, not complete wall-clock execution or empirical forecast accuracy. Retained-window reconstruction has unit coverage beyond six hours; extreme arbitrary-duration endurance and every geographic provider gap remain unverified. External access may fail and is surfaced without replacing the prior scenario. Existing production application, PostgreSQL and Ubuntu deployment were outside this anonymous sandbox revision review.

Final typecheck disposition: the coordinator changed only the test fixture to `new Uint8Array(bytes)` and reported `npm run typecheck` exit 0 (execution session 84295). This final successful rerun is **coordinator-reported**, while the preceding 105-test result and browser runs were executed by this reviewer. No runtime source or rebuilt browser bundle changed after the final four browser checks.

**Final bounded-review result: no unresolved blocking finding.** All reproduced S6/S7 issues and the test-only typing error are resolved. Retain the explicit forecast-extension notices, six-hour history-window indication and cancel/failure preservation behavior. Reviewer writes to this report and `tests/sandbox/**` are released; no implementation action remains assigned to the reviewer.
