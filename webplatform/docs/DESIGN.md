# Dryspell geographic workspace

Composition decision recorded before implementation, 14 November 2026. Contract 1.0.0.

The landscape is the working document. Tools sit at its edge; time is a continuous rail at the bottom. The visual identity comes from survey-style selection brackets, profile-specific field instruments and the correspondence between effective terrain, fire and time. No decorative topology or network connectors are used.

## Two composition studies

Both studies use the exact prepared environment returned by `/api/v1/environment`, with the same woodland, grass, slope, water, sensors and ignition. The development comparison route `?study=strip` / `?study=shelf` changes only placement of the same palette. It does not change data or simulation input. Captures are recorded after the backend fixture is available.

Study A, floating strip (selected):

```text
+------------------------------------------------------------+
| [Dryspell | Simulation | Scenario v1]         [Wind | Layers] |
| [Select]                                                    |
| [Sensor]                         terrain                    |
| [Fire  ]             ◇ sensor                 [Inspector]   |
| [Ground]                    △ ignition        [readings ]   |
|                            woodland / water                 |
| [Run] [Replay] [time ---------------------- cursor] [speed]  |
+------------------------------------------------------------+
```

Study B, compact shelf:

```text
+------------------------------------------------------------+
| [Dryspell | Simulation | Scenario v1]         [Wind | Layers] |
|              [Select | Sensor | Fire | Ground]               |
|                                 terrain                    |
|                     ◇ sensor                 [Inspector]   |
|                            △ ignition        [readings ]   |
|                            woodland / water                 |
| [Run] [Replay] [time ---------------------- cursor] [speed]  |
+------------------------------------------------------------+
```

A wins on desktop: placement tools stay in a predictable narrow edge, leaving the central north/south terrain corridor unobscured. B consumes useful central terrain and competes with context controls. B is retained only as the responsive mobile adaptation, where the edge strip would crowd the sheet. Neither is a separate application.

## Tokens and symbols

| Role | Value | Purpose |
|---|---|---|
| Instrument | `#263b3b` | Opaque tools and transport; readable on any map |
| Instrument raised | `#34504d` | Hover and grouped selection |
| Paper text | `#f3f5ee` | Main instrument text |
| Quiet text | `#c2d0c9` | Secondary metadata with maintained contrast |
| Selection | `#96e3e2` | Cool cyan ring/brackets, unrelated to fire |
| Heat | `#ff994d` | Temperature and active fire |
| Moisture | `#7fc6ed` | Humidity |
| Smoke | `#d2b8ef` | Smoke index |

Natural effective terrain is colored from the snapshot: woodland deep green, grass muted lime, scrub olive, water slate blue, unknown crosshatched grey. Elevation shading comes from the numerical grid. This is analytical input visualization; the provider topographic basemap supplies wider context and labels. Fire is outlined orange; burned ground is dark earth. Estimate is a fixed 0–1 yellow/orange/red ramp with a separate no-data treatment.

One self-hosted IBM Plex Sans family supplies labels, values and prose. Latin and Cyrillic subsets preserve future translation. 14 px base, 12 px secondary metadata, 16 px panel headings, 24 px selected measurement. Tabular numerals. Four-pixel spacing basis. No decorative uppercase labels or numbering.

Sensor symbols have a shared square frame and a channel glyph: cross for combined, thermometer for temperature, droplet for humidity, three rising strokes for smoke. Real devices use a solid frame, simulated devices a dashed frame. Selection adds cyan corner brackets. An ignition uses a flame in a triangular badge. Sensor names, not arbitrary decorative numbers, identify objects.

When marker hit areas overlap within 28 CSS pixels, activation opens an explicit contextual object picker. Profile/device identity and ignition time distinguish choices. This uses the single inspector region and does not add a permanent list. Direct sensor-list selection bypasses the overlap picker.

## Interaction rules

Select, place sensor, place ignition, inspect terrain and move are exclusive tool modes. Escape cancels. Object placement does not occur during a drag or control click. Numeric coordinates provide the keyboard and map-unavailable alternative. Proposed movement remains separate until Save; Cancel restores the original. Failed writes preserve the draft and offer retry. Undo creates a revision through the API.

Persistent placement stays disabled until the scenario and its matching environmental snapshot have loaded. Ready and explicitly partial datasets permit placement; preparing/unavailable states show loading guidance. Sensor fault configuration is secondary inspector content, scoped to supported measurements and saved as a new scenario revision. Core UI language is catalogued in `src/locales/en.ts` for future translation.

Administrator Run/Pause run controls authoritative execution. Replay Play/Pause, speed and seek affect this viewer only. Frame identity is checked against scenario, revision, environment and cursor before display. A seek cancels obsolete requests. Selected measurements, plots, weather and spatial overlays share that frame. Live telemetry never resets a History cursor.

Live/History satellite symbols represent coarse, time-qualified hotspot observations. The inspector presents their observation time, receipt time, nominal resolution and provider confidence, separately from fire probability. Missing satellite source access is visible; absent detections never mean confirmed no fire. Connection health is likewise labelled separately from sensor measurements and fire evidence.

## Responsive rules

Desktop: 56 px edge palette, context top-left, weather/layers top-right, inspector 360 px right, time rail bottom. Only one major inspector or list is open. Tablet: controls wrap deliberately, inspector narrows. Mobile below 640 px: profile shelf, compact context group, bottom inspector above the transport with explicit collapse/expand and Close. Primary targets are at least 44 px; readable text does not shrink to solve collisions. Safe-area insets protect transport and top controls. Map remains mounted across context/panel changes.

Quality review must verify 1440×900, 1280×800, 768×1024, 390×844, 320 px and 200% zoom. Composition targets are >=80% unobscured map closed and >=60% while inspecting on desktop. A screenshot match alone does not establish identity or correctness.

## Rendered composition decision

The coordinator compared the loaded Chrome captures `output/playwright/06-shelf-study.png` and `07-strip-study.png` on14 November2026. Both show the same prepared Glendalough snapshot, paused scenario revision, camera extent, four sensors and ignition. The edge strip remains selected: it preserves the central ridge/valley area and keeps tools in a stable edge location. The shelf is visibly more intrusive on desktop and remains the narrow-screen adaptation. This is a rendered comparison, not an unexecuted sketch claim.

Native Chrome200% zoom uses the short-height horizontal palette so every object tool stays above transport. Narrow layouts keep the inspector scrollable and recoverable through its visible Close control. The map legend and source-error notice stack above attribution. The earlier720×450 reflow capture is retained separately; actual native zoom is verified by720 CSS pixels and devicePixelRatio2 inside a1440-pixel Chrome viewport.

## Sandbox composition supersedes previous workspace styling
For the anonymous sandbox, use the user's14November dark geographic reference and the design documented in SANDBOX_DESIGN.md. Root inspected actual paired captures output/playwright/sandbox-final-shelf.png and sandbox-final-strip.png on the same restored experiment, weather snapshot and30-minute cursor. Shelf selected: readable profile labels adjacent to transport; strip takes a tall vertical region and separates placement from time. Actual mobile capture sandbox-final-mobile.png reviewed at390x844. The old platform design remains historical and separate.
