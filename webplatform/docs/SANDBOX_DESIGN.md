# Dryspell anonymous sandbox

The sandbox is an independent experiment surface. It has no account or database dependency and does not edit the established platform. Its subject is the effective Glendalough terrain and objects placed on that terrain.

## Composition decision

The same restored draft can be opened with `?composition=shelf` or `?composition=strip`. Both use the same landscape, objects, weather snapshot, inspector, and worker. Only tool arrangement differs. The shelf is the default requested for this revision. The user subsequently supplied a dark geographic reference: the approved visual revision uses graphite controls, muted white type, orange fire, and violet wind.

```text
Shelf                                    Strip
Dryspell                        Weather  Dryspell                  Weather
                                              Select
             physical terrain                 Combined    physical terrain
                                              Temperature
                            Inspector         Humidity            Inspector
                                              Smoke
      Select  four profiles  Fire              Fire
      Run  rewind  time  scrubber              Run rewind time scrubber
```

The shelf exposes profile names without a submenu and keeps placement adjacent to Run. The strip consumes less horizontal space but takes a tall strip away from geography and separates the starting tools from time. The first desktop browser capture inspected by the coordinator favored the shelf. The coordinator requested removal of the redundant introductory panel; this was implemented. Final paired captures and complete mobile/browser acceptance remain coordinator-owned evidence.

## Visual language

The terrain carries the visual identity: actual classified vegetation, water, topographic context, discrete fire cells, an explicit simulation boundary, and movable instrument symbols. Interface surfaces occupy only small floating groups.

| Token | Value | Purpose |
| --- | --- | --- |
| Surface | `#191c1f` | Opaque, readable instruments over varied terrain |
| Ink | `#e9edef` | Primary labels and values |
| Muted | `#aeb6bf` | Secondary explanation |
| Line | `#3a3e43` | Group separators, not nested cards |
| Selection | `#afa2df` | Tool selection, focus, marker outline |
| Fire | `#f09a4b` | Ignition tool and symbol |

IBM Plex Sans is self-hosted via the existing licensed dependency. Ordinary text is 15 px. Mobile tools use 12–13 px labels with 45 px targets in two rows, rather than six tiny labels. The basemap uses Esri World Dark Gray tiles with provider attribution (CARTO returned API-key-required watermarks during actual browser review). Effective terrain remains a separate real-data overlay, with classified woodland, grass, water and elevation shading in subdued charcoal shades. Violet wind and warm fire follow the supplied reference. Circular sensor markers share a 24 px SVG system: three spokes for combined, thermometer, drop, and rising smoke. Fire uses a contrasting square flame marker. Selection has an explicit outer ring. Burning orange cells and dark burned cells have a labelled legend.

Desktop uses a centered bottom shelf and transport, with a single right inspector. Mobile uses a two-row shelf and a bounded, scrollable inspector above the transport. Selection closes back to the exact same map. Coordinates and object list provide keyboard and map-failure alternatives. No decorative animation is used.

## Interaction and time

Choose a profile and click repeatedly to place sensors, or drag a desktop palette tool onto the map. Touch uses click placement. Enter on the focused map places the active tool at its center; coordinate forms and an explicit center action avoid precise spatial gestures. Existing markers drag directly; Escape cancels placement/selection and an active marker drag. Objects on water are rejected and ignition requires burnable effective terrain. Nearby overlapping markers open an explicit picker.

Run/Pause controls the sole local experiment. The worker owns fixed simulation steps; speed changes wall-clock pacing only. Rewind and seek pause first. Seeking is bounded by recorded time; resuming from the past traverses the recorded frontier before extending it. The map, weather, current readings, and plots consume matching frames. Imported/restored runs reopen paused. Editing resets time and creates a new revision; Undo restores objects as another new draft revision.

IndexedDB stores immutable environments separately from small draft/cursor records. Saves occur every two seconds and on pause/visibility changes. Export contains the complete environment and scenario. Import validates dimensions, finite data, capabilities, weather coverage, bounds, burnability, and the 30-sensor/40,000-cell limits. This is local experiment storage, not authenticated platform persistence.

## Sources reviewed on 2026-11-14

Read the complete official [Anthropic frontend-design source](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md), focused [Impeccable Distill](https://raw.githubusercontent.com/pbakaus/impeccable/main/plugin/skills/impeccable/reference/distill.md), and [Vercel interface guidance](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). These were source readings, not installation or execution of their tools. Existing `docs/DESIGN_REFERENCES.md` records the source checksums reviewed earlier on the same date: Anthropic `d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3`, Distill `a5702d46b5a17a38c555044439c2e76585848ee8c5a74b8470fa5de06aaa03f8`, Vercel `d246b026f4f29b5823a9cc857f9edf3d2507002e055e32040cadeaf3b38e0234`. The new readings used mutable `main` URLs; those earlier hashes identify the earlier recorded source bytes, not an unperformed new checksum verification.

Anthropic informed the subject-first composition and deliberate tokens. Distill informed removing duplicate introductory copy and moving file operations behind one menu. Vercel informed semantic controls, visible focus, reduced motion, labelled fields, accessible chart tables, explicit errors, and gesture alternatives. No skill package was retained. Existing package licences remain applicable: IBM Plex OFL, MapLibre BSD-3-Clause, Lucide ISC, React MIT. Dataset attribution is exposed under the experiment menu; raster attribution remains on the map.


## Vegetation and six-hour revision

The user's next refinement preserves graphite interface surfaces while making actual vegetation legible. Effective terrain now uses forest green `#4c8258`, shrub/forest-steppe olive `#9daf63`, grass `#bdd180`, steppe gold `#d6b76e`, cropland wheat `#c6aa66`, neutral built-up slate `#8b949b`, water blue `#4f91b5`, and bare/sparse `#b4b6a2`. Original ESA class codes distinguish crops from the engine's coarse grass category. Missing codes remain coarse classes and the terrain inspector says so. Grass is never renamed steppe without ecological evidence.

A compact Land cover / Ecological zones switch selects same-origin tiles provided by the independent map service. The map project's raster renderer, ecological palette, public layer behavior and source labels were inspected read-only. No files in that project were modified. Land cover uses ESA WorldCover 2021; ecological regions use RESOLVE 2017 and are explicitly regional context. The outlined numerical grid always remains above either regional layer and uses exactly the run's immutable environment. Layer changes are presentation state only. Tile failure leaves this effective grid usable and shows a source-specific failure message. The labelled legend is expanded on desktop and collapsible on mobile.

The map is locked north-up, including mouse and touch rotation. The violet arrow is an upward base glyph rotated clockwise by `(windFromDeg + 180) mod 360`; text says both source and destination compass directions. Thus a west wind points east. Cardinal conversion has executable unit coverage.

New experiments default to six hours and fetch the latest prepared landscape plus fresh real weather. Existing local snapshots retain their terrain/weather. The experiment menu offers 1, 3 and 6 hours; valid legacy 30-minute documents retain that duration. Changing duration resets the local revision and never extends an old computed frontier. Imported timelines must fit their chosen duration and weather must cover it. Selected charts retain capability semantics; observations accumulate in per-sensor caches instead of copying every sensor's history per tick.

The complete official Anthropic and Vercel sources were read again on 2026-11-14. UTF-8 source checksums were actually recomputed during this revision: Anthropic `d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3`; Vercel `d246b026f4f29b5823a9cc857f9edf3d2507002e055e32040cadeaf3b38e0234`. No packages or skill tools were installed or invoked. Anthropic's subject-specific composition informed the geographic palette; Vercel's implementation guidance informed labels, display-only state, legible controls and failure messages. This revision still needs coordinator-owned browser captures; source review alone does not establish visual quality.


Engine-version recovery now records the simulation package's actual `ENGINE_VERSION` in sandbox documents. On restoring or importing a recorded run with a missing/different engine version, the UI preserves sensors, ignitions and frozen environment but resets cursor/frontier, increments the draft revision, and visibly asks the user to rerun. Unrun drafts and matching-engine recordings retain their normal semantics. Mouse, touch and keyboard map rotation are all disabled so the wind compass cannot drift from geographic north.


## Any-area and custom-duration revision

The current interaction supersedes the fixed-area/six-hour limits above. The map keeps the same full-canvas shelf composition. A compact **Use this area** action prepares a 5 km square at the current map center. The existing menu also accepts coordinates and a 1–20 km width. The independent data adapter returns real terrain at adaptive resolution, capped at 200 × 200 cells. The UI never substitutes the regional display tiles for these numerical inputs. New-area success fits that snapshot; its inspector and run share the same returned data.

Preparation keeps the previous experiment available while showing a loading state. Cancel aborts the request. Failed preparation exposes Retry without replacing the previous scenario. Newer input operations invalidate earlier responses; successful preparation replaces the experiment atomically and retains an Undo snapshot. Outside-area placement explains how to prepare that point instead of silently discarding current objects. Map-center longitudes wrap into WGS84 for repeated-world panning.

Duration is now a numeric hours field with Apply, accepts decimals, and uses the shared sandbox-v2 conversion to 5-second ticks. There is no six-hour UI/import cap. Representable timestamps and safe integer ticks remain validated. Existing covered weather remains frozen. A longer duration requiring new weather is a cancellable transaction: the old experiment is retained until a coherent new snapshot succeeds, then a new draft revision starts at zero.

Weather beyond the provider's actual forecast is explicitly described as holding the last available conditions. `extensionPolicy`, `forecastEndSec` and `extensionEndSec` remain in provenance; a persistent header label and menu details disclose the assumption. This is not presented as additional forecast data.

The worker may simulate an arbitrary horizon while UI observation caches retain only its recent six-hour window. Full reconstruction replaces cached history; ordinary frames prune the same window. Charts show the actual window origin and explain that rewinding reconstructs earlier readings. These changes follow the already reviewed Anthropic composition and Vercel implementation guidance; no additional skill package/tool execution occurred.

Recent-history retention is based on receipt time, including late readings whose observation time is older. Chart horizontal positions represent arrival time; current-value freshness still uses observation time. Reconstructing a past window replaces the cache, rather than mixing future readings into it.


## V2 phase-one usability and combustion integration

Read the revised implementation plan and full accompanying fire-model research before this change. Their Phase 1 requirements supersede the earlier empty scene and 30-sensor ceiling: fresh scenes now seed exactly 30 combined sensors on distinct known land cells, with no ignition. The 6-by-5 target layout is deterministic and independent of hidden fire; insufficient valid land produces an explicit error. Existing stored/imported scenes retain their sensor count. The local storage boundary permits 500 sensors. This does not establish smooth runtime performance for 500; the default 30 remains the engineering workload.

Persistent marker labels show Temp, Humidity and Smoke with units and data-quality states. A spatial displacement pass avoids other labels and floating instruments where possible, with leader lines back to each marker. Dense user-created clusters retain an explicit object picker and a synchronized list containing all three values. Warning/critical rings are independent per sensor, with three-sample warning persistence and six-sample recovery hysteresis. These are documented synthetic alarm policies, not calibrated wildfire thresholds; static rings avoid motion/accessibility problems. Camera padding is reduced to frame substantially more of the effective area.

### Two timeline compositions, one scene

The same local fixture/state can be opened with `?timeline=inline` or `?timeline=split` (default). Inline puts duration and transport on one long horizontal rail. Split attaches a compact always-visible hours/Apply row above the transport. Both preserve the same map, object shelf, state and controls. Split is selected because it keeps the hours field discoverable at 320 CSS px without compressing the scrubber or hiding it in a menu. It uses no permanent sidebar. These are functional composition variants; coordinator browser evidence remains required for rendered comparison.

Wind now has direct API and manual controls beside the map, including m/s and meteorological from-direction. Applying manual wind changes only wind in all frozen samples, records override provenance, pauses the experiment, resets outputs and creates a new revision while preserving objects and temperature/humidity/rain. The manual preference survives persistence/import and weather extension. Use API wind explicitly requests fresh area weather; a fresh API-mode Run also refreshes once before starting, then freezes the resulting series. An explicit saved-demo action uses dated synthetic reference weather; it never masquerades as live weather.

Panning more than approximately 1 km from the experiment center requests a debounced, quantized, abortable weather preview. The preview names its coordinates and Map preview context. It cannot change the current environment, run wind, readings or revision. Use this area remains the explicit action that prepares a new experiment there.

The selected V2 palette is forest `#4f7f45`, shrub `#b8ba86`, grass/steppe `#d9cd8a`, crops `#d8c59b`, city `#b6b8ba`, water `#6eaed6`, forest-steppe `#a8b87b`, and unknown `#dadada`. Both initial and retry tile requests use `palette=dryspell-natural-v2`; numerical inputs are unchanged by display styling.

Fire rendering now consumes frame combustion entries. Flaming orange opacity follows clamped intensity; residual heat has a distinct fading muted color; consumed cells use charcoal brown. The renderer never creates an independent fire animation. The adaptive history-window label no longer assumes a fixed six hours.

The already fully read Anthropic composition and Vercel implementation sources were applied again (checksums/access details above); no native skill package/tool was installed or executed. This handoff implements the requested incremental UI and combustion interface. It does not claim the full V2 level-set physics, transport, inference, calibration or field validation is complete.


The initial V2 screenshots exposed real collision failures. The corrected label system reserves the actual control shapes (rather than the empty outer bottom-container bounds), marker circles and viewport edges, then packs fixed readable boxes into free rectangles. It never deliberately falls back to an overlapping position. Leader lines preserve geographic association. The collapsed legend and narrower layer instrument recover useful map space. On insufficient mobile/dense views, a visible count leads to the synchronized sensor list; data is not silently discarded. Numeric refreshes preserve layout stability. Manual-wind input defaults show two speed decimals and one direction decimal; provider series remain unchanged until Apply.

## Observed composition comparison and correction
On 14 November 2026 the coordinator opened both functional timeline compositions in Chrome at 1280x720 using the same saved Glendalough analytical terrain, 30 sensors, ignition, explicit dry-weather series, 12.5-hour duration and five-minute cursor. Captures: output/playwright/v2-composition-inline.png and v2-composition-split.png. Both were inspected as images. The split composition remains selected: its duration row is clearly associated with the scrubber and does not require the inline variant's nearly full-width lower rail. Mobile uses the same split hierarchy.

Actual browser review, rather than screenshot similarity, exposed overlapping callouts and a legend covering mobile wind controls. The corrected packing uses 12px values, actual obstacle bounds, leader lines and a labelled synchronized-list fallback. The reviewer independently verified all 30 initial desktop labels are visible, inside the viewport and pairwise nonoverlapping. Small screens do not attempt to fit 30 callouts into a phone viewport: the Sensor list provides every reading while the map keeps selectable objects. Root inspected output/playwright/v2-final-mobile.png (390x844) and the 51-minute combustion and five-minute rewind captures. These establish observed UI behaviour, not physical forecast accuracy.


## Compact sandbox-v4 revision — 14 November 2026

This section supersedes the previous 30-sensor default, boxed readout/leader system, permanent wind/preview stack, and split duration row. Existing saved experiments retain their sensors. A fresh experiment now starts with one combined sensor at the nearest known land cell to the prepared area centre and no ignition.

The persistent instrument set is Select / Add sensor / Fire, a small weather-summary button, collapsed Layers, and the bottom transport. Channel subsets and Enabled belong in the selected sensor's settings. Legacy profile types remain valid. Readouts are a single line directly above each sensor, with bounded smooth zoom scaling (11–15 px), and retain explicit missing, unsupported, disabled and stale states. Smoke is a relative 0–100 index, explicitly described in the marker tooltip and inspector; it is not gas concentration. Crowded lines are hidden without moving their anchor; the complete synchronized Objects list remains available.

Two small compositions continue to use the exact same prepared terrain and saved state through `?composition=strip` and `?composition=shelf`. The strip puts three tools on the left and reserves the bottom for time; the shelf places three tools immediately above the transport. The shelf is selected for this revision: only three tools remain, so the short shelf does not create the former wide profile palette and leaves the geographic left edge free. On mobile both reduce to a three-tool shelf. This is a source-level composition comparison; current-revision browser captures are the coordinator/reviewer's pending integration gate, not claimed here.

```
strip: [Layers] map                         [weather]
       [Select]     sensor — compact reading
       [Sensor]
       [Fire]       [Run rewind cursor ——— end h date speed]

shelf: [Layers] map                         [weather]
                    sensor — compact reading
                        [Select Add sensor Fire]
               [Run rewind cursor ——— end h date speed]
```

The geographic natural palette and charcoal instruments are retained. Readout geometry no longer resembles annotation cards or network connectors. End duration is an editable hours value immediately after the scrubber; Enter or blur commits without a second permanent form. The calendar chip opens a date popover: a UTC date input selects a day, and a real hourly slider scrubs that day within provider catalogue bounds. Speeds are read from the shared contract, including 150× and 300×.

Clicking empty map space opens an anchored “Simulate in this region?” confirmation. Confirm prepares that coordinate; Cancel, another action, Escape or a pan dismisses the proposal. Inspect terrain opens the same contextual inspector instead. A preparation failure leaves the previous experiment intact. The initial sensor and placement tools are usable after terrain arrives, while weather remains visibly missing/loading. Panning performs no weather request.

Weather/manual wind/demo controls now share the object inspector rather than a permanent panel. Historic start dates persist through Run, area selection and duration extension. Current unrun experiments reuse a snapshot younger than five minutes; older current weather is refreshed. Duration extension keeps manual wind and frozen historic origin. Actual source provenance is available in the weather inspector. The worker's authoritative receipt-history window and incremental observation batch are preserved; readouts use a separate bounded 30-observation cache and selected charts update at most every 250 ms during running frames.

The short-height inspector remains a bounded scrolling sheet with an independently accessible close button. Controls have explicit names, native keyboard behaviour, visible focus, and touch/numeric alternatives. Native-zoom and mobile rendering require the current browser gate after the coordinator's build.

### Integrated composition inspection, 14 November 2026

The coordinator inspected actual Chrome rendering of both compositions using the same saved Glendalough fixture and current-weather snapshot. Captures are `output/playwright/compact-composition-shelf.png` and `compact-composition-strip.png`. The shelf is retained: its three adjacent object tools keep selection/placement close to Run, while the strip separates those actions across the viewport. Both retain the full geographic canvas and compact anchored sensor line. This completes the earlier source-only comparison with browser evidence.

The coordinator also selected 1 July historical weather with the UTC date/hour picker, placed ignition, ran at300x, paused and rewound to one hour. `compact-root-historical-fire.png` records the actual compiled worker and changing readings. The first inspection exposed the desktop fire key partly beneath the transport; the integration fix places it above that bar. Speed selection now closes its menu and returns focus to its summary. Independent responsive verification follows in SANDBOX_REVIEW.md.

### Final mobile refinements
Independent browser review found two compact-width defects after the first behavioural pass: expanded Layers intercepted Zoom in at320px, and the29:00:00 elapsed label exceeded its40px cell. Layers now reserves the navigation column. The narrow transport allocates elapsed time intrinsically and keeps both29:00:00 and1000:00:00 within the row; extremely longer timestamps retain full accessible text/title with visual ellipsis. Geometry-only synthetic text checks are distinct from executed29-hour engine and12.5-hour browser simulations. Final affected results are in SANDBOX_REVIEW.md.
