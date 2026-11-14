# Sandbox UX verification

## Implemented and source-reviewed

- Anonymous local experiment, initially empty. Prepared terrain and live weather are separate prerequisites; failed weather never silently uses the old sample weather.
- Four capability profiles, fire, repeated click placement, desktop palette drag, marker drag, cancellation, Undo, numeric coordinates, object list, and overlapping-object picker.
- One Run/Pause action, rewind, recorded-time seek, secondary speed, frozen weather, immutable worker generations, and paused recovery.
- One sensor/ignition/terrain inspector. Supported channels have SVG plots and accessible values tables. Unsupported, missing, stale, and zero readings remain distinct.
- Local IndexedDB recovery with separated environment and small draft writes. Validated export/import. New experiment retains Undo recovery and requests fresh weather.
- Mobile two-row palette, bounded inspector, visible focus and no decorative motion.

## Checks performed by the frontend agent

`npm run typecheck` passed after the initial implementation and again after interaction refinements. `npx vitest run apps/sandbox/src/ui/draft.test.ts apps/sandbox/src/canvas/geography.test.ts` passed: 2 files, 7 tests. These establish type safety and input boundary behavior, not visual quality or scientific accuracy.

The coordinator inspected `output/playwright/sandbox-first-desktop.png` and reported that the shelf is clear. The requested fix removed the large duplicate introductory panel and made Open-Meteo visible in the weather header. This agent did not independently execute the browser journey or capture that image.

## Vercel-oriented source review

Reviewed the UI and canvas files for accessible icon names, labelled form inputs, native buttons, visible focus, numeric input boundaries, progressive disclosure, selection alternatives, scroll containment, and reduced motion. Corrected tiny mobile labels by giving the tools two rows. Corrected palette dropping over floating controls by checking the actual pointer target. Escape on marker dragging cancels the proposed edit.

## Browser acceptance still to record

The coordinator owns the browser harness and evidence. Verify desktop and 390/320 px layouts; compare shelf and strip on identical data; place all profiles by click and drag; pan without placement; reject water; run through changing readings and fire; pause, rewind and reproduce the same values; recover paused after reload; export/import; cancel drag; and use keyboard/list/coordinates. Exercise a failed weather response and a real successful provider response separately. Saving depends on browser storage availability; export remains the recovery option when local storage fails.

This standalone sandbox does not implement Live/History, inference, authentication, telemetry, PostgreSQL, or deployment. Those remain in the existing platform and are intentionally outside this sandbox's UI ownership. Its deterministic fire model is a simplified experiment, not a verified wildfire forecast.

The user supplied a dark geographic reference after the initial light desktop capture. The subsequent style revision uses an Esri World Dark Gray basemap (CARTO returned key-required tiles during review), charcoal effective terrain, graphite surfaces, muted white typography, warm fire, and violet wind. A new browser capture is required; the earlier light capture does not verify this revision.


## Final coordinator and independent browser acceptance
The pending checklist above is historical. Root reviewed the final dark paired shelf/strip and mobile compositions. Independent QA passed seven complete browser cases, then three focused cases after layout fixes (eight distinct cases overall), including native Chrome200% zoom and visible fire after600simulationseconds. Inspector occlusion, stale weather completions, expired retry, pending-New Undo, attribution clipping and short-height notice/legend overlaps were fixed. See SANDBOX_REVIEW.md for exact builds, commands and limitations. Root separately verified live Open-Meteo HTTP acquisition; E2E substitutes only that external provider response. Final build changes only redundant paused-notice wording after the affected browser passes.


## Vegetation and six-hour revision checks

Executed `npx vitest run apps/sandbox/src/ui/draft.test.ts apps/sandbox/src/ui/wind.test.ts apps/sandbox/src/canvas/geography.test.ts apps/sandbox/src/canvas/palette.test.ts`: 4 test files, 21 tests passed. Coverage includes six-hour and legacy imports, duration/weather boundaries, crop/built-up palette semantics, antimeridian coordinates and all cardinal wind arrows. These tests use explicit unit data and do not claim live tile/provider verification.

Implemented a display-only land-cover/ecological-region switch, labelled natural palette, explicit numerical-grid legend, per-layer failures, north-up wind alignment and fresh landscape loading for New experiment. Original saved scenarios remain untouched. The latest reading cache copies only selected-sensor history to UI state; the expanded value table shows the most recent 200 readings, while the plot still uses the full available selected history.

Coordinator browser verification must now exercise actual proxied tiles, inspect forest/field/city colors at working and regional scale, compare both layers while checking identical simulation outputs, check 390/320 px overlays, and run/pause/seek beyond 30 minutes. External map files were read only. No new browser inspection or deployment is claimed by this frontend handoff.


After engine-version migration was added, the same four focused test files passed **24 tests**. Three additional cases cover old recorded runs, matching-engine recordings and unrun drafts. The main workspace exposes read-only frame checksum/time attributes for the coordinator's layer-invariance browser test; these do not affect simulation state. Source checksums for the current Anthropic/Vercel readings were actually recomputed and recorded in SANDBOX_DESIGN.md.


## Any-area and custom-duration revision

Executed six focused files with `npx vitest run apps/sandbox/src/ui/draft.test.ts apps/sandbox/src/ui/wind.test.ts apps/sandbox/src/ui/history.test.ts apps/sandbox/src/ui/weather.test.ts apps/sandbox/src/canvas/geography.test.ts apps/sandbox/src/canvas/palette.test.ts`: **37 tests passed**. New coverage accepts coherent durations above six hours, rejects unsafe timestamps, retains legacy durations, checks extended-weather disclosure, and verifies routine pruning plus replacement of old/future history on rewind.

Implemented explicit current-map preparation, coordinate/width entry, loading/cancel/retry, atomic successful installation, Undo, stale-response invalidation, dynamic area naming/resolution, and positive decimal hours. Failure keeps the old experiment. The header identifies weather held beyond the forecast; chart labels identify the bounded recent window.

Coordinator browser review remains required for actual cold area acquisition, an unavailable area with the previous experiment intact, cancellation/stale responses, decimal and long durations, extended-weather labels, and desktop/mobile control collisions. No new provider/browser/deployment success is claimed by the frontend agent.

Final checks for this revision: workspace `npm run typecheck` completed with exit 0; the six focused test files completed with **38 passed** after adding a delayed-arrival regression. History retention and chart horizontal positions use receipt time; freshness continues to use observation time. No build or browser was run by this frontend agent.


## V2 incremental UI review

The source revision exposes hours/Apply directly on the timeline; API/manual/demo wind directly on the map; and a separately labelled map-center weather preview. Fresh scenes seed 30 valid-land sensors and add a 31st normally. Restored scenes do not reseed. Every marker has persistent capability-aware values and its own severity ring; the list fallback displays the same values. Label displacement uses leader lines, and effective-area camera padding is reduced. Combustion phase/intensity drives flame/residual/burned appearance.

The coordinator is building a candidate for actual desktop/320 px inspection. This agent has not executed or claimed those browser checks. Required review includes 30-label legibility, wind/time target reachability, manual-wind persistence and extension, API refresh failure/demo fallback, preview isolation during pan, and matching frames after rewind. Focused tests and final typecheck results are reported in the handoff.

Final focused execution: `npx vitest run apps/sandbox/src/ui apps/sandbox/src/canvas` passed **8 files / 50 tests**. Added deterministic land seeding, 31/500-sensor storage, manual zero-wind persistence, explicit demo admission, missing/unsupported/zero reading distinctions, warning persistence and recovery-hysteresis cases. Workspace typecheck completed with exit 0. These are software behavior checks, not physical calibration. The coordinator owns candidate browser evidence and any further visual corrections.


### Actual capture correction: label and mobile control collisions

Viewed the coordinator's `output/playwright/v2-controls-desktop.png` (1280 × 720) and `output/playwright/v2-controls-mobile-before.png` (390 × 844). Confirmed overlapping marker readouts, labels underneath bottom controls, tiny text, and an expanded mobile legend covering wind controls. The finite nearby-position search incorrectly fell back to an occupied location.

Replaced that fallback with deterministic free-rectangle packing. It reserves actual instrument rectangles, all marker hit areas, other labels, and viewport edges. Readouts use 12 px values in fixed 118 × 72 px boxes; leader lines connect displaced labels. Structural UI resize and inspector changes trigger layout, while ordinary numeric updates do not shuffle labels. If no legal rectangle exists, the marker remains and a visible Sensor list action reports how many labels need room; the synchronized list keeps every measurement accessible. The default legend is collapsed; mobile expanded layers remain in their own column and no longer widen across wind controls. Manual input defaults are rounded for display only.

Focused geometry tests use the captured desktop's controls/markers and require all 30 labels without intersections; an insufficient mobile-space case requires collision-free fallback. They passed. Coordinator rebuilding/reinspection must confirm actual DOM geometry, reading legibility and mobile hit targets after this correction. Dense 500-object label visibility/performance remains outside the verified default workload.


### Native 200% zoom inspector correction (S10 P2)

The reviewer reproduced a 44 px inspector at a 720 × 450 CSS viewport. The referenced failure capture had already been removed when this agent tried to open it; the conflicting `top:270px` and height-based maximum were confirmed in source. At viewport heights at or below 650 px, the inspector now occupies a bounded 12 px inset overlay with an independently scrolling content region. Close remains fixed outside that region, and focused form controls have scroll padding. This preserves usable fields at native zoom without changing the normal-height composition. The generic recovery copy now says “Model updated; run again.” Browser rerun remains reviewer-owned.


## Compact sandbox-v4 source review — 14 November 2026

Implemented the user-requested structural simplification: one fresh sensor, one Add sensor tool, direct one-line readings, selected-sensor channel/enable settings, compact end duration, historical UTC date/hour picker, 150×/300× playback, collapsed weather into the single inspector, and explicit click-confirm regional preparation. Removed automatic pan-preview requests and the permanent area-action panel. Preserved stored scenes, legacy profiles, arbitrary positive duration, asynchronous cancellation/stale-response guards, Undo, import/export and the effective numerical overlay.

Vercel interface review applied to the changed source: labelled native inputs/buttons, keyboard slider/date controls, semantic loading status, explicit UTC formatting, constrained popovers and short-height scrolling, and no new gesture-only operation. The disabled/no-data/unsupported distinction remains visible. Dense sensor lists use content-visibility; simulation readout updates no longer copy the entire cache for each sensor. This source review is not a claim of browser verification.

Executed before handoff: `node node_modules/vitest/vitest.mjs run apps/sandbox/src/ui apps/sandbox/src/canvas` — 10 files / 61 tests passed. The focused tests cover one-sensor deterministic land seeding, valid subsets/disabled imports, distinct compact reading states, date bounds/hour precision, historical origin preservation, five-minute current-weather reuse, and batched intermediate high-speed observations. Workspace TypeScript passed after the backend weather module was restored (an earlier run encountered that in-progress missing module).

Current browser acceptance remains with coordinator/independent reviewer after source freeze: fresh landscape→one sensor before weather→fire→Run→150×/300×→pause→rewind; sensor channels/disable; historical day/hour selection and actual archive provenance; past Run/area/duration origin invariance; region-confirm cancel/pan/Escape/error; desktop and 390/320 CSS px/native200% layout. No new provider success, archive acquisition, performance result, or browser capture is claimed by this frontend handoff.
