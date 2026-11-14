# UI design skills for the Dryspell map simulator

Research reviewed on 14 November 2026. This is an assessment of upstream instructions and their fit to this product, not a controlled comparison of model outputs. Popularity, repository stars, and a skill's own quality claims were not used as evidence of design quality.

## Product brief used for selection

Dryspell is a minimal geographic simulator. The physical map occupies the screen. Users choose sensor types, place them on the landscape, add fire, run time, inspect measurements, and rewind. Terrain, vegetation, water, and wind influence the numerical simulation.

The central design problem is arranging a few effective tools over real geography. A polished marketing page or a generic administration dashboard would fail this brief. The Packet Tracer analogy is limited to manipulating and running objects; it does not specify styling or any networking functionality.

## Candidate comparison

| Candidate and primary source | Useful contribution | Limitation for this project | Decision |
| --- | --- | --- | --- |
| [Anthropic frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) | Subject-specific visual choices and an explicit plan/build/critique process; challenges interchangeable compositions. | Broad guidance needs a concrete product brief and rendered review. It cannot supply domain interaction decisions by itself. | **Primary composition workflow.** Anchor it to the landscape, sensor tools, and time controls in section 7. |
| [Impeccable](https://github.com/pbakaus/impeccable/blob/main/plugin/skills/impeccable/SKILL.md) | Distinguishes task-oriented Operate surfaces from marketing; offers shaping, simplification, critique, and polish workflows. | The complete package has tooling and linked playbooks. Its full critique has orchestration/detector requirements; reading a page is not executing that workflow. | **Best focused refinement reference for this editor.** Use Operate/simplification guidance; a full invocation is an explicit alternative workflow. |
| [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/.claude/skills/ui-ux-pro-max/SKILL.md) | Searchable guidance on interactions, accessibility, charts, typography, and framework concerns. | A generated style/palette recommendation does not establish a distinctive composition. Searches require its packaged data/scripts and an available Python runtime. | **Optional targeted lookup.** Useful for touch placement, chart inspection, and form errors; do not let a generic product-category result redesign the canvas. |
| [OpenAI frontend-app-builder](https://github.com/openai/plugins/blob/main/plugins/build-web-apps/skills/frontend-app-builder/SKILL.md) | A concept-to-implementation workflow with visual references, design tokens, and fidelity checks. | Its image-generation workflow depends on tools available in the host. A generated screen is a visual reference, not functional or geographically valid output. | **Optional concept workflow in a suitably equipped ChatGPT/Codex environment.** Not required for the Ubuntu CLI implementation. |
| [Vercel web-design-guidelines](https://github.com/vercel-labs/agent-skills/blob/main/skills/web-design-guidelines/SKILL.md) | Reviews actual UI files against current interface guidelines and produces actionable findings. | It checks implementation quality rather than inventing an identity. Passing it cannot prove that a screen looks distinctive. | **Implementation review.** Use after the workspace exists, alongside browser interaction checks. |
| [Taste / design-taste-frontend](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md) | Includes browser checking and a strong visual direction for company/product websites. | The inspected version prescribes hero/section, imagery, and motion conventions. Those requirements are a poor default for a compact geographic editor. Its host-specific hooks are another portability consideration. | **Do not use as the simulator's primary workflow.** Reassess separately if a marketing website is requested. |

These are the best-fitting roles identified in this review, not a claim that one skill is universally best. In particular, tools good at landing pages should not determine this application's structure.

## Recommended sequence

Use **Anthropic for composition → focused Impeccable guidance when refinement is needed → Vercel and browser checks for the implementation**. UI UX Pro Max is available for a specific unresolved interaction question. Do not install or activate all six just to improve the chance of a good result.

The project brief is the authority. Apply skill guidance within its map-first composition, measurement semantics, accessibility, and minimal-control requirements. If a generic instruction proposes a hero, dashboard cards, photographs, or extra navigation, it does not apply to the simulator.

For the first screen:

1. Prepare one attributed terrain fixture with woodland, grassland, a slope, water, sensors, and an ignition.
2. Compare two small compositions of this same state: a floating tool strip and a compact object shelf.
3. Choose the one that makes placement, selection, and time control clear while preserving the most useful map area.
4. Record the chosen design and token roles in `docs/DESIGN.md`.
5. Build the interaction, inspect it in a browser, and correct actual problems.
6. Expand to sensor inspection, running fire, rewind, terrain inspection, and mobile using that same system.

No mandatory additional user approval is introduced. The user has already specified the primary composition. Do not generate a large concept gallery or build multiple design systems.

## Codex, ChatGPT, and Claude portability

A skill is a package of instructions and sometimes references, scripts, or assets. Sharing a SKILL.md format does not make host-specific commands, browser access, image generation, hooks, or runtime dependencies interchangeable.

| Environment | Practical use | Verify before claiming availability |
| --- | --- | --- |
| Codex CLI | Use the project's AGENTS.md and a supported agent-skill installation. Current official CLI documentation lists `.agents/skills/` for project-scoped Codex skills. | Actual installed package, discovered skill name, linked files, browser capability, and required runtimes. |
| Claude Code | Use its supported skills/plugin mechanism; official documentation supports `.claude/skills/` and invocation by skill name. | Resolve Claude-specific variables, hooks, scripts, and plugin paths in that environment. |
| ChatGPT with skills/plugins | Use a skill package exposed by that environment and its available tools. Design references can be handed to the implementation agent. | Whether the particular skill and required image/browser tools are enabled. A GitHub link in a chat does not install a plugin. |
| Chat without a skill-capable runtime | Supply a concise brief and reference instructions as context. | Treat the result as guided design assistance; do not claim native skill/tool execution. |

Platform sources: [OpenAI skills concepts](https://developers.openai.com/plugins/concepts/skills), [OpenAI CLI skill installation table](https://developers.openai.com/api/reference/cli), [Claude Code skills documentation](https://code.claude.com/docs/en/skills), and [OpenAI plugin compatibility guidance](https://developers.openai.com/plugins/guides/submit-claude-plugin).

This task researches and connects the workflow through the project documents. It does not install packages or hooks on the local or remote machine. During implementation, resolve a concrete source revision, retain the full required package and licence if installing, and record the revision/checksum. Do not copy only a manifest that references absent scripts.

## How the design avoids a default dashboard

The product's identity is functional:

- A geographic canvas extending behind the interface, with readable physical relief and effective land cover.
- A restrained object palette with recognisable sensor profiles, a useful placement preview, and consistent selection annotations.
- A contextual inspector that appears for the selected object and closes back to the map.
- One transport bar connecting visible fire progression with sensor detection times.
- A consistent relationship between the landscape the user can inspect and the numerical inputs used by the engine.

Typography and colour reinforce these decisions. They do not replace them. A dark theme alone is not an original design; neither is moving standard dashboard cards over a map.

Avoid a permanent fleet table, several open sidebars, gratuitous status badges, decorative charts, huge titles, full-page onboarding, and network-style connectors. Secondary functionality belongs in menus or contextual panels. Keep familiar zoom, play, pause, save, and close behaviour.

Use genuine geographic data for the workspace. Generated imagery may illustrate a proposed arrangement in an optional concept stage, but it must never become the production map, a fake terrain dataset, or evidence of model accuracy.

## Review and acceptance

The main plan's section 7 contains the binding acceptance criteria. Review should answer these questions with actual screen captures and working interactions:

- Is the first screen recognisably a map simulator before reading its title?
- Can the user place different sensor profiles, start fire, run, inspect, and rewind in the same workspace?
- Does each sensor actually report its supported channels from the running scenario?
- Is a useful surrounding landscape visible when an inspector opens?
- Do woodland, water, slope, and wind correspond to the engine's inputs and affect controlled scenarios as specified?
- Does hiding a visual layer leave the underlying simulation unchanged?
- Are the app's object symbols, typography, tools, charts, and time controls coherent across desktop and mobile?

Passing automated tests establishes behaviour; matching a screenshot baseline establishes visual consistency with that baseline. Neither independently proves originality. Record composition review and correct structural problems rather than repeatedly recolouring a rejected layout.

No claim is made here that a complete skill audit, application E2E run, or cross-model design comparison has already been executed.
