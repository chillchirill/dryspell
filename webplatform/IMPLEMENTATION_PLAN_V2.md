# Dryspell webplatform: revised implementation plan

Prepared 14 November 2026. **Proposed for the user's corrections; not an implementation-completion report.**

This plan incorporates the current request for a usable map experiment, 30 initial sensors, physical fire/smoke behaviour, and estimation of an unknown fire. It also incorporates the follow-up instruction to integrate the good geographic results in `map` and use conventional, restrained colours.

The existing `IMPLEMENTATION_PLAN.md` remains unchanged as the historical plan. This document identifies the proposed replacements for conflicting requirements. Mathematical definitions, research evidence and limitations are in [FIRE_MODEL_RESEARCH_V2.md](docs/FIRE_MODEL_RESEARCH_V2.md). Project documentation stays in English; explanations to the user can be Ukrainian.

## 1. The product to deliver

Opening the primary application immediately shows **Test mode**, a geographic map and **30 combined sensors**. Every default sensor has three readings directly above its marker: `Temp`, `Humidity`, `Smoke`. The user can move, add or delete sensors, place an ignition, run, pause, change playback speed and rewind. The front follows terrain, fuel, moisture and wind. Each sensor reacts to the local heat/smoke that actually reaches its position and has its own alarm state.

A second workspace, **Estimate from sensors**, uses the same map, weather and measurement stream to infer an unknown fire. It displays uncertainty in origin, current burning and future spread as different products. A hidden-fire test allows later comparison with the simulated truth. Real telemetry has no truth layer.

The existing `map` result supplies the geographic foundation. Preserve its useful geography, location presets, progressive loading and scene-editing behaviour. The requested colour correction does not justify replacing real terrain with procedural decorative shapes.

### Changes relative to the previous plan/current implementation

| Topic | Revised requirement |
| --- | --- |
| Primary entry | Anonymous, editable local Test mode; Live/History remain secondary contexts |
| Initial count | Exactly 30 combined sensors in a fresh scene; 30 is not an upper limit |
| Restored scenes | Restore the user's count, positions and settings; never silently reseed them |
| Measurements | Three persistent labels above every default marker; a selected chart is supplementary |
| Map | Integrate the existing `map` geographic pipeline; conventional landscape colours |
| Terrain geometry | Polygons preferred; classified cells remain an acceptable first delivery |
| Fuel behaviour | Fuel-dependent spread, combustion lifetime and emitted heat/smoke |
| Humidity | Air humidity affects fuel moisture over time; heated local air can have lower relative humidity |
| No random extinction | Smooth moisture response; optional visible Test-mode continuous-spread override; fuel still burns out |
| Inference | Available in the anonymous experiment; independently consumes observations without hidden truth |
| Access control | Local simulated edits need no administrator; persistent real-device/server administration retains authentication |
| Completion | Demonstrate the entire map journey and validate numerical behaviour, not only a build or screenshot test |

No changes to `iot`, its processes or its storage are included.

## 2. Current implementation findings

The anonymous sandbox and the older server application are separate experiences. The sandbox starts with zero sensors, caps edits/imports at 30, renders sensor icons without their three measurements, and has no inference workspace. Its first screen at 1280 by 720 showed a roughly 390 by 390 working terrain square surrounded by context map. These directly explain several usability complaints.

The simulation already uses changing weather, fuel classes, terrain, water barriers, deterministic state and sensor lag. Preserve useful foundations, but replace the instantaneous moisture adjustment, fixed 180-second burn lifetime, fixed-radius temperature gain, and current-wind smoke approximation with the model defined in the research document.

The existing inference package already contains origin/time candidates, weights, resampling and a no-fire hypothesis. However, its observation model differs from the simulator, its fire/no-fire likelihood scores are not comparable normalized probabilities, and browser integration is missing. Those are explicit implementation tasks, not features to claim as already finished.

`map` was also inspected in a browser. Its detailed Cherkasy map is a suitable foundation. Pink cropland and bright red urban classification currently dominate parts of the image. These colours come from the class renderer; the data itself can be reused.

## 3. Integration with `map`

### Reuse boundaries

Retain the `webplatform` application and its scenario/worker lifecycle as the product shell. Use its existing MapLibre renderer to consume the map service's standard geographic tile products and reproduce the useful map interactions. Do not embed a second independently stateful Leaflet application inside the simulator or require two maps with different selected times/scenes. Changing the rendering library is unnecessary for integrating the geographic result.

Reuse or adapt the map project's data acquisition, source provenance, progressive levels of detail, bounded caches, location presets and scene semantics. Its existing Leaflet page remains independently usable while integration is developed.

The current map handoff/configuration identifies frontend `http://127.0.0.1:4176` and API `http://127.0.0.1:4180`. The earlier webplatform handoff mentioning 4177 must be updated. These are development configuration values, not production addresses. The map's independent PostGIS storage must remain separate from platform telemetry storage.

Route map requests through a configured same-origin webplatform adapter. Preserve bounded concurrency, cancellation, cache/provenance headers, and provider attribution. Do not broadly relax CORS or expose map database credentials to the browser.

### Display data versus analytical data

| Existing capability | Integration use | Additional work |
| --- | --- | --- |
| `/api/world`, `/api/sources` | Layer/source metadata and attribution | Normalize into the platform source catalogue |
| `/api/tiles/landcover/{z}/{x}/{y}.png` | Geographic land-cover backdrop | Add/version application palette in rendered products |
| `/api/tiles/ecoregions/{z}/{x}/{y}.png` | Broad steppe/forest-steppe/forest context | Keep ecological meaning distinct from local fuel |
| `/api/sample` | Ground inspector at a point | Preserve null elevation/soil/moisture; not a grid-building endpoint |
| Guest scene export/import | Migration of existing sensor placements | Explicit schema conversion and capability preservation |
| Analytical selected area | Not presently exposed as a complete map API contract | Bounded area preparation/export using source rasters and available elevation |

Define a proposed area-preparation contract, for example `POST /api/environment/prepare`, backed by the geographic provider adapter. It accepts a bounded area and target metric resolution; returns a job/status or an immutable snapshot manifest. Endpoint naming is a proposal, not an assertion that it exists.

The prepared snapshot contains:

- Geographic bounds, local metric CRS, grid origin, dimensions, resolution and row order.
- Original land-cover codes and their source year/version, valid-data masks, retained cover fractions and conservative water barriers.
- Ecological context separately from the land-cover/fuel arrays.
- Elevation and quality/missing mask; slope derived using documented surface-model preprocessing.
- Fuel-profile assignments, assumptions, confidence and mapping version.
- Content checksum, source attribution/licence, acquisition time and processing version.

Generate it from raw classified source windows, not screen pixels or RGB colours. Do not fan out one `/api/sample` or weather request per cell. Prepared 200 by 200 grids are initial bounded workloads; global analysis is outside the browser request.

If elevation is unavailable, Test mode may explicitly use a flat-terrain approximation. Real estimation must expose the missing topography and associated uncertainty. A null elevation is never silently treated as measured zero.

### Colour changes and caches

The existing source-rendered PNG colours cannot be reliably repaired with a CSS hue filter. Change the class-to-colour renderer, or publish a recoloured derivative from the original class data. Add `paletteVersion` to rendered-tile keys, ETags, client URLs and any prebuilt tile pyramid identity. Preserve raw COG range caches, original dataset versions and imported polygon data.

Legacy precoloured PNG fallback must be regenerated for the new palette or explicitly excluded for that style. It must not quietly return the old pink/red tiles among the new tiles. Display style changes must leave the analytical snapshot checksum and simulation results unchanged.

### Scene migration

Preserve stable sensor IDs, geographic coordinates, names and supported measurement channels when importing an existing map scene. The map currently supports up to 500 objects; removing the sandbox's 30-object limit must not silently truncate existing scenes. Initially support up to 500 stored scene objects, with any measured runtime budget shown before running. The default 30-sensor workload must run smoothly.

Combined, temperature, humidity and smoke profiles receive the supported simulation responses. Soil/wind/water objects imported from `map` retain their identity/capabilities; channels outside this fire model remain unavailable, not invented or converted to zero.

## 4. Map composition and conventional palette

Use the existing geographic result as the visual baseline. The working area should occupy most of the usable map, with compact tools, one contextual inspector and a bottom timeline. Remove the current excessive camera padding that turns the active terrain into a small central square. Numerical domain size and camera framing are independent.

The palette below is a proposed application convention, not a claim of a formal cartographic standard:

| Meaning | Proposed colour | Presentation rule |
| --- | --- | --- |
| Water | `#6EAED6` | Blue, clearly distinct from land |
| Forest / tree cover | `#4F7F45` | Muted green |
| Steppe / grassland | `#D9CD8A` | Pale dry-grass yellow |
| Forest-steppe context | `#A8B87B` | Muted olive; local grass/tree patches remain visible |
| Cropland | `#D8C59B` | Warm beige; separate from natural steppe in the inspector |
| Shrubland | `#B8BA86` | Subdued olive-grey |
| Built-up / city | `#B6B8BA` | Neutral grey, never fire-alarm red |
| Unknown | `#DADADA` | Neutral fill with an optional missing-data hatch |
| Active flame | `#E56B2F` | Orange contour/fill, intensity linked to combustion state |
| Critical alarm | `#C62828` | Reserved for local alarm emphasis |
| Burned ground | `#675A50` | Desaturated brown/charcoal |
| Smoke | Neutral grey | Translucent field; avoid obscuring readings |
| Selected object | `#1976D2` | Blue outline plus an explicit selection shape |

Use text and marker/ring shapes as well as colour. Sensor labels need an opaque or sufficiently contrastive backing and must remain readable over water, trees, smoke and flame.

At regional scale, ecological polygons describe broad zones. At working scale, water and built land take precedence, then actual vegetation/cropland patches. Forest-steppe is a mosaic, not an excuse to paint every local cell with one fuel type. Preserve the map's Cherkasy, Askania-Nova and Glendalough presets; do not invent all ecological regions inside one small real landscape.

Preferred final geometry: dissolved polygons for the selected area's land cover, with holes, shared boundaries and water barriers preserved; a numerical raster underneath. Initial acceptance can use clearly rendered cells, as the user allowed. Keep world-scale tiles and progressive loading rather than loading all detailed world polygons into the browser.

## 5. Exact initial user journey

### Fresh scene

1. Open Test mode without sign-in. Load a prepared area associated with the existing map's location presets. The default camera frames the usable scenario rather than all surrounding geography.
2. Place exactly 30 combined sensors using a deterministic, land-aware distribution. Avoid water, duplicates and inaccessible/out-of-bounds cells; do not secretly arrange them around hidden truth.
3. Show stable names/IDs and three live values above every marker. Ambient temperature/humidity come from the scenario weather; smoke begins at an explicitly configured background index, normally zero in the clean-air demonstration.
4. Present the actions `Add sensor`, `Ignite`, `Run`, `Pause` and `Reset` directly on the map. Select/drag is the default pointer action; placement/ignition tools show their active state and cancel with Escape.
5. A suggested test ignition near/upwind of part of the network may help the first experiment, but placing it requires the user's click. Do not secretly create a fire or falsify readings to guarantee a reaction.

For the first desktop view, distribute labels so all 30 three-value labels are readable at the intended initial viewport. Moving sensors close together requires label displacement/leader lines and an accessible list/selection fallback; it must not silently remove critical values. On small screens provide map labels at useful zoom plus a synchronized compact sensor list. Verify this behaviour instead of assuming clustering solves it.

### Weather and first-run reliability

Use the already integrated Open-Meteo provider for ambient temperature, humidity, 10 m wind and precipitation. Display wind direction/speed and weather time. Refresh before a new run, then freeze the selected series for replay.

Provide a bundled, explicitly labelled reference-weather demonstration so provider unavailability cannot make the entire Test workspace unusable. Live weather remains the first choice. If unavailable, offer a concrete `Use saved demo weather` action with its date/source; never silently describe it as current conditions. Keep a named dry-weather demonstration separate from a run using today's weather.

Weather does not supply local smoke concentration, individual sensor heat, actual fuel moisture or detailed surface-fuel mass. The UI must distinguish simulated readings and model assumptions without exposing unnecessary implementation detail.

### Editing and time

Add, drag, delete and undo must work by pointer and keyboard/touch alternatives. Thirty-one sensors is a valid scene. Changes to an active scenario pause it and create a new revision for recomputation; saved results keep their original revision. Rewind is deterministic.

Use one simulation clock for front, smoke, readings, alerts, selected sensor chart and estimate. Playback speed changes wall-clock playback, not the equations. An alarm's pulse uses a comfortable wall-clock cadence; its severity corresponds to the selected simulation time.

Checkpoint/replay must include moisture, combustion, heat/smoke transport, response lags, observation delivery/quality and random-generator state, not only arrival times. Estimates retain their observation cutoff and issue time.

## 6. Numerical model to implement

The research document is the mathematical specification. The module contract should make the following dependencies explicit:

| Component | State and physical dependence | Required behaviour |
| --- | --- | --- |
| Weather adapter | Ambient temperature/RH, wind vectors, interval precipitation | Correct heights/units, direction convention, interpolation and rain accumulation |
| Fuel moisture | Component moisture relaxing toward equilibrium, with rain wetting | Drying/wetting has memory; coarse and fine fuels respond differently |
| Surface spread | Rothermel-family fuel rate plus wind/slope vectoring | Published units and reviewed reference cases; water/built barriers |
| Front | Elliptical normal speed with a level-set equation | Directional growth, terrain projection, merging, narrow passages and stable time steps |
| Combustion | Remaining fast/residual fuel mass since arrival | Land/fuel-dependent duration; heat and smoke from consumed mass |
| Smoke | Advected/diffused/decaying puffs retaining emission history | Wind changes affect future motion; smoke crosses water; calm wind works |
| Near-ground heat | Reduced transported/dissipated heat from combustion | Independently parameterized from smoke; no fixed 50 m/90 C universal rule |
| Sensor channels | Local air temperature, RH relation, calibrated/synthetic smoke response and lag | Capability-aware, timestamped, noisy/biased when configured, quality states preserved |
| Alarm policy | Per-sensor anomaly, absolute temperature, smoke and persistence | Hysteresis, individual severity, gradual pulse, reduced-motion option |

Use a reviewed small published fuel set for grass, timber litter and timber understory. Initial candidates may include existing GR profiles plus TL/TU profiles; final numeric profile tables must be sourced and unit-checked. The satellite tree-cover class cannot uniquely choose them. Record local mappings and uncertainty.

The intended demonstration chooses dry fine grass for fast, brief spread and combustible woodland litter/understory for longer burning and stronger sustained emissions. Do not impose a universal rule that every forest burns harder than every field. Different loading and combustion times determine both intensity and persistence.

Proposed model settings for initial engineering benchmarks are a 5 km by 5 km area, 25 m grid, five-second observation outputs and a 30-minute interactive scenario/forecast. The numerical solver can take smaller adaptive steps. Six-hour runs remain a later performance/quality target; a 30-minute benchmark must not be labelled completion of the old six-hour requirement.

The proposed treatment of the user's preference against humidity-triggered flickering is continuous moisture dynamics. A clearly visible Test-only `Continuous spread` setting may apply the proposed damping floor described in the research document. It never permits water crossing or endless combustion of exhausted fuel. Physical real-data estimation uses the unfloored model. If a hidden test uses the override, that setting is public to its estimator.

Persist a versioned parameter manifest. It must identify sources versus chosen/calibrated values for fuel, initial moisture, curing, shelter, burn times, emission factors, mixing, sensor response, bias/noise and alert thresholds. No unnamed speed/temperature gain should be added merely to make the animation dramatic.

## 7. Unknown-fire estimation and forecasting

Use sequential weighted hypotheses, not the arithmetic centre of alarming devices. A hypothesis includes possible ignition location/time, evolving fire/fuel/smoke/heat state and uncertain parameters. Its prediction is compared with actual available sensor channels through the same named observation operator used in the synthetic experiment.

Keep competing explanations: no local fire, non-fire/upwind smoke, a faulty sensor, one local fire, and a bounded two-fire extension when required by separated evidence. Healthy non-detections constrain a hypothesis only where it predicts a detectable signal. Missing/failed measurements are not negative observations.

Required isolation:

- Inference accepts sensor metadata/effective-dated positions, timestamped observations/quality, available weather, analytical geography and public model settings.
- It does not accept ignition lists, truth-front rasters, truth RNG seeds, future generated readings or truth-derived candidate bounds.
- Hidden truth resides in a separate simulation owner and can be revealed later for evaluation. A normal estimator input log must be inspectable for leaks.
- Real telemetry remains connected through the documented platform API; it does not require inspection or modification of `iot`.

Correct the existing likelihood design: normalize the same supported-channel probability model under both fire and no-fire hypotheses; account for channel/temporal correlation, proposal sampling, measurement saturation and model discrepancy. Deduplicate observations by identity and availability time.

Use 32-64 evolving candidates as an initial performance benchmark. Broad proposal screening can use a coarser grid, followed by refinement that preserves barriers. Advance candidates incrementally. Resample/rejuvenate without collapsing separate plausible regions or losing all no-fire explanations. Benchmark a 15-second assimilation cadence; expose lag if computation falls behind.

Keep estimated parameter dimensionality modest: ignition/time, shared wind corrections and a few fuel/emission factors. Thirty sensors cannot independently identify every cell's fuel, moisture, wind and sensor calibration. Preserve uncertainty rather than hiding it behind one fitted answer.

Show three separately named results:

1. **Possible origin:** spatial/temporal credible region, conditional on a local fire, together with the no-local-fire probability.
2. **Likely burning now:** ensemble support for active combustion at the selected time.
3. **Forecast reach:** probability of being reached by +5, +15 and +30 minutes; conditional arrival-time intervals plus non-arrival probability.

Forecast by advancing posterior hypotheses with future weather uncertainty. Do not use future readings. A single smoke sensor can justify an upwind region but usually cannot identify a unique ignition point and time. Distinguish ensemble agreement from calibrated real-world confidence.

## 8. Architecture and file responsibilities

These are work boundaries for future implementation, not a claim that tasks have been delegated or completed.

| Area | Responsibility | Main existing location |
| --- | --- | --- |
| Primary experience | Test/Estimate shell, labels, editing, timeline and inspector | `apps/sandbox/src/ui/` |
| Browser execution | Worker protocol, cancellation, checkpoints, inference scheduling | `apps/sandbox/src/` |
| Environmental integration | Same-origin provider adapter, area preparation, frozen weather | `apps/sandbox/server/`, shared server adapters where appropriate |
| Shared contracts | Versioned environment/scenario/observation/result contracts | `packages/contracts/` |
| Physical engine | Moisture, published spread adapter, front, combustion and transport | `packages/simulation/` |
| Estimator | Pure incremental inference core with explicit input boundary | `packages/inference/` |
| Real data | Existing authenticated telemetry, Live/History and server jobs | `apps/server/`, `apps/web/` |
| Geographic provider | Minimal palette/version and bounded analytical-export extensions | Existing `map/server/` integration boundary |
| Evidence | Model references, browser journey evidence, limitations and measured budgets | `docs/` and existing test locations |

Keep changes centered in webplatform. The user's map-integration request adds a narrow dependency on the existing geographic provider; avoid unrelated redesigns or storage migrations in that project. No future phase gains permission to touch `iot` from this plan.

Extract environment-independent inference logic from Node-specific wrappers (`node:crypto` and server dependencies) so browser workers can reuse it. Use deterministic, versioned IDs/hashes appropriate to the shared contract. Do not copy a second inference algorithm into the UI.

Renderer state must be a projection of a versioned simulation/estimate frame. It cannot be a separate fire animation. Keep weather, terrain, chart and forecast bound to the same context, revision and time.

## 9. Delivery sequence and gates

### Phase 0 — Freeze the model and data contracts

Deliver the approved requirement matrix, metric/time conventions, environment manifest, fuel-profile/parameter manifest, observation contract and truth/inference boundary. Record which previous-plan requirements are superseded and which remain deferred.

Acceptance: every measurement/model parameter has a unit, source or explicit assumption, and a validity/quality treatment. Reference cases for the published rate formulas are available before replacing the engine. Missing data and no-fire likelihood semantics are specified.

### Phase 1 — Make the map usable first

Integrate existing map tiles/source metadata/presets with the primary Test workspace. Apply/version the restrained palette. Add the 30-sensor fresh start, persistent three-value labels, add/move/delete/undo and useful camera framing. Retain the existing engine temporarily with an honest version/limitations label. Add the explicitly labelled saved-weather fallback.

Dependencies: scene/source contracts and palette-version policy from phase 0. Complete the frontend design/browser workflow required by `AGENTS.md`, using the existing map as the baseline; composition comparisons concern tool placement and legibility, not inventing a new visual identity.

Acceptance: a fresh browser can open the map, see 30 readings, add a 31st sensor, move/delete/undo, place fire, run/pause and rewind without sign-in or hidden controls. Existing scenes survive refresh/import. Water, grass, trees and buildings are recognizably coloured. Inspect actual desktop and small-screen rendering.

### Phase 2 — Connect the analytical landscape and weather state

Implement bounded area preparation from real class data, conservative barriers, optional dissolved polygons, elevation quality, fuel mappings, and immutable weather/moisture initialization. Add deterministic scenario revisions and explicit live/saved-weather provenance.

Dependencies: provider adapter and geographic contracts. Display raster/cell delivery may precede polygon refinement, but the analytical source contract cannot be skipped.

Acceptance: inspector and solver read the same snapshot. Changing map opacity/palette does not change results. Water stays a barrier at 50/25/12.5 m test resolutions. Rain totals integrate correctly; fuel moisture relaxes over time rather than instantly following RH.

### Phase 3 — Replace front and combustion physics

Implement reviewed live/dead fuel-rate calculations, wind/slope vectoring and terrain projection, the stable level-set front, first-arrival/subcell fractions and fuel-consumption state. Preserve the existing graph engine as a comparison baseline during migration.

Dependencies: phase 2 analytical state and published reference cases.

Acceptance: calm-circle and constant-wind ellipse cases, terrain orientation, barrier and merging cases, mass/heat balances, time/space convergence and deterministic replay pass. Grass and selected woodland differ through parameters; no global 180-second lifetime remains in the new model.

### Phase 4 — Make every sensor respond physically

Implement historical smoke puffs, reduced near-ground heat transport, RH response, per-channel lag/calibration and independent alarms. Derive flame appearance from combustion, smoke appearance from transport and marker emphasis from sensor severity.

Dependencies: phase 3 mass/emission/heat sources.

Acceptance: downwind smoke can precede heating; a wind turn does not instantly rotate emitted smoke; smoke crosses water; zero-wind transport remains defined. Heated air's RH behaves as specified. Deleting/moving a sensor does not alter the fire. Alarm thresholds have hysteresis and reduced-motion support.

### Phase 5 — Estimate hidden fire and future spread

Integrate the browser-compatible estimator, comparable no-fire/fire likelihoods, nuisance hypotheses, incremental candidates, posterior products and uncertainty forecasts. Build the hidden-fire challenge and later truth comparison.

Dependencies: the shared observation operator in phase 4 and the isolation contract in phase 0.

Acceptance: estimator input traces contain no hidden truth/future data. Show improvement over an unassimilated model and a simple hotspot-centroid baseline on held-out cases, while measuring false positives and uncertainty coverage. Ambiguous/sparse cases remain uncertain. Outside-area smoke and one faulty device do not force an exact interior fire point.

### Phase 6 — Verify the complete product

Run the complete map journey with representative terrain, weather and sensor layouts. Measure worker/renderer responsiveness, memory, cancellation, playback/seek and inference lag. Review actual screenshots and observed user actions, then document remaining model/data limits and deployment status.

Dependencies: phases 1-5. Do not describe a passing build or historical test report as fulfilment of the revised acceptance criteria.

Acceptance: the matrix below is evidenced, numerical tolerances were declared before final evaluation, and failures/unsupported cases are visible. No deployment or production migration is implied by this planning task.

## 10. Acceptance matrix

| User requirement | Concrete verification |
| --- | --- |
| Default Test mode | Fresh profile opens editable local Test with no sign-in prompt |
| Thirty sensors | Exactly 30 on a fresh scene; restored scenes unchanged; a 31st can be added |
| Three values above markers | Desktop screenshot and keyboard/readout audit for all initial sensors; supported-channel units/quality correct |
| Move/add/delete | Pointer and alternative input journey, undo, persistence and revision handling |
| Existing map integration | Same real locations/features, progressive loading and attribution; no procedural substitute |
| Conventional colours | New and previously cached tiles have consistent palette; no red city/pink crop fallback |
| Steppe/forest-steppe/forest/water/city | Correct ecological versus cover semantics and representative location fixtures |
| Polygons where useful | Selected-area geometry respects water holes/topology; cell fallback is explicit and acceptable |
| Wind-driven fire | Direction conversion, ellipse orientation, changed-wind and calm cases |
| Land-dependent behaviour | Published fuel cases and named demonstration fixtures; water blocks surface flame |
| Humidity dependence | Moisture lag, wet/dry cases, accumulated rain and visible Test override |
| Individual sensor response | Local transport/lag calculations with time-series evidence; no global reading boost |
| Increasing alarm emphasis | Individual warning/critical state, persistence/hysteresis and reduced motion |
| Unknown fire location | Blind-input audit, held-out localization and explicit ambiguity |
| Forecast over time | Observation cutoff and weather ensemble checks; arrival/no-arrival distinctions |
| Rewind | All fields and estimates agree at a fixed revision/time before and after seek |
| Real data preserved | Existing telemetry/auth and Live/History checks remain valid without touching `iot` |

## 11. Performance and validation budgets

Initial benchmark targets, to be measured on the documented development device:

- 40,000 landscape cells and 30 three-channel sensors; five-second observation output.
- Main-thread edit/selection feedback target under 100 ms; smooth map interaction while workers compute.
- At least 30 rendered frames per second during normal playback where supported; computation cadence remains independent.
- Seek to an available checkpoint target under one second, with visible progress/cancellation for longer recomputation.
- Start inference benchmarking at 32-64 candidates, 15-second assimilation intervals and a 30-minute forecast. Report wall-clock lag; these numbers do not promise calibrated precision.
- Bound active puff count/memory through mass-preserving grouping, cancellation and domain exit accounting. Never generate an unbounded object per cell per step for the entire history.

Numerical checks include analytical front geometry, moisture/response exponential updates, source/transport conservation, coordinate rotation, water topology and refinement. Define convergence/error tolerances before collecting release evidence.

Inference checks include healthy non-detections, missing/delayed packets, channel covariance, duplicate IDs, poor network geometry, no local fire, outside smoke, wrong initial hypotheses and multiple ignition cases. Report detection delay, false alarms, identifiable-origin error, credible-region coverage/size, perimeter overlap, Brier score and arrival-time/no-arrival quality.

Synthetic recovery using identical forward/inverse equations is only an integration check. Evaluate perturbed observation/fuel/weather models and independent reference cases; later use appropriate measured datasets to justify real-world accuracy claims.

## 12. Deferred work and known limits

Crown fire, ember spotting across water, building combustion, fire-atmosphere feedback, suppression, detailed vertical smoke chemistry and actual hardware calibration require separate models/data. The first release models surface vegetation fire and a reduced near-ground observation field.

Long-horizon learned risk, satellite assimilation and the previous plan's broader deployment work remain follow-on tasks. They do not block fixing the map's default usability or excuse skipping the physical/observation validation above.

The source of fuel/moisture/transport uncertainty must stay visible in model diagnostics. A 25 m grid and a smooth polygon are computational choices, not promises of 25 m localization accuracy.

## 13. What this planning task actually verified

Read the existing webplatform plan/instructions, relevant code/contracts/docs and sample environment. Inspected loaded first screens of the anonymous sandbox and the existing map in a browser. Reviewed primary scientific/official provider references and checked formula units and several analytic examples. Read current map configuration/renderers and identified the analytical-export and palette-cache gaps.

Created this plan and the companion research document. No application code, original implementation plan, service configuration or deployment was changed. No full project test suite or field validation was performed during this research task.
