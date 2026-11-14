# Dryspell: fire physics, sensor observations, and inverse estimation

Research and repository review: 14 November 2026. Status: proposed design for user review; no application implementation is claimed. Companion: [implementation plan v2](../IMPLEMENTATION_PLAN_V2.md).

## 1. What exists and why the current experience misses the request

This review read `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, the current modelling/design/status documents, and the relevant application, simulation, inference, contract, weather, and sample-data files inside `webplatform/`. The running anonymous sandbox at `http://127.0.0.1:4001` was opened and its loaded first screen inspected in a browser. Following the user's additional instruction to integrate the good results in `map`, the review also read that project's current handoff, server contracts, providers and tile renderers, and inspected its loaded browser view at `http://127.0.0.1:4176`. The review did not inspect `../iot/`. Only these two new planning documents are authored by this task; no application implementation is claimed.

| Concern | Evidence in the current project | Consequence |
| --- | --- | --- |
| Two experiences | `apps/web` is the server/database application; `apps/sandbox` is the anonymous browser-worker experiment | Features in the older application do not automatically exist in the sandbox |
| Initial sensors | `apps/sandbox/src/ui/draft.ts`, `newScenario`, initializes `sensors: []` | The first screen has zero sensors, not 30 |
| Thirty-sensor limit | `App.tsx` placement and `draft.ts` import reject more than 30 | Thirty currently means a ceiling, not a useful initial arrangement |
| Reading visibility | `MapCanvas.tsx` renders sensor symbols; `ReadingChart` is in the selected inspector | Three measurements are not visible above every marker |
| Terrain | `terrainImage` draws a classified raster with nearest-neighbour resampling | It is real analytical data, but dark, difficult to distinguish, and not dissolved land-cover polygons |
| First-screen composition | Browser inspection at 1280 by 720 showed the prepared terrain as a roughly 390 by 390 central square | Most visible space is context outside the working area; this does not feel like a full-map experiment |
| Available categories | Current cover enum is grass, woodland, scrub, water, built, unknown | Forest-steppe is not explicitly represented as a mosaic; scrub is not equivalent to forest-steppe |
| Existing landscape | Sample JSON is 200 by 200 cells at 25 m: 26,561 grass, 12,634 woodland, 698 water, 52 built, 2 scrub, 53 unknown | The fixture supports several classes, but built land is tiny; it is not a balanced illustration of all requested landscapes |
| Weather | Sandbox obtains one hourly Open-Meteo series near the area centre, freezes it, and uses a 15-minute response cache | A sound starting point for deterministic replay, but not 30 independent local weather observations |
| Front propagation | `packages/simulation/src/index.ts` uses integrated travel times on a 16-neighbour grid | Wind, terrain, fuel and water already affect results; this is more than an expanding visual circle |
| Fuel physics | Most rates are explicitly empirical; `fuels.ts` has limited equivalent-dead GR1/GR2/GR3 options | A complete published live/dead fuel model and calibrated local fuel mapping do not yet exist |
| Moisture | Current rate uses an instantaneous algebraic humidity/rain adjustment | It lacks fuel-moisture memory and proper precipitation integration |
| Burning | `DEFAULT_SIMULATION_CONFIG.burnDurationSec` is 180, shared across the scenario | Grass and woodland have the same nominal burning lifetime; no evolving fuel mass drives intensity |
| Temperature | A fixed gain, normally 90 degrees, multiplies squared proximity within a configured 50 m radius | Heating is not derived from fuel consumption or a heat budget |
| Smoke | A plume-like expression uses current wind and fixed per-cell contributions | It does not retain the trajectories of already emitted smoke when wind changes; it is not mass-normalized |
| Inference | `packages/inference` contains candidate origins/times, robust weights, a no-fire hypothesis and resampling | Useful scaffolding, but the observation likelihood differs from the simulation response and is uncalibrated |
| Inference integration | The older web app has estimate layers; the sandbox has no inference workspace | The user's second workflow is missing from the main anonymous experience |

These are source findings plus a first-screen browser observation. Existing test reports were read as historical evidence; their suites were not rerun for this planning task. A previous passing browser suite does not establish that the new user requirements were met.

### The existing map should supply the geographic foundation

`../map/` already has a Leaflet geographic workspace, WorldCover 2021 land-cover tiles, RESOLVE ecological-zone polygons with levels of detail, persistent source/tile caching and editable guest sensor scenes. Its current `RUN.txt` and `public/api-config.json` identify frontend port 4176 and progressive COG API port 4180; older webplatform handoff information mentioning 4177 is stale. The configured route and working browser rendering were checked. A separate shell health request was blocked by the execution environment, so this review does not claim a health-endpoint or deployment verification.

The browser view showed a detailed Cherkasy landscape with pink cropland, red built-up areas, green trees and blue water. `server/raster-tiles.js` explicitly assigns those RGB values to WorldCover classes. They are source-class display colours, not evidence that the underlying classification is wrong. Reuse the geography and loading work; adopt a quieter application palette and reserve warning red/orange for fire and alarms. The existing ecological-zone palette in `server/ecoregions.js` is already more restrained.

The available `/api/tiles/...png` endpoints are display products. `/api/sample` is a point lookup, not a complete simulation-area export. An immutable, bounded analytical area contract is still needed; do not reconstruct fuel from PNG colours or issue 40,000 point/weather requests. Ecological regions describe broad context; an entire forest-steppe region cannot be treated as one uniform fuel bed. Water, built land, grass and woodland patches inside it retain their actual identities.

Rendered-tile cache keys and ETags currently depend on source/layer/tile identifiers. Recolouring must add a distinct style/palette version to rendered products, including legacy PNG fallback handling, while preserving raw COG byte caches and imported geography. Otherwise old pink/red tiles can remain mixed with new colours. The companion plan specifies this integration separately from the fire model.

## 2. Product interpretation

The default is an editable **Test mode**, without login, with exactly 30 combined sensors. Each has a stable marker and three persistent readings: temperature in degrees Celsius, relative humidity in percent, and smoke response index from 0 to 100. Add, drag, delete, undo, place ignition, run, pause and rewind belong to this map.

There are two uses of the same modelling system:

1. **Visible experiment:** known ignition produces a simulated front, combustion, smoke and sensor responses.
2. **Estimate from sensors:** unknown ignition/state is inferred from readings and environmental information. In a synthetic challenge, hidden truth is retained only for a later comparison; real data has no truth layer.

Three corrections are necessary for physical consistency:

- Temperature and smoke response can increase near a fire. Relative humidity usually decreases when the same air is heated. It must not be forced upward with the other two channels.
- Air humidity, fuel moisture, soil moisture, and the smoke index are different quantities. A weather API supplies neither a fuel inventory nor the device's smoke response.
- Wind transports smoke and changes the fire's spread rate. Fire does not move at wind speed. Water can block surface flame spread while smoke crosses it.

The requested fast, brief grass fire and longer-lasting, stronger woodland fire are appropriate **selected demonstration fuel conditions**, not universal properties of every grassland and forest. In particular, damp compact forest litter may spread slowly and weakly. The application must retain that distinction.

## 3. Recommended model family

| Candidate | What it explains | Fit for this project |
| --- | --- | --- |
| Expanding circle or frame-based random cellular rules | Simple animation | Insufficient directional physics, time consistency, and inverse observation modelling |
| Current time-dependent graph solver | Arrival times, barriers, changing environmental rates | Retain as a reference and migration baseline; finite-direction angular bias and observation physics need work |
| Published surface-fire spread model plus elliptical front/level set | Fuel-dependent speed, wind/slope direction, heterogeneous perimeters and merging | Recommended main model |
| Coupled three-dimensional fire/atmosphere solver | Buoyancy, plume dynamics, atmospheric feedback | Requires much richer inputs and substantially more computation; outside the first interactive implementation |
| Neural network as the principal minute-scale engine | Empirical prediction within a trained domain | Current data does not support replacing a transparent model; keep historical ML as a later, separate task |

The proposal combines Rothermel-type surface spread [R1], documented fuel profiles [R2], elliptical growth [R3], a level-set representation [R4], a fuel-consumption state inspired by SFIRE [R5], a reduced smoke-transport model informed by HYSPLIT [R6], and sequential Bayesian inference [R7, R8]. This is a proposed reduced model, not an implementation of all of FARSITE, SFIRE or HYSPLIT.

Equations below distinguish established relationships from **Dryspell design choices**. Parameters describing near-ground heat, emissions, smoke calibration, nuisance sources and sensor noise require calibration or an explicitly named synthetic profile.

## 4. Geography and state

Use a local metric coordinate system, x east and y north, with time t in seconds. Convert geographic coordinates at the boundary. Do not use degrees as metres or use geographic Web Mercator pixel lengths as physical lengths.

Keep the existing 5 km by 5 km, 25 m grid as the initial engineering benchmark. Its 40,000 cells are computational resolution, not claimed prediction accuracy. Permit a smaller selected area and a closer initial camera; numerical area size and camera framing are separate.

### Land-cover representation

| User-visible class | Analytical representation | Surface-fire treatment |
| --- | --- | --- |
| Steppe / grassland | Grass cover plus dry/live herbaceous fuel and curing state | Fine fuel can carry a fast front; residence time and loading control duration and power |
| Forest-steppe | Resolved grass/woodland patches; retained fractions where unresolved | Preserve the connectivity of grass corridors and wooded patches |
| Forest | Tree cover plus an explicit litter/understory assumption | Canopy affects wind; surface fuel determines surface fire |
| Water | Water polygons and conservative barrier mask | No local surface ignition or propagation |
| City / built land | Built polygons; separately mapped vegetated spaces when available | Buildings are outside the surface model; mapped vegetation can burn |
| Unknown | Explicit missing-data mask | No invented grass or zero elevation; uncertainty remains visible |

ESA WorldCover provides 10 m classified raster products for 2020/2021; its imagery services are not analytical fuel data [D2]. Forest-steppe is an application interpretation of a mosaic, not an original global WorldCover class. Use mapped water boundaries to preserve narrow barriers. Do not average a river away when resampling. Copernicus DEM is a surface model that can include trees and buildings [D3]; slope preprocessing must acknowledge this.

Store numerical rasters and render dissolved cover polygons derived from the same snapshot. Keep water holes and valid topology when simplifying. Never create a smooth visual bridge across a numerical barrier. The debug cell layer remains available. Fire contours come from the numerical front, not a separately animated shape.

Use one area convention for mass: the source densities in sections 8-10 are per horizontal square metre. If a supplied fuel inventory is per terrain-surface square metre, convert it using the surface/horizontal area ratio before grid integration. This area conversion is separate from the tangent-plane rate projection in section 7.

### Required variables

| Symbol | Meaning | Unit / source |
| --- | --- | --- |
| z, gradient z | Elevation and terrain gradient | m and dimensionless; elevation dataset |
| f | Surface fuel profile | Published table plus documented local mapping |
| W0,k | Initial combustible dry mass by component k | kg/m2; fuel profile/field information |
| m_k | Water mass / dry fuel mass | kg/kg; state, initialized from antecedent weather or declared assumption |
| m_x,k | Moisture of extinction | kg/kg; fuel profile |
| T_a, RH_a | Ambient temperature and relative humidity | Celsius, percent; weather |
| U10, theta_from | Wind at 10 m and meteorological direction | m/s, degrees from north; weather |
| P | Precipitation rate | mm/s after interval conversion |
| psi | Signed front field, negative inside reached area | m-like level-set quantity |
| t_a | First-arrival time | s; engine output |
| W_k(t), q_h | Remaining fuel and sensible heat release density | kg/m2, W/m2 |
| C, theta_h | Smoke concentration and effective local air-temperature excess | kg/m3, K |
| y_i | Reported channels at sensor i | Celsius, percent RH, response index |

## 5. Weather and fuel moisture have memory

Use one frozen weather field/series per run; sample it for all sensors and cells. Open-Meteo already supplies the needed ambient temperature, relative humidity, 10 m wind and precipitation [D1]. Fetching once per device every five seconds would not create finer information.

Convert meteorological wind direction to its transport vector:

\[
\mathbf u_{10}=(-U_{10}\sin\theta_{from},-U_{10}\cos\theta_{from}).
\]

A wind from the west travels east. Interpolate vector components, not compass degrees. Separate wind at flame height from smoke-transport wind: canopy shelter and plume height are different effects. If canopy data are absent, record an uncertain shelter assumption rather than describing a fixed coefficient as a measurement.

Fuel approaches an equilibrium moisture state over time [R9]. For component k, the proposed reduced state equation is:

\[
\frac{dm_k}{dt}=\frac{E_k(T_a,RH_a)-m_k}{\tau_{m,k}}
 +k_{r,k}P(t)(m_{sat,k}-m_k).
\tag{1}
\]

Here tau_m is seconds, k_r has units 1/mm, and m_sat is a fitted saturation bound. The rain term is a Dryspell approximation, not a complete fuel-hydrology model. Thin grass and fine litter exchange moisture faster than coarse woody fuel; live vegetation needs separate live-moisture/curing inputs.

For constant conditions with no rain:

\[
m_k(t+\Delta t)=E_k+[m_k(t)-E_k]e^{-\Delta t/\tau_{m,k}}.
\tag{2}
\]

For a documented initial equilibrium function, use the Van Wagner drying/wetting relationships reproduced in the fuel-moisture study [R10], with H = RH in percent and T in Celsius:

\[
100E_d=0.942H^{0.679}+0.000499e^{0.1H}
 +0.18(21.1-T)(1-e^{-0.115H}),
\]
\[
100E_w=0.618H^{0.753}+0.000454e^{0.1H}
 +0.18(21.1-T)(1-e^{-0.115H}).
\tag{3}
\]

Use E_d when m is above E_d, E_w when below E_w, and no vapour-exchange tendency between them. Apply and document the valid meteorological domain; do not extrapolate the ambient-moisture relation into flame temperatures. This borrows equilibrium relationships only; it is not the complete Canadian FWI system. Check reference numerical cases against the official system before implementation acceptance.

Initialize using a weather spin-up covering several time constants where available. Otherwise expose initial moisture as a scenario assumption. Weather-derived soil moisture must not silently replace m_k.

Open-Meteo hourly precipitation is a **preceding-hour accumulation** [D1]. Convert each total to an interval rate whose integral equals that total. Do not apply an hourly amount as if it were a fresh wetting event at every simulation step.

### The user's preference against random extinction

Do not add random on/off extinction driven by each humidity sample. Moisture changes continuously; fuel is eventually consumed.

For the default illustrative Test mode, a visible **Continuous spread** setting may floor the moisture damping at eta_min = 0.05 on otherwise burnable terrain. This is a proposed interaction default implementing the user's preference; it is explicitly a model override, not a physical constant. It never enables water/built/unknown ignition, creates new fuel, or preserves an already consumed flame. Observational inference with real data uses the physical extinction rule, without this floor. Hidden synthetic challenges disclose the same override in their public model settings if enabled.

## 6. Local spread rate: energy available versus energy needed

Rothermel's governing relationship for aligned wind and slope is [R1]:

\[
R=\frac{I_R\xi(1+\phi_w+\phi_s)}{\rho_b\epsilon Q_{ig}}.
\tag{4}
\]

I_R is reaction intensity, xi the propagating heat fraction, rho_b fuel-bed bulk density, epsilon effective heating fraction, and Q_ig pre-ignition energy per unit fuel mass. The expression has units of speed when the terms use consistent units. The original empirical coefficients use specific customary units: convert in one tested adapter and expose SI outside it.

Define the no-wind/no-slope value R0 by omitting the two directional factors. A documented dead-fuel moisture damping relation is:

\[
\eta_M(r)=1-2.59r+5.11r^2-3.52r^3,\quad r=m/m_x,\quad 0\le r<1,
\]
\[
\eta_M=0\quad\text{for }r\ge1.
\tag{5}
\]

Moisture damping is already part of reaction intensity. Do not multiply it into R twice. A full mixed-fuel implementation calculates dead/live component contributions and live extinction moisture properly. The current equivalent-dead grass approximation is insufficient to claim that full model.

For arbitrary wind and slope, use the combined directional factor [R3, R4]:

\[
\boldsymbol\Phi=\phi_w\hat{\mathbf d}_w+\phi_s\hat{\mathbf d}_{uphill},\qquad
R_h=R_0(1+\|\boldsymbol\Phi\|).
\tag{6}
\]

The head direction is Phi normalized when it is nonzero. For calm flat terrain direction is irrelevant. Use the published fuel-dependent wind and slope coefficients, including conversion to mid-flame wind, rather than a single multiplier for all vegetation. The published slope factor includes packing ratio and squared slope; the wind factor depends on fuel geometry and mid-flame wind. Published unit conversions and test examples belong in the fuel-rate adapter acceptance criteria.

For clarity, the customary-unit wind/slope relationships reproduced in the official Andrews reference [R12] are:

\[
\phi_w=C_w U_{mf}^{B_w}(\beta/\beta_{op})^{-E_{\phi}},\qquad
\phi_s=5.275\beta^{-0.3}\tan^2\alpha_s,
\]
\[
C_w=7.47e^{-0.133\sigma^{0.55}},\quad
B_w=0.02526\sigma^{0.54},\quad
E_{\phi}=0.715e^{-3.59\times10^{-4}\sigma}.
\tag{6a}
\]

Here U_mf is **ft/min**, sigma is surface-area-to-volume ratio in **ft^-1**, beta is packing ratio, beta_op its optimum, and alpha_s is slope angle. E_phi is a wind coefficient. Convert m/s to ft/min by multiplying by 60/0.3048; convert the resulting spread speed back to m/s. Store those definitions in the adapter, not as unit-free UI numbers. Wind validity limits and dynamic live/dead curing must be pinned to the selected published implementation. The API's 10 m wind still needs a documented height/shelter adjustment before it becomes U_mf.

Grass curing, loading, fuel-bed depth, particle surface-area-to-volume ratio, live/dead fractions, mineral assumptions and extinction moisture must be part of the fuel profile. A map colour alone cannot supply them. Start with a small reviewed set of grass, timber litter and timber-understory profiles from [R2], selected as assumptions for this landscape. Full forest crown combustion remains outside this surface model.

## 7. Evolving the front in space and time

The following formulation is the proposed **Dryspell mathematical construction** of an elliptical local propagation set. It combines a documented ellipse geometry [R3] with a normal-speed level-set equation; it is not a verbatim ELMFIRE implementation.

For effective mid-flame wind U_eff in **m/s**, use the FARSITE relationship:

\[
L=\operatorname{clip}\big(0.936e^{0.2566U_{eff}}+0.461e^{-0.1548U_{eff}}-0.397,1,8\big).
\tag{7}
\]

Do not use these constants with mph. Resolve effective wind by inverting the same fuel-dependent wind-factor relationship used in equation (6), including slope equivalence.

Using an ignition at the rear focus:

\[
e=\sqrt{1-L^{-2}},\quad R_b=R_h\frac{1-e}{1+e},\quad
b=\frac{R_h+R_b}{2},\quad a=\frac bL,\quad c=\frac{R_h-R_b}{2}.
\tag{8}
\]

All a, b and c are speeds. In a local terrain tangent plane, for outward unit front normal n and head direction d:

\[
V_n=c(\mathbf d\cdot\mathbf n)
 +\sqrt{b^2(\mathbf d\cdot\mathbf n)^2+a^2[1-(\mathbf d\cdot\mathbf n)^2]}.
\tag{9}
\]

This is the support function of the translated ellipse. It is the **normal speed**, not the radial distance from the ignition. Substituting a radial ellipse formula into a level-set update would be wrong. At the head V_n = R_h, at the back V_n = R_b, and with no wind/slope it becomes the circular speed R0.

On a sloping map, construct the orthonormal local terrain basis E (3 by 2), and let A (2 by 2) be its horizontal projection. For a horizontal gradient p = gradient psi, use q = transpose(A) p and the homogeneous tangent-plane Hamiltonian:

\[
H_{map}(p)=c(\mathbf d\cdot q)
 +\sqrt{b^2(\mathbf d\cdot q)^2+a^2[\|q\|^2-(\mathbf d\cdot q)^2]}.
\tag{10}
\]

This prevents mixing along-slope speed with horizontal map distance. Atmospheric wind convention and tangent-plane wind/slope conversion need explicit tests. Missing elevation must remain a declared approximation.

Advance:

Define psi as negative in the reached region and positive in unreached burnable terrain, with its zero contour at the outward front. Non-burnable masks are separate boundary conditions, not additional ignited level-set components.

\[
\frac{\partial\psi}{\partial t}+H_{map}(\nabla\psi)=0,
\qquad \text{front}=\{\psi=0\}.
\tag{11}
\]

Use an upwind Hamilton-Jacobi discretization, a stable time integrator, and a narrow band around the front. Set an explicit maximum step satisfying the solver's directional CFL bound, and end steps at weather knots, scheduled ignitions and output times. Output every five simulated seconds; animation can interpolate geometry between valid frames.

Important numerical requirements:

- Water/built masks block flux across barriers and are preserved during reinitialization and contour extraction. No diagonal or higher-order stencil shortcut across a river.
- Handle multiple fronts and merging without introducing a second fuel inventory in overlap areas.
- Store first crossing time t_a; subcell arrival/area fractions prevent a whole 25 m cell emitting all at once.
- An indefinitely stalled front must not resume from cold, exhausted fuel after a later weather change. Retain the active-combustion state and require a physical adjacent heat source or a new ignition. Do not approximate this with a grid-centre travel-time cutoff that extinguishes the same fire merely because the grid is coarser.
- Polygons for display are derived from the numerical state. Display smoothing is clipped to barriers and cannot change rates.
- Verify against constant-weather circular and elliptical analytical cases and both time and space refinement. The old graph solver is a comparator, not proof of the new solver's correctness.

## 8. Burning duration, intensity and smoke generation

First-arrival time alone says when a location was reached, not how strongly it is burning now. SFIRE demonstrates exponential fuel consumption following ignition [R5]. The proposed extension uses fast flaming and slower residual components:

\[
W_k(x,t)=\begin{cases}
W_{0,k}(x),&t<t_a(x),\\
W_{0,k}(x)e^{-(t-t_a)/\tau_{b,k}},&t\ge t_a(x).
\end{cases}
\tag{12}
\]

Then

\[
\dot m_k=-\partial_t W_k,\qquad
q_h=\sum_k H_k\chi_{h,k}\dot m_k,\qquad
q_s=\sum_k EF_k\dot m_k.
\tag{13}
\]

H is J/kg, chi_h the sensible-heat fraction, and EF emitted smoke mass per consumed dry-fuel mass. Thus q_h is W/m2 and q_s is kg/m2/s. Emission factors differ by material and combustion stage and are not supplied automatically by a spread fuel table.

Use fuel-specific tau_b and component masses. Grass can have a small, rapidly exhausted fast component; the selected woodland demonstration can have more available mass and a longer residual component. A longer burn time alone does not imply higher instantaneous power: W0/tau_b matters.

For display, distinguish unreached, actively flaming, residual heat/smouldering, and burned. Define active flame by the fast component's heat-release threshold, with threshold and units in the model profile. Never silently use the old global 180-second lifetime in either simulation or inference. Consumed mass, heat and emitted smoke must balance across grid refinements.

## 9. Smoke transport: history matters

The reduced near-ground concentration model is:

\[
\frac{\partial C}{\partial t}+\nabla\cdot(\mathbf u_s C)
=\nabla\cdot(K_s\nabla C)-\lambda_s C+\frac{f_g q_s}{H_{mix}}.
\tag{14}
\]

Here K_s is a positive diffusion tensor in m2/s, lambda_s is a removal/escape rate in 1/s, H_mix an effective mixing depth in m, and f_g an uncertain near-ground emission fraction. Plume rise and unresolved vertical transport are represented approximately through these parameters. They cannot be identified accurately from the ordinary weather API alone.

Implement a bounded Gaussian-puff approximation first, following the class of methods described by NOAA [R6], not the whole HYSPLIT system. For a puff emitted at time t_e:

\[
\dot{\boldsymbol\mu}=\mathbf u_s(\boldsymbol\mu,t),\quad
\dot M=-\lambda_s M,\quad
\dot\Sigma=J_u\Sigma+\Sigma J_u^T+2K_s.
\tag{15}
\]

J_u is the wind-field Jacobian. Under spatially uniform wind it is zero. The puff's reduced concentration contribution is:

\[
C_p(x,t)=\frac{M_p(t)}{2\pi H_{mix}\sqrt{\det\Sigma_p(t)}}
\exp\left[-\tfrac12(x-\mu_p)^T\Sigma_p^{-1}(x-\mu_p)\right].
\tag{16}
\]

Initialize a nonzero covariance based on source footprint, integrate the emission over each time interval, and sum contributions with background concentration. M starts with f_g times emitted smoke mass. A changed wind turns existing trajectories from their current positions; it does not rotate all old smoke instantly around the ignition.

Group adjacent emitters and merge distant puffs using mass, centroid and covariance conservation. Evaluate sensors directly; generate a lower-resolution display raster from the same field. Use finite-domain boundary loss and a mass ledger. Gaussian tails are not a strict finite-speed causal front: the concentration peak has travel time and detection requires a threshold. Do not describe the diffusion equation as mathematically zero everywhere before d/U.

Smoke is allowed above water and built land. The surface-fire barrier mask does not block air transport. Calm wind must still yield spreading/diffusing smoke, not a division by zero or no smoke.

## 10. Local temperature, humidity and sensor response

### Heat field

For the first reduced observation model, treat the default sensor as shielded from direct flame radiation and use an effective local air-temperature excess theta_h:

\[
\frac{\partial\theta_h}{\partial t}+\nabla\cdot(\mathbf u_h\theta_h)
=\nabla\cdot(K_h\nabla\theta_h)-\frac{\theta_h}{\tau_h}
 +\frac{f_h q_h}{\rho_{air}c_p H_h}.
\tag{17}
\]

T_air = T_a + theta_h. Equation (17) treats rho_air, c_p and effective layer depth H_h as constant reference values, so excess heat per horizontal area is proportional to theta_h. Its conservative transport form agrees with a heat-mass puff implementation; with divergence-free wind it reduces to the ordinary advective temperature equation. K_h, tau_h, f_h and H_h represent unresolved near-ground mixing and heat loss; this is a **Dryspell reduced observation approximation**, not a solved three-dimensional fire plume. A puff/Green-function implementation can share transport machinery with smoke while using separate wind, diffusion and decay parameters. Do not assume the smoke and hot-air footprints have the same size or persistence.

An unshielded hardware profile would additionally need a radiation/view-factor term and a sensor-body energy balance. Do not silently interpret sensor-body radiative heating as an equal change in air temperature or relative humidity. Near-flame calibration and validity limits remain a release requirement before real-world temperature claims.

### Humidity

If local water-vapour partial pressure is approximately unchanged:

\[
e_a=\frac{RH_a}{100}e_s(T_a),\qquad
RH^*(x,t)=100\frac{e_a}{e_s(T_{air}(x,t))}.
\tag{18}
\]

For ordinary ambient ranges, a convenient saturation approximation is [R11]:

\[
e_s(T)\simeq6.112\exp\left(\frac{17.62T}{243.12+T}\right)\text{ hPa}.
\tag{19}
\]

Use a documented saturation-pressure formulation valid over the entire supported hot-sensor range in implementation; the compact Magnus expression is not an unrestricted flame-temperature equation. Fire also emits water vapour, so constant e_a is a declared first approximation. Humidity is consequently supporting evidence, not an independent confirmation counted twice alongside temperature.

Example calculated from (19): air at 20 C and 60% RH, heated to 40 C without added vapour, has approximately 19% RH. Temperature rises while relative humidity falls.

### Smoke response and sensor lag

Convert model concentration to a device response using a declared calibration curve. A synthetic saturating profile can use:

\[
S^*(C)=100\frac{C}{C+C_{50}}.
\tag{20}
\]

C50 has the same concentration units as C. This curve is a configurable synthetic observation model, not a calibration of the user's actual hardware. The UI label is **smoke index**, not percent smoke in the air or PM2.5. A weather API cannot supply this value; initialize a declared clean-air background, or use independently sourced background aerosol evidence with its own conversion uncertainty.

For channel c on sensor i:

\[
\tau_{i,c}\frac{dy_{i,c}}{dt}=y^*_{i,c}-y_{i,c},\qquad
y_{i,c}(t+\Delta t)=y^*_{i,c}+[y_{i,c}(t)-y^*_{i,c}]e^{-\Delta t/\tau_{i,c}}.
\tag{21}
\]

The exact update applies when the target is held constant within that step. Use step integration when it varies. Add a persistent device bias and seeded temporally correlated noise. Preserve missing, saturated, out-of-range, stale, delayed and failed channels as quality states. Do not keep producing believable normal numbers after an optionally modelled heat-damage event.

### Per-sensor alerts and visible pulse

Alarm policy is separate from probability inference. Proposed synthetic defaults are temperature anomaly warning at +8 C or smoke index 20 for three consecutive five-second samples; temperature at or above 70 C is an immediate critical thermal alarm. These are product policies awaiting calibration, not universal wildfire thresholds.

Define a continuous severity score from normalized excesses of anomaly, smoke and rate of rise, with explicit warning/critical thresholds. For example, a = max(e_T, e_S, e_rate), each clipped to [0,1]. Preserve a critical absolute-temperature override. Use hysteresis and a recovery interval to prevent flicker around thresholds.

Map severity to a localized smooth ring with proposed frequency 0.5 + a Hz and increasing ring prominence. Animation frequency uses wall-clock time and never multiplies by playback speed. Severity, labels and state use the selected simulation time. Reduced-motion mode retains a static high-contrast ring and state text. Each sensor has its own state; one alarm does not make the whole network blink.

## 11. Estimating an unknown fire from observations

This is an inverse problem: several different fire states can produce similar measurements. Temperature mainly constrains nearby heat; smoke can come from a distant upwind source. Wind uncertainty, emission strength and source age can trade off. An arithmetic average of alarming sensor coordinates has no adequate physical justification.

Research demonstrates assimilating point temperature observations [R7] and using particle filters for evolving wildfire fronts [R8]. Those works motivate a method; they do not establish accuracy for Dryspell's sensors or landscape.

### State, inputs and hypotheses

Let X_t include the front, first-arrival times, remaining fuel, smoke/heat transport state and sensor response state. Let parameters theta include ignition location/time, uncertain wind correction, fuel/moisture factors, emission/mixing parameters and device bias.

This list describes sources of uncertainty, not permission to estimate every coefficient independently from 30 devices. Begin with a low-dimensional parameterization: origin/time, a shared wind correction and a few regional fuel/emission multipliers. Fix documented hardware response profiles or integrate their prior uncertainty. Do not attempt to recover a separate fuel loading, wind vector and smoke calibration for every cell; such a problem is not identifiable from this network.

The forward model is X_(t+dt) = F(X_t, environment, theta). The observation model is y_i(t) = h_i(X_t, theta) + error. Reuse the **same named observation operator** for synthetic data and candidate prediction, while permitting uncertain parameters and deliberate model mismatch in evaluation.

Inference receives sensor identities, measurement capabilities, effective-dated positions, timestamped measurements/quality, weather available at cutoff, terrain, and public model settings. It receives no ignition list, truth front, true simulation RNG seed, future generated readings, or truth-derived candidate bounds. Sharing the forward equations is legitimate; sharing the hidden answer is not.

Maintain:

- No local fire / normal background.
- Non-fire smoke or sensor-fault nuisance explanations.
- One-fire hypotheses with uncertain origins, times and parameters.
- A bounded two-fire extension when one fire cannot explain separated evidence. More complex cases must report limited model support rather than forcing one false centre.

### Candidate generation

Use several sources of proposals: a broad burnable-area prior, backward smoke trajectories over uncertain travel time, thermal neighbourhoods of anomalous sensors, and occasional new-ignition births. Do not sample only around the first alarm or discard an origin because its sensor reading was initially weak.

Backward trajectories seed possibilities; they are not a reverse physical simulation of diffusion. A non-fire smoke source outside the selected area must remain possible. Otherwise boundary smoke will be incorrectly localized to an interior fire.

If observations are used to select proposals, include the prior/proposal importance correction. Reusing those observations once more without this correction would double-count evidence.

### Sequential update

For hypothesis k:

\[
\widetilde w_k(t)\propto w_k(t^-)
\prod_{i\in\mathcal O_t}
p\big(y_i(t)\mid h_i(X_t^k,\theta_k)\big)^{\alpha_i},\qquad
w_k=\frac{\widetilde w_k}{\sum_j\widetilde w_j}.
\tag{22}
\]

For observation-driven proposals include p_prior/q_proposal in the weight. Alpha_i is a documented reliability/correlation adjustment, not permission to count duplicates. Use log weights.

A robust multivariate Student-t likelihood is suitable as an initial design:

\[
\log p(r)=\log\Gamma\left(\frac{\nu+d}{2}\right)-\log\Gamma\left(\frac\nu2\right)
-\frac d2\log(\nu\pi)-\frac12\log|\Sigma|
-\frac{\nu+d}{2}\log\left(1+\frac{r^T\Sigma^{-1}r}{\nu}\right).
\tag{23}
\]

Here r = observed minus predicted supported channels, d is their count, and Sigma covers measurement error, shared weather uncertainty and model discrepancy. Start with nu = 4 as an explicitly tunable robustness choice. Use covariance/subsets for partial channels; saturated observations need censored/tail likelihoods. The no-fire and fire hypotheses must score **the same channels with comparable normalized likelihoods**. The current code's different strength-based no-fire score and per-channel fire score must be replaced, not treated as calibrated evidence.

The product in equation (22) assumes the residual blocks are conditionally independent given the hypothesis, or deliberately tempered. Represent shared weather errors in the hypothesis parameters or use a joint cross-sensor likelihood. Adding the same unresolved weather error independently to 30 likelihoods would manufacture confidence.

Process every observation ID once, ordered by observation time, subject to availability at issue time. Model temporal correlation or use a non-overlapping assimilation interval. Repeated packets and tightly colocated sensors are not independent confirmations. A healthy non-detection reduces support only when a candidate predicts a detectable signal at that time; a failed sensor contributes no such negative evidence.

Resample when effective sample size 1/sum(w_k squared) falls below a documented fraction of N. Retain nuisance hypotheses and rejuvenate origins/times/parameters without eliminating separated plausible solutions. Add new births so the filter can recover from an incorrect initial hypothesis set. Do not create arbitrary confidence by flooring/capping every displayed cell to a reassuring fixed percentage.

### Computational starting point

Use 32-64 candidates as a benchmark starting point, not an accuracy guarantee. Screen broad candidates on a coarser grid and refine around supported regions, preserving barriers and proposal weights. Incrementally advance stored candidate states rather than recomputing every hypothesis from its ignition at every new reading. Benchmark an initial 15-second assimilation cadence and 30-minute forecast; increase domain/horizon/ensemble only with measured budgets.

Candidate count, localization resolution and weather uncertainty must be visible in diagnostics. A coarse grid cannot become a precise boundary merely because the display is vectorized.

## 12. Outputs and future prediction

Produce distinct products:

\[
P_{burning}(x,t)=\sum_k w_k\,\mathbf1[\text{active flame in }X_t^k],
\tag{24}
\]
\[
P_{reached}(x,t+\Delta)=\sum_k w_k\,\mathbf1[t_a^k(x)\le t+\Delta].
\tag{25}
\]

Origin probability is a third distribution over ignition locations/times. Origin is not the same as the current burning perimeter. Display origin credible regions conditional on local fire, together with the probability of no local fire; raw per-cell origin mass changes with resolution and should not share a misleading legend with burning probability.

Forecast by advancing the posterior states under weather forecasts and uncertainty ensembles, without using future sensor values. Include uncertain wind, fuel condition, initial state and observation-model parameters. Report arrival-time quantiles **conditional on arrival**, plus the probability of no arrival within the horizon. Distinguish model ensemble agreement from calibrated real-world probability.

Rewinding to time t must show an estimate produced with data available by t. Later-arriving measurements may produce an explicitly retrospective revised estimate; they must not silently improve an earlier operational forecast. Every frame binds environment ID, scenario revision, engine version, observation cutoff and time.

## 13. A worked interpretation

Suppose an illustrative wind transports smoke eastward at 3 m/s. A sensor 600 m downwind can encounter a plume peak after approximately 200 seconds, subject to source duration, mixing and the detection threshold. This does not mean the flame reaches it in 200 seconds. If the illustrative head-fire speed were 0.2 m/s, traversing 600 m would take about 50 minutes before terrain/fuel/weather variation.

One sensor's smoke rises with little heating: support increases for an upwind source. A second sensor's later smoke arrival narrows source location/time. A third develops a temperature anomaly: it constrains the active front locally. A healthy crosswind sensor stays normal: candidates predicting strong smoke there lose weight. The result can remain a corridor or several regions; sparse evidence does not justify a compulsory exact point.

Thirty disjoint 50 m thermal-response circles cover at most 0.236 km2. On 25 km2 that is about 0.94%, ignoring overlap and boundaries; nominal uniform spacing is about 913 m. This is a geometric illustration using the **current configured** 50 m kernel, not a physical detection guarantee. Smoke transport, placement and actual hardware sensitivity dominate coverage. The initial user journey therefore needs a visible suggested test ignition near/upwind of sensors, without secretly altering readings or moving devices to fit the result.

## 14. Verification and calibration strategy

### Mathematical and numerical checks

- Calm homogeneous front against analytic radius R0 times elapsed time.
- Constant wind against the ellipse axes, centre displacement, head/back speed and rotated-coordinate equivalent.
- Uphill, cross-slope and downhill cases with consistent local/horizontal units.
- Water barrier, narrow stream, islands, diagonal contacts and merging fronts; smoke still crosses water.
- Moisture relaxation against equation (2); conserved precipitation accumulation; dry/wet comparisons with explicit Test-mode override status.
- Fuel mass loss equals integrated heat/emissions within the declared tolerance; refinement does not multiply total smoke.
- Uniform-wind puffs match their analytic centre/covariance/mass; wind turns retain history; zero wind is stable.
- Sensor lag against equation (21), humidity heating example, saturation, missingness and individual alerts.
- Halved time step and 50/25/12.5 m grids at common physical points, plus grid rotation. Declare tolerances before collecting final evidence.

### Inference checks

- Blind hidden-fire cases with isolated input contracts and an audit of every field crossing the boundary.
- Normal weather changes, smoke without local fire, one bad sensor, delayed observations and no signal.
- Sparse networks, symmetric/ambiguous geometry, changing wind, outside-area smoke, multiple origins and multiple fires.
- Incorrect initial candidates must be recoverable through births/rejuvenation.
- Compare no assimilation, hotspot-centroid baseline, and the proposed filter on held-out scenarios.
- Measure detection delay, false-alert rate, origin error when identifiable, credible-region coverage/size, perimeter overlap, Brier score, and conditional arrival-time error/no-arrival probability.
- Use perturbed observation physics and independent reference cases, not only exact same-model synthetic recovery. Matching one's own simulator is an engineering check, not field validation.

Actual local device readings with independently documented heat/smoke sources would calibrate bias, response times, thresholds and the observation operator. Regional fire datasets can test coarse spread but do not validate exact near-sensor response. Do not expose hardware to dangerous fires as an ordinary development task.

## 15. Unresolved data and explicit boundaries

| Item | Proposed treatment |
| --- | --- |
| Actual sensor hardware calibration | Synthetic named profile until calibration metadata exists |
| Local surface fuel under a satellite tree-cover class | Published profile assumption plus uncertainty; field information can replace it |
| Fuel initial moisture and live curing | Antecedent-weather spin-up or labelled initial/seasonal assumption |
| Canopy, roughness and mid-flame wind | Dataset where available; otherwise profile-specific uncertain adjustment |
| Smoke emission/mixing/plume rise | Reduced parameters with sensitivity bounds; no air-quality accuracy claim |
| Arbitrary-area acquisition | Same immutable analytical snapshot contract; separate map-service integration remains pending |
| Crown fire, ember spotting, buildings and suppression | Later explicit models; no implied implementation |
| Stronger forest burning in the demonstration | Select a documented combustible woodland fixture; do not hardcode all forests as intense |
| Continuous spread at very high moisture | Visible Test-mode-only override; not used to claim real predictive accuracy |

## 16. Primary sources and access notes

Sources were checked on 14 November 2026. Equations and proposed architecture above are summarized or independently constructed; no source's implementation was copied into the application.

- **R1 — Rothermel, 1972.** [A Mathematical Model for Predicting Fire Spread in Wildland Fuels](https://research.fs.usda.gov/treesearch/32533). [Original report](https://www.fs.usda.gov/rm/pubs_int/int_rp115.pdf). Governing surface-spread and moisture relationships; not crown fire or spotting.
- **R2 — Scott and Burgan, 2005.** [Standard Fire Behavior Fuel Models](https://research.fs.usda.gov/treesearch/9521). [Report](https://research.fs.usda.gov/download/treesearch/9521.pdf). Fuel families and parameters. A land-cover label is insufficient to identify a unique fuel model.
- **R3 — Finney, 1998, revised 2004.** [FARSITE model development and evaluation](https://research.fs.usda.gov/download/treesearch/4617.pdf). Printed pages 6-7 document vectoring, effective mid-flame wind in m/s, ellipse ratio and head/back geometry.
- **R4 — ELMFIRE, official technical reference.** [Mathematical Background](https://elmfire.io/tech_ref.html). Practical spread/wind/front architecture. The document uses different units in different formula families; it is not permission to mix their coefficients.
- **R5 — Mandel, Beezley and Kochanski, 2011.** [Coupled atmosphere-wildland fire modeling with WRF 3.3 and SFIRE 2011](https://gmd.copernicus.org/articles/4/591/2011/gmd-4-591-2011.pdf), sections 3.3 and 3.5. Time-dependent fuel mass and heat release; the proposed two-component reduction is a Dryspell choice.
- **R6 — NOAA Air Resources Laboratory.** [HYSPLIT User's Guide overview](https://www.ready.noaa.gov/hysplitusersguide/S000.htm). Puff/particle transport, dispersion and deposition. Dryspell's reduced two-dimensional layer is not an execution of HYSPLIT.
- **R7 — Mandel et al., 2008.** [A wildland fire model with data assimilation](https://arxiv.org/abs/0709.0086). Demonstrates temperature assimilation; does not validate this project's sensor network.
- **R8 — Gu, Yan and Hu, 2009.** [State Estimation Using Particle Filters in Wildfire Spread Simulation](https://s2.smu.edu/~barr/wildfire/research/simulation/StateEstimationUsingParticleFilters-ANSS09_Final.pdf). Sequential weighted hypotheses for fire-front estimation; reported experiments are simulation experiments.
- **R9 — NWCG.** [Fire Weather: Weather and Fuel Moisture](https://www.nwcg.gov/publications/pms425-1/11-weather-and-fuel-moisture). Equilibrium and time-lag principles. Search retrieval exposed the relevant full section; direct page access returned 403 during this review.
- **R10 — Nieto, Aguado, Chuvieco and Sandholt, 2010.** [Dead fuel moisture estimation with MSG-SEVIRI data](https://www.sciencedirect.com/science/article/abs/pii/S0168192310000699). Published equilibrium drying/wetting relationships were exposed by search retrieval of the paper. The original [Van Wagner/Pickett report catalogue](https://ostrnrcan-dostrncan.canada.ca/entities/publication/29706108-2891-4e5d-a59a-a77c96bc507c) was reachable only as a shell; the older PDF URL returned 403. The [official CFFDRS repository](https://github.com/cffdrs/cffdrs_r) was verified as a future reference-check route, not installed or executed.
- **R11 — NCAR Earth Observing Laboratory, Vömel.** [Water Vapor Pressure Formulations](https://www.eol.ucar.edu/data-software/conventions-and-standards/water-vapor-pressure-formulations). Saturation relationships and units; use a formulation matching the supported temperature range.
- **R12 — Andrews, 2018.** [The Rothermel Surface Fire Spread Model and Associated Developments](https://research.fs.usda.gov/treesearch/55928). Useful implementation reference and worked relationships. The catalogue/abstract and search-exposed wind/slope equation table from the official PDF were checked. Direct whole-PDF retrieval exceeded the reader's size limit, so no claim of a complete report review is made.
- **D1 — Open-Meteo.** [Forecast API documentation](https://open-meteo.com/en/docs). Weather variables, reference heights, units and interval semantics. Weather is model data, not local fire measurements.
- **D2 — ESA WorldCover.** [Data access, product versions and attribution](https://esa-worldcover.org/en/data-access).
- **D3 — Copernicus Data Space.** [Copernicus DEM product description](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM).

The proposal is ready for product and mathematical review. It does not claim that these new equations, the 30-sensor start, polygon presentation, or blind estimation have been implemented or scientifically validated.
