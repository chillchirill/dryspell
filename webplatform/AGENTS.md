# Dryspell web platform instructions

## Scope

- Work within `webplatform/` for this application.
- Treat `../iot/` as an independent external producer. Do not inspect, modify, migrate, restart, or incorporate it. Define future communication through the new platform's documented telemetry API.
- Follow `IMPLEMENTATION_PLAN.md`, including the confirmed requirements and deployment boundaries.

## Frontend and UX workflow

- Before frontend implementation or a substantial UI revision, read section 7 of `IMPLEMENTATION_PLAN.md` in full.
- Use Anthropic's `frontend-design` skill. Read the complete available skill; if it is not installed in the current environment, retrieve and read the official source: https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md .
- Record the reviewed source revision or checksum in `docs/DESIGN_REFERENCES.md` during implementation. Preserve the upstream licence if installing or retaining a copy. Do not claim an installation in another environment merely because the source was read here.
- Apply the skill's design and critique workflow to the product-specific requirements in section 7. The selected direction is a calm, light field-monitoring console centred on the map and sensor evidence.
- Define tokens and one representative monitoring composition before expanding the UI. Use realistic fixtures and include selected, critical, stale, empty, loading, error, and mobile states.
- Inspect actual browser rendering and complete the important user journeys. Fix visual and interaction defects before calling the frontend complete.
- Keep the same context/time in the map, charts, weather, and probability legend. Keep live monitoring, historical playback, and simulation visibly distinct.
- Meet the documented responsive, accessibility, map-interaction, chart, and editing requirements. Preserve a functional sensor-list alternative when the map is unavailable.
- Produce the design references, component states, reviewed browser captures, and UX review required by the plan. Screenshot comparisons supplement behavioural tests; they do not replace design review.

## Delivery

- Keep the planning and implementation documents in English.
- Report what was actually implemented and verified, including any incomplete provider access, model training, browser checks, or deployment work.
