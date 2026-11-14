# Dryspell web platform instructions

## Scope

- Work within `webplatform/` for this application.
- Treat `../iot/` as an independent external producer. Do not inspect, modify, migrate, restart, or incorporate it. Define future communication through the platform's documented telemetry API.
- Follow `IMPLEMENTATION_PLAN.md`, including confirmed requirements and deployment boundaries.

## Product and UI priority

- The primary product is a minimal geographic simulator. Open on a full-viewport physical map with compact object tools, one contextual inspector, and bottom time controls.
- The main journey is choose sensor profile, place sensors, place ignition, run, inspect, and rewind. Preserve this journey within the map workspace.
- The Packet Tracer analogy concerns manipulating and running objects only. Do not copy its visual style or add network links, routing, packets, radio simulation, or hardware work.
- Do not produce a white dashboard page containing a map card, permanent fleet sidebars, statistic-card grids, or a marketing landing screen.
- Terrain, land cover, water, and weather must influence the actual simulation. The terrain inspector and engine share the same environmental snapshot. Display-only layer/style changes must not alter results.
- Support combined, temperature-only, humidity-only, and smoke-only simulated profiles with actual capability-aware outputs. Never turn an unsupported/missing measurement into zero.
- Preserve the real telemetry API and Live/History contexts, administrator-only persistent edits, and separation of simulation truth from inference.

## Frontend design workflow

- Before frontend implementation or a substantial revision, read section 7 of `IMPLEMENTATION_PLAN.md` and `UI_DESIGN_RESEARCH.md`.
- Use Anthropic's `frontend-design` for composition. Read the complete available package or its official source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md .
- Use the research document's phase-specific guidance: Impeccable as a focused refinement reference, Vercel web-design-guidelines for implemented UI review, and other candidates only for a concrete need. Do not activate every researched skill or mix conflicting design systems.
- Keep the explicit map-simulator brief authoritative. Skill guidance must not introduce unrelated pages, mandatory hero sections, or additional approval pauses.
- Record reviewed sources/revisions/checksums and access dates in `docs/DESIGN_REFERENCES.md`. Preserve licences for installed/retained packages. Distinguish source reading, installation, and actual tool execution.
- Compare two small canvas compositions using the same realistic terrain fixture; select one and record its tokens, symbols, and responsive rules in `docs/DESIGN.md`.
- Inspect actual browser rendering and complete the place/run/inspect/rewind journey. Apply the composition, identity, interaction, environment, and quality gates in section 7 before completion.
- A palette change, default dark theme, or passing screenshot comparison does not satisfy the distinctive-design requirement.
- Keep map, charts, weather, and estimates on the same context/revision/time. Preserve keyboard/touch alternatives and a sensor-list fallback when the map is unavailable.

## Delivery

- Keep planning and implementation documents in English.
- Produce the design references, reviewed browser captures, UX findings, and behavioural/visual checks required by the plan.
- Report what was actually implemented and verified, including incomplete provider access, training, browser checks, skill tooling, and deployment.
