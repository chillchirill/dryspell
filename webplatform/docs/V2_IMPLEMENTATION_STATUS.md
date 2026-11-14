# V2 implementation boundary

Updated 14 November 2026. This records the actual incremental delivery against `IMPLEMENTATION_PLAN_V2.md`; it is not a claim that the entire revised research programme is complete.

| Area | Implemented and evidenced | Still incomplete |
| --- | --- | --- |
| Workspace | Anonymous Test mode, one initial combined sensor, preserved saved counts, selectable measurement channels, compact map readings, inline end-hours/date controls, click-confirm regions, placement/editing, run/pause/seek, responsive list fallback | Complete map-scene migration for soil/wind/water object types and the full location-preset parity |
| Geography | Existing 4180 map tiles, natural palette with versioned URLs/cache/ETags, real bounded analytical area preparation, immutable shared inspector/engine snapshot | Dissolved analytical polygons and the full retained fractional-cover/uncertainty manifest |
| Weather | Actual Open-Meteo temperature/RH/wind/rain acquisition by location, downloaded and verified130-point hourly Ireland ERA5 archive for2026-01-01 through2026-11-08, historical UTC selection, cached remote history/current forecast, manual wind including zero, saved dry-weather demonstration, frozen replay | Antecedent fuel-moisture spin-up and moisture ODE with rain-memory validation |
| Fire | Graph baseline retained; explicit linear downwind wind response; water/built/unknown barriers; fuel-specific exponential fast/residual consumption and named heat/smoke sources | Full mixed live/dead published fuel set, level-set normal front, subcell burning and convergence acceptance for the replacement solver |
| Sensors | Source-driven local heat and retarded plume approximation, temperature-dependent RH, lag/noise/quality/capabilities, individual alarm hysteresis | Historical conserved smoke puffs and independently transported near-ground heat field; abrupt wind turns still expose the reduced plume limitation |
| Replay and resources | Versioned checkpoints, explicit old-model recomputation, deterministic rewind,144k observation budget, bounded packed frame cache, arbitrary positive-hour inputs,150x/300x pacing with complete reading batches; actual40,000-cell/1-and30-sensor benchmarks and one-sensor29h RAM retention | Dense500-object rendering performance, extreme-horizon endurance and complete future transport-state replay |
| Inference | Existing platform estimator remains separate from simulated truth | Anonymous Estimate workspace, matching observation operator, comparable nuisance/no-fire likelihoods, blind held-out evaluation and calibrated uncertainty |
| Verification | Current unit suite, actual HTTP/worker/IndexedDB browser journeys, live provider evidence, desktop/mobile/zoom review | Field/scientific validation, current isolated full PostgreSQL/WS acceptance and Ubuntu deployment |

The direct user-requested controls do not require completion of the replacement scientific solver. Conversely, passing their browser tests does not establish that solver's accuracy. Model assumptions and units are listed in `FUEL_PARAMETER_MANIFEST.md`; executed checks, failures and corrections are in `SANDBOX_REVIEW.md` and `WORK_STATUS.md`.

The next scientific dependency is moisture initialization and time evolution, followed by published reference rates and the level-set comparison gate. Historical transport and a shared forward/inverse observation operator must precede claims about anonymous unknown-fire inference. No unavailable credential is being used to explain these remaining implementation tasks.
