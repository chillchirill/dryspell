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
