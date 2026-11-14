# Reviewed design sources

Access date: 2026-11-14. These are source readings and applied guidance, not installed skill packages or executed host-specific tooling.

| Source | Reviewed revision/checksum | Use |
|---|---|---|
| [Anthropic frontend-design](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md) | SHA-256 `d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3` | Complete source read; subject-specific composition, token plan, two studies, restrained critique |
| [Vercel web-design-guidelines](https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/web-design-guidelines/SKILL.md) | Source version 1.0.0, main accessed on date above | Review procedure read |
| [Vercel interface rules](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md) | SHA-256 `d246b026f4f29b5823a9cc857f9edf3d2507002e055e32040cadeaf3b38e0234` | Implemented file review: keyboard, forms, focus, async state, responsive and reduced motion |
| [Impeccable](https://raw.githubusercontent.com/pbakaus/impeccable/main/plugin/skills/impeccable/SKILL.md) | Source version 4.9.1 | Focused reference only; Operate mode, `reference/operate.md` and `reference/distill.md` read. No context launcher, detector, hooks, critique orchestration or installed package claimed. |

The project brief overrides general marketing or title-case guidance. Study A (edge strip) is chosen; study B (shelf) is reserved for mobile. See DESIGN.md for reasoning and capture evidence in UX_REVIEW.md.

Additional source SHA-256 checksums (UTF-8 content): Vercel skill `f4647ca866a3accf763777f83e7682954f0187cd6bea7eea0399796652414e8f`; Impeccable manifest `509566635eae60cbb5ee57a60e56001f90bd415db8067f1447b6d13be0e12511`; Operate reference `a9d2203acd45ca33a13d5c68b02b23ed512425ac15f0e8438318ed124b43729d`; distill reference `a5702d46b5a17a38c555044439c2e76585848ee8c5a74b8470fa5de06aaa03f8`.

## Asset and data licensing

IBM Plex Sans: SIL Open Font License 1.1, retained alongside local font subsets. Lucide icons: ISC, distributed by npm with its licence. MapLibre: BSD-3-Clause. ECharts: Apache-2.0. Radix: MIT. TanStack: MIT. Package licences remain in installed dependency distributions and lockfile metadata. No skill source package was retained, so no incomplete package installation is represented here.

Esri World Topographic Map is an external configurable basemap; attribution remains visible in the map. Numerical land cover/elevation/weather provenance is displayed from the backend's immutable snapshot. Basemap availability does not establish numerical provider coverage. See SOURCES.md for the prepared environmental dataset and licences.

## Map runtime migration reference

Read the official [MapLibre v5-to-v6 migration guide](https://maplibre.org/maplibre-gl-js/docs/guides/v5-to-v6-migration-guide/) on2026-11-14 while upgrading to6.18.0 after the dependency audit. Applied the named module import and explicit bundled worker URL required by Vite. The worker is retained through the npm package and compiled asset, with the package licence. This is runtime documentation reading, not another installed design skill. WebGL2 is required by the upgraded map; unsupported contexts retain the sensor-list/coordinate fallback.

## Sandbox visual revision
User supplied a charcoal geographic UI reference on2026-11-14. Applied graphite panels, dark geographical base, warm fire and violet wind with the simplified simulator composition. Official Esri World Dark Gray Base service metadata was fetched at https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer?f=pjson and provider copyright retained. Actual browser review rejected CARTO dark tiles because they rendered API-key-required watermarks; those tiles were replaced, not counted as working delivery. This style change does not modify numerical terrain or weather.


## Compact sandbox-v4 instruction review — 14 November 2026

Re-read the complete official Anthropic frontend-design source at https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md and the full Vercel implementation guideline at https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md. Applied subject-specific composition, removal of duplicate visible controls, readable semantic states, keyboard/date forms, constrained overlays and source review. SHA-256 revisions reviewed earlier on the same date: Anthropic `d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3`; Vercel `d246b026f4f29b5823a9cc857f9edf3d2507002e055e32040cadeaf3b38e0234`. The full sources were read, not installed or executed as native skill tooling. Existing focused Distill guidance remains the simplification reference; no additional researched skill was activated. The user's compact interaction requirements supersede older 30-sensor and permanent-duration studies.
