# Fuel and observation parameter manifest

Manifest: `dryspell-combustion-v1`. Engine: `surface-grid-1.3.2`. Reviewed 14 November 2026. This is an illustrative surface-fuel model with declared assumptions, not a calibrated fire-behaviour or air-quality prediction system.

## Implemented stage and provenance

The graph arrival solver and linear wind response remain the migration baseline. The new part implements research V2 equations (12) and (13): fast and residual fuel remaining after first arrival are exponential functions of elapsed time. Instantaneous heat and smoke sources come from their mass-loss rates. `combustionInterval` integrates mass, sensible energy and smoke analytically, allowing independent balance tests and grid-area accounting. No global 180-second lifetime controls these sources.

The exponential construction follows the model family described by [Mandel et al., 2011, sections 3.3 and 3.5](https://gmd.copernicus.org/articles/4/591/2011/gmd-4-591-2011.pdf), as specified in the project's research document. The two-component partition and every combustion time/emission coefficient below are **Dryspell assumptions**, not values extracted from that paper.

The existing GR1/GR2/GR3 aggregate loads in `fuels.ts` come from [Scott and Burgan, 2005](https://research.fs.usda.gov/download/treesearch/9521.pdf), cited there at printed pages 26–28. The adapter converts short tons/acre to kg/m² using `2000 × 0.45359237 / 4046.8564224`. Their current spread adapter remains an equivalent-dead approximation; this delivery does not add full dynamic live/dead curing or published timber-litter/understory rate models.

## Fuel mapping and component values

Values apply per square metre of horizontal analytical cell area. A tree-cover satellite class does not establish actual understory load; the woodland mapping is a deliberately selected combustible litter/understory demonstration. It does not simulate tree crowns or claim all forests burn more strongly than all grasslands.

| Profile / assignment | Total available dry fuel kg/m² | Fast fraction | Fast time constant s | Residual time constant s | Fast smoke kg/kg | Residual smoke kg/kg |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Illustrative dry grass; ordinary grass cells | `1.1 × ton-acre conversion` ≈ 0.24659 | 0.90 | 35 | 160 | 0.010 | 0.040 |
| Illustrative woodland litter/understory; woodland cells | 1.50 | 0.65 | 90 | 900 | 0.015 | 0.060 |
| Illustrative scrub; scrub cells | 0.80 | 0.75 | 60 | 450 | 0.012 | 0.050 |
| Illustrative crop residue; retained WorldCover class 40 | 0.45 | 0.85 | 45 | 240 | 0.010 | 0.040 |
| Existing `SB-GR1-equivalent-dead` override | `0.4 × ton-acre conversion` ≈ 0.08967 | 0.90 | 35 | 160 | 0.010 | 0.040 |
| Existing `SB-GR2-equivalent-dead` override | `1.1 × ton-acre conversion` ≈ 0.24659 | 0.90 | 35 | 160 | 0.010 | 0.040 |
| Existing `SB-GR3-equivalent-dead` override | `1.6 × ton-acre conversion` ≈ 0.35867 | 0.90 | 35 | 160 | 0.010 | 0.040 |

Published GR load values are source-derived. Mapping grass to the GR2-sized load, all mass partitions, all woodland/scrub/crop loads, time constants and emission factors are explicit assumptions. Unknown fuel identifiers on a known burnable cover use that cover's illustrative profile. Water, built land and unknown cover receive no fuel and block ignition and graph traversal even if their `burnable` flag is erroneous. A map colour is never an input to this mapping.

The inherited graph rate uses snapshot `spreadRateMps` (m/s) and `moisture` (kg water/kg dry fuel). These are provider/mapping assumptions, not moisture measurements supplied by a weather API. The current baseline adjusts moisture instantaneously with ambient weather; it has no drying/wetting time constant or antecedent spin-up yet. Dynamic live curing is not implemented. The inherited 10 m to mid-flame shelter factors are 0.25 for woodland and 0.4 otherwise. Linear head-wind multiplier is `1 + 0.35 × shelter × alongWindMps`; the reciprocal backing branch and final 8 m/s ceiling remain unchanged. The coefficient 0.35 has units s/m in this reduced formula and is an empirical assumption, not the full published fuel-dependent wind factor.

Both components use a chosen heat of combustion of **18,000,000 J/kg**. Sensible fractions are **0.35 fast** and **0.20 residual**. Sensible heat is therefore a declared part of total chemical energy; the model does not pretend the rest becomes measured near-ground air temperature. Smoke factors describe a synthetic emitted aerosol mass proxy, not a validated PM2.5 speciation.

For component mass `W0`, time constant `tau` and age `a ≥ 0`:

- Remaining dry fuel: `W = W0 exp(-a/tau)`, kg/m².
- Consumption: `W/tau`, kg/m²/s.
- Sensible heat: `heatJkg × sensibleFraction × W/tau`, W/m².
- Smoke: `smokeKgPerKg × W/tau`, kg/m²/s.

Emission is zero before arrival. A second overlapping front does not replenish fuel; first arrival owns the single cell inventory. Exact exponential tails remain in the source calculation even after their display intensity becomes negligible.

## Display semantics

Active flaming requires fast-component heat flux at least **500 W/m²**. Below that, a cell is residual while total sensible heat flux is at least **20 W/m²**. Both thresholds are display assumptions. Below the residual threshold it is drawn as char/burned, not asserted to have mathematically zero remaining mass.

`intensity` is current total heat flux divided by the profile's initial total heat flux, so it decreases continuously from one. `combustion` entries carry the source mass/flux and either `flaming` or `residual`. `burningCells` contains flaming cells; `burnedCells` contains reached nonflaming cells, including cells that still have an explicit residual overlay. The renderer must apply that overlay before treating every burned-cell entry as cold char.

In the selected profiles, grass is residual by 300 seconds while woodland still flames. This follows component masses and time constants, not a categorical rule that a forest always burns hotter. The current sources do not turn on and off randomly with humidity.

## Source-driven sensor approximation

`observation.ts` is an explicitly transitional local-source model. It replaces the old universal 50 m / 90 °C heat gain and unrelated smoke boost. It does **not** complete research V2's transported heat field or historical puff model.

Heat uses the current sensible source, cell area and a normalized local Gaussian with source variance `cellSizeM² / 12`. Its additional variance is `2 × heatDiffusion × heatResidence`. The temperature-excess kernel contains `heatGroundFraction × heatResidence / (airDensity × airHeatCapacity × heatLayer)`. Every coefficient therefore has a named unit and a physical interpretation, but its numerical choice is uncalibrated.

Engine1.3.1 corrects the nearly invisible nearby thermal response by changing only the three heat-coupling coefficients below. On25m cells the former sigma9.6m/cutoff38.4m produced approximately0.12C at25m from an isolated young grass source, easily lost in sensor noise. The revised sigma49.5m/cutoff198m produces a visible, smoothly decaying approach/passage/recovery curve. Relative humidity continues to follow temperature at fixed ambient vapour pressure. These are illustrative observation assumptions, not calibrated physical transport; fire arrival, fuel consumption, smoke coefficients, weather and UI are unchanged. The version increment prevents replaying old measurements under the changed thermal response without recomputation.

Engine 1.3.2 additionally distinguishes direct exposure inside a burning source cell from diffuse nearby heating. The preceding broad Gaussian diluted even a directly crossing grass front to a small temperature rise. The added local-air excess is

`contactFraction × contactResidence × interpolatedLocalHeatFlux / (airDensity × airHeatCapacity × contactLayer)`.

The sensible flux remains the same fuel-consumption source in W/m². The extra coefficient has units K/(W/m²): a chosen 0.25 source fraction, 15-second local heat-exchange residence and one-metre effective air layer. This is a quasi-steady, unresolved near-source air compartment, with the existing sensor response time applied afterward. It is **not** a measured flame temperature, direct radiation heating of the sensor body, an independently integrated heat reservoir, or calibrated real hardware exposure. The diffuse and contact source fractions sum to 0.50; neither term alters combustion or smoke. This observation approximation still does not establish a domain-wide conserved transported heat field.

Local flux is bilinearly interpolated from cell-centre source densities with weights `max(0, 1 - abs(dx)/cellWidth) × max(0, 1 - abs(dy)/cellHeight)`. Each source's contribution is zero at an adjacent cell centre, so the existing 25/50/100 m off-strip response remains unchanged on the 25 m fixture. Interior weights across neighbouring cells sum to one; there is no cell-area amplification or doubled source at a shared boundary. Unknown, unreached and nonburnable cells contribute zero. Consequently an isolated burning cell contributes half its contact term at an edge and one quarter at a corner surrounded by nonburnable cells. That smooth reduction explicitly represents unresolved partial-cell exposure; it is not a claim of a resolved subcell flame shape. It can extend by half a cell beyond a burning cell's polygon, while its footprint scales with numerical resolution.

Both local and diffuse contributions decay with the same source flux after fuel consumption. Their sum enters the unchanged −45 to 150 °C target clamp and saturation quality, and humidity continues to derive from the bounded air temperature at fixed ambient vapour pressure. Sensor lag and noise remain unchanged. Direct nominal dry-grass crossing is therefore visibly stronger without raising the distant heat field globally.

Executed controlled-fixture checks for this correction used 25 m cells, ambient 25 °C / 40% RH, and a grass strip whose front passes through the sensor cell. Calm wind produced a 98.029 °C peak at 645 seconds (8.695% RH); 4 m/s west wind produced 98.282 °C at 420 seconds (7.323% RH). The sensor's cell was flaming at both peaks. At 3,600 seconds both matched the no-fire run's reported temperature/humidity to 0.01 units. For an isolated grass cell surrounded by nonburnable cells, measured peak temperatures at centre, 6.25 m interior offset, 12.5 m edge and 12.5/12.5 m corner were respectively 90.676, 75.122, 59.517 and 43.748 °C. Boundary reduction is intentional interpolation, not universal ≥70 °C exposure everywhere inside a coarse polygon.

`npx vitest run packages/simulation/src/thermal-response.test.ts packages/simulation/src/combustion.test.ts packages/simulation/src/observation-replay.test.ts` passed 18 tests in three files. These include direct crossing/recovery/rewind, retained 25/50/100 m falloff, cell-interior and boundary weights, unchanged smoke under heat-only changes, and woodland target saturation. These synthetic numerical results do not constitute browser validation or physical calibration.

Smoke combines a local diffusive kernel with a downwind steady-plume approximation. The plume evaluates the actual fuel smoke source at retarded emission age `age - distance / windSpeed`; it does not emit before ignition. Current wind defines its direction, so an abrupt wind turn can still reorient the inferred plume. Calm wind uses the local kernel and remains well defined. Air transport is not blocked by water or buildings. These kernels are not a domain-wide conserved mass ledger; they must not be advertised as historical mass-conserving Gaussian puffs.

| Observation parameter | Value | Unit / interpretation |
| --- | ---: | --- |
| Near-ground heat fraction | 0.25 | dimensionless chosen sensible-heat fraction entering reduced layer |
| Heat residence | 60 | s |
| Heat diffusion | 20 | m²/s |
| Direct-contact heat fraction | 0.25 | dimensionless chosen sensible-heat fraction for the local source-cell air compartment |
| Direct-contact heat residence | 15 | s; quasi-steady local exchange assumption |
| Direct-contact heat layer | 1 | m; effective local layer, not measured flame height |
| Air density | 1.2 | kg/m³ reference value |
| Air specific heat | 1005 | J/(kg·K) reference value |
| Effective heat layer | 3 | m |
| Near-ground smoke fraction | 0.25 | dimensionless chosen fraction |
| Effective smoke layer | 20 | m |
| Smoke diffusion | 4 | m²/s |
| Local smoke residence | 30 | s |
| Plume removal time | 240 | s |
| Maximum evaluated plume travel | 600 | s; finite reduced-kernel budget |
| Synthetic smoke C50 | 0.000010 | kg/m³; half-scale concentration |
| Gaussian evaluation cutoff | 4 | standard deviations |
| Supported local-air target range | −45 to 150 | °C; limiting produces `saturated` quality for temperature/humidity readings |

The smoke display is `100 C / (C + C50)`, a synthetic index. It is not percent smoke in air. Existing sensor profiles retain their 15-second response time, seeded persistent bias and correlated noise. Unsupported channels are absent; dropout, delay, stuck/spike and calibration behavior remain distinct. The old `temperatureGainC`, `responseRadiusM` and `burnDurationSec` configuration fields are retained for wire compatibility but no longer control this model's observation gains or combustion lifetime.

The shared profiles use noise scales 0.5 °C, 3 percentage points RH, and 1 smoke-index point for supported channels. The deterministic recurrence is `noise = 0.82 × previous + 0.18 × signedSeededDraw × scale`; default fixed device bias is a seeded signed draw times `0.3 × scale`, unless explicit channel calibration is supplied. These are synthetic device assumptions. Alarm thresholds and wall-clock emphasis are frontend policy and do not change the source fields or sensor equations.

Humidity preserves ambient vapour partial pressure while local air warms. Below 0.01 °C it uses the Murphy–Koop liquid-water expression; from 0.01 through 150 °C it uses the IAPWS saturation-pressure expression. Coefficients, Pa/K units and the IAPWS triple-point lower bound were checked against [NCAR EOL's formulation reference](https://www.eol.ucar.edu/data-software/conventions-and-standards/water-vapor-pressure-formulations), equations 11–12, accessed 14 November 2026. Representative pressures and the 20 °C/60% → 40 °C/about-19% example are tested. This is not a radiative sensor-body model or hardware calibration.

## Replay, numerical limits and deferred V2 work

Engine version 1.3.2 and manifest identity enter checkpoint compatibility. Older engine checkpoints are rejected; saved inputs can be recomputed under the new version. Arrival time plus immutable profile parameters reconstruct fuel remaining and sources exactly, so no mutable fuel array is lost during rewind. Sensor lag/noise state remains checkpointed.

The graph front remains a baseline, not the proposed level-set solver. A zero-rate published-fuel edge stops immediately and does not wait for later dry weather to restart. No grid-centre travel-time cutoff based on combustion duration was added: that shortcut would falsely extinguish slow fronts merely because cells were coarser. Continuous subcell front history and physical cold-front extinction are still level-set-stage work.

Explicitly incomplete: continuous moisture ODE and rain wetting, full mixed live/dead fuel rates and reviewed TL/TU spread profiles, level-set/elliptical normal-speed front, subcell burning fractions, historical puffs with wind-turn trajectories and mass ledger, transported heat, independently calibrated emission/near-ground coefficients, and matching inference observation physics. The old weather-dependent graph moisture factor is still instantaneous. Source mass/heat/emission balance tests establish the new combustion accounting only; they do not validate these deferred transport or prediction requirements.
