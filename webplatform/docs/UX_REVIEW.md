# UX review evidence

Date: 2026-11-14. This document distinguishes code review, automated checks and actual visual inspection. The coordinator owns the integrated browser suite and later acceptance record.

## Executed checks at frontend handoff

- Read the full Anthropic frontend-design source and applied its plan/build/critique sequence within the authoritative map brief. Read focused Impeccable Operate and simplification references; did not install or execute Impeccable tooling. Read Vercel's interface rules and reviewed the implemented frontend against them.
- `npm run typecheck` passed after the initial implementation and environment controls. A subsequent run reported only reviewer-owned `tests/review/database.ts` imports containing `?review-pass`; it reported no frontend error. Later source adjustments still require the coordinator's final typecheck.
- `npm run build` passed. ECharts now loads when inspection is opened: initial application JavaScript is approximately 1,479 kB / 415 kB gzip, chart chunk 555 kB / 188 kB gzip. Vite still warns about chunks larger than 500 kB; no performance target is claimed from size alone.
- `npx vitest run apps/web/src/geography.test.ts`: 2 tests passed. Equivalent wrapped coordinates select the same cell, and an antimeridian-crossing area renders as a continuous 2-degree extent rather than 358 degrees.
- Actual HTTP readiness returned database connected and worker healthy. This is a health observation, not independent proof of all integrations.

## Actual rendering inspected

Inspected `docs/design/empty-desktop-reviewed.png`, a 1440×900 Chrome capture from the coordinator's actual built-app/PostgreSQL browser run. The browser test failed at its exact-text scenario-name locator because the button includes revision metadata; the coordinator corrected that locator. The failure did not show an application rendering error.

The capture visibly shows Glendalough topographic relief, actual effective land-cover classification, water, geographic names, the prepared-area boundary, a narrow edge tool strip and a bottom time rail. The map extends to all viewport edges. No permanent fleet sidebar or card-dashboard layout is present. The initial composition gate passes this inspected state. The identity is carried by map tools, survey-like symbols and shared time rather than a theme recolor. The selection, running and mobile identity gates remain pending actual captures.

Two study routes use the same environment and scenario: `?study=strip` and `?study=shelf`. The initial comparison and choice are documented in DESIGN.md. A paired rendered capture comparison is still required at this handoff; the implementation does not claim it has happened.

## Review findings addressed in source

| Finding | Resolution | Verification status |
|---|---|---|
| Historical markers used current device positions | History requests effective-dated `/sensors?at=` and latest observations at the same cutoff. Incoming WS data requires both observation and receipt time no later than the history cursor. | Backend API and frontend wiring implemented; integrated regression belongs to coordinator. |
| Dense telemetry could display an old inspector value after reload | Inspector takes the newest matching observation from the independent latest-state query. Charts request newest bounded history with `order=desc&limit=1200` and sort it chronologically. | Source corrected after last build; requires final integrated regression. |
| Crossing antimeridian could select or paint incorrect cells | Shared frontend longitude-span/offset helper, continuous display coordinates, wrapped cell lookup. | 2 unit tests pass. |
| Prediction form attempted to post the full grid | Compact `{scenarioId, revision, at}` request; server assembles permitted inputs. | Backend route and frontend wiring implemented. |
| Current readings could be mistaken for zero | Capability slots explicitly distinguish Not supported, No reading, Stale and numerical zero. Chart gaps remain null. | Typechecked; browser acceptance pending. |
| Initial bundle loaded charts before any inspector | Lazy-loaded chart module. | Production build measures separate chunk. |
| Font license must accompany self-hosted assets | IBM Plex license retained at `apps/web/public/fonts/LICENSE-IBM-Plex.txt`; Latin/Cyrillic subsets compile locally. | Build includes local fonts; no external font CDN at runtime. |

## Vercel implementation review

Reviewed `apps/web/src/App.tsx`, `TerrainMap.tsx`, `TelemetryCharts.tsx`, `SensorList.tsx`, `EnvironmentSettings.tsx`, `global.css` and `workspace.module.css`.

Controls use native buttons/labels/selects, accessible icon labels, visible keyboard focus and explicit form errors. Radix manages sign-in modal focus. Numerical coordinates and the sensor list provide alternatives to map gestures. Reduced motion disables transitions. Source/context and filter text are reflected in the URL. Mutations preserve failed draft state and offer retry; simulation deletion is undoable, real-device deletion displays affected-record counts and requires typed identity confirmation. Credential issuance is administrator-only and not saved in browser storage.

Remaining review limits: core workspace tools, time controls, reading states, loading and fault-editor strings now live in `apps/web/src/locales/en.ts`; secondary copy is still inline English. Chart zoom is Ctrl+wheel with an exact-value table fallback, but full keyboard chart zoom is not yet verified. These are not claimed complete.

## Follow-up implementation handoff

After the coordinator's actual browser journey placed all four profiles and reloaded, it exposed an early-click loading race: ignition placement was available before the workspace response arrived. The frontend now disables Add sensor, Add ignition and numeric placement submission until the scenario and its matching environment are ready or explicitly partial. Keyboard tool activation uses the same guard. Loading text replaces misleading placement availability.

Map marker activation now tests a 28 CSS-pixel overlap radius and opens an explicit object picker when several objects occupy that screen area. The picker includes profile/device identity and ignition time; choosing an item selects directly. The sensor list retains direct selection without triggering the overlap picker.

A contract 1.1 simulated-fault editor now supports dropout, stuck value, measurement spike, packet delay and smoke without fire. It restricts channels to actual sensor capabilities, validates time windows, and saves through the same revisioned scenario PATCH as other persistent configuration. Smoke-without-fire is offered only for smoke-capable profiles.

`npm run typecheck` passed after these changes. No build or browser suite was started by the frontend agent during this handoff; the coordinator owns the next rebuild and integrated checks. Fault configuration and overlap behavior therefore remain source-verified until those journeys execute.

The follow-up also added an optional Live/History satellite layer using `/satellite` with the prepared-area bounds, a 24-hour observation window and explicit receipt/availability cutoff. Point symbols and the contextual inspector disclose provider confidence and nominal resolution; they are never presented as exact perimeters or calibrated probabilities. A paginated list provides keyboard inspection. Missing FIRMS access shows an unavailable live-source message while allowing previously imported data to remain visible. No live satellite retrieval has been claimed or verified by the frontend agent.

Live sensor status now comes from `/sensors/status` and `sensor.status` WebSocket events. The inspector labels connection health and its evaluation time separately from measurement quality or fire evidence. History does not reuse current connection health as historical evidence. The sensor list sorts the displayed health/state value.

The satellite and status additions passed `npm run typecheck`. A further refinement caches the immutable workspace response and polls lightweight scenario metadata every five seconds. A revision/environment change clears incompatible frames and refetches the workspace; routine clock/status polling no longer retransmits the entire 40,000-cell terrain grid. Final typecheck and browser integration remain coordinator-owned after the handoff.

## Required continuation

The coordinator must finish the actual place combined/temperature/humidity/smoke → ignition → Run → changing readings → Pause → rewind journey, persistence/reload, move/cancel/undo/save recovery, terrain input agreement, display-layer determinism, Live ingestion and cutoff-safe History. Inspect the selected/running/terrain/estimate/mobile captures and fix any defects.

Required viewports still to verify at this handoff: 1280×800, 768×1024, 390×844, 320 CSS px and 200% zoom. The source contains responsive rules for these sizes; that is not evidence that the rendered layouts pass. Keyboard/touch and scientific accuracy are not established by a production build.

## Final integrated browser and visual acceptance

The coordinator executed the built app against actual PostgreSQL, compiled Express/worker processes and real WS delivery. The final full harness passed84 tests and six Chrome journeys; a subsequent focused layout test passed after moving the tablet legend above attribution. No internal API, authentication, persistence or worker was replaced in the main journeys. The failed-save check injects one labelled503 and then retries the actual save; the chart check delays delivery of an actual response.

Observed journeys: all four profiles placed and persisted across reload; real map click and numeric placement; panning without placement; movement cancel/save; failed-save retry and undo; water ignition rejection; actual run, changing measurements, pause and deterministic seek; terrain snapshot identity; display-layer invariance; rendered observation-based estimates; real Live zero-value ingestion; History cursor stability; full touch placement/ignition/run/pause/rewind. Native Chrome200% zoom was set in an isolated profile and verified as720 CSS pixels/devicePixelRatio2 within a1440-pixel viewport.

The coordinator manually inspected desktop, tablet and mobile captures, including03 selected rewind,04 terrain,05 estimate, the loaded06/07 composition pair,08 mobile inspector,11 delayed-history charts,12/13 native zoom,14 ten-minute fire and15 touch rewind. The final `legend-768.png` confirms the tablet legend correction. Automated checks cover1440×900,1280×800,768×1024,390×844,320×844 and native200% zoom. Horizontal overflow and legend/attribution overlap checks passed. These are Chrome results; no broad browser or screen-reader certification is claimed.

Final gate assessment:

- **Composition:** full physical map, compact edge tools and bottom transport; no dashboard card or permanent fleet sidebar.
- **Identity:** coherent profile glyphs, simulated/real outlines, selection brackets, terrain classes and time presentation. The strip wins the same-fixture desktop comparison; the shelf serves narrow layouts.
- **Interaction:** the complete place/run/inspect/rewind flow, recovery and touch/keyboard alternatives passed in the map workspace.
- **Environment:** the inspector uses the engine's immutable snapshot; physics fixtures verify wind, slope, fuel, moisture and barriers. Hiding effective cover preserved the frame checksum.
- **Quality:** known chart, cancelled-request banner, missing map-worker, zoom tool and legend collisions were fixed and rechecked. Actual burning/burned polygons and estimate cells now render, rather than merely existing in API results.

The independent reviewer separately inspected final fire, estimate, charts, mobile and zoom artifacts. R11 boundary replacement is source-verified; a browser journey switching between two different extents remains unexecuted. Full keyboard chart zoom, broader assistive-technology coverage and pixel-frozen external basemap goldens remain verification limits. Scientific forecast accuracy and unavailable providers are not established by these UI checks.
