# Anonymous sandbox

Run from the webplatform directory:

    npm run sandbox:build
    npm run sandbox:start

Open http://127.0.0.1:4001. No login, database, analysis service or firewall rule is required. The existing application on4000 and its Live/History contexts are unchanged. Run commands from this directory so the prepared data and compiled static assets resolve correctly.

The sandbox opens with an attributed Glendalough example and one combined sensor. Choose **Add sensor** or **Fire**, then place the object on the map. Drag an object to move it. Select a sensor and open **Sensor settings** to enable or disable individual measurement channels. Readings appear as one line above its marker; `sm` is a relative smoke index, not a gas concentration. Saved scenes keep their existing objects.

Click empty map space to see **Simulate in this region?** and confirm, or use **Experiment menu → Choose another area** for exact coordinates and width. The server acquires actual ESA WorldCover and Copernicus elevation windows, plus weather. Preparation keeps the current experiment until successful; Cancel, Retry and Undo are available. Current provider acquisition requires Internet access. Saved runs retain immutable terrain/weather for offline replay. This is an experimental surface-fire simulation, not a validated real-world fire forecast.

Local storage belongs to this browser/origin. Export important experiments before clearing browser data. A local saved experiment is not a server publication. Regional tiles from the other agent's map/PostgreSQL service are integrated; arbitrary-location numerical grids are now acquired directly through the platform's analytical raster adapters.

Verification commands (start the compiled sandbox first):

    npm run typecheck
    npx vitest run packages/simulation apps/sandbox
    npx playwright test --config playwright.sandbox.config.ts

Deterministic browser cases replace external weather responses with labelled fixtures while executing the actual terrain HTTP endpoint, compiled UI, IndexedDB and worker. The new-area browser journey uses actual analytical acquisition and real Open-Meteo through the compiled server. See SANDBOX_REVIEW.md for exact executed evidence and MAP_INTEGRATION.md for the completed analytical-area integration.

Edit the small hours field beside the bottom timeline and press Enter or leave the field. There is no separate Apply duration form or fixed six-hour cap; inputs round to five-second ticks within JavaScript's representable UTC date range. New experiments default to six hours. Changing duration starts a new draft revision and preserves objects. Available playback speeds include150x and300x. Rendering frequency does not change the five-second numerical clock. Beyond actual acquired weather coverage, the last conditions are held as an explicitly labelled scenario assumption; that extension is not a weather forecast.

Up to500 sensors can be stored; this is not a promise of smooth500-sensor rendering. Runtime observations, checkpoints and a packed frame cache remain in RAM with explicit budgets. The144,000-observation budget retains about200hours for one normally reporting sensor,6h40m for30, or23m55s for500; delayed delivery can shorten these windows. The chart reports the actual retained window. Rewinding reconstructs older measurements deterministically. Reload persists inputs and cursor, then reconstructs outputs; it does not restore RAM buffers from disk. Long uncached seeks still require computation proportional to simulated time.

Click the compact weather indicator to inspect weather and edit wind in the contextual inspector. **Use API wind** retrieves Open-Meteo conditions for the experiment's coordinates. Run reuses recently acquired current weather for up to five minutes; historical runs retain their chosen UTC origin. Panning alone never changes frozen conditions. **Manual wind** accepts speed in m/s, including zero, and direction in degrees (0 north,90 east,180 south,270 west). Applying it preserves ambient temperature/humidity/rain and objects, creates a new revision, and resets the timeline. **Use saved demo weather** is an explicit dry-weather demonstration dated1July2026, not current conditions or an automatic fallback.

The calendar control in the transport opens historical UTC date selection and an hour slider. Ireland dates inside the downloaded archive use local attributed ERA5 hourly data; other supported locations/dates use the external archive API and a persistent cache. Current weather still uses the forecast API. The catalogue reports actual local coverage and the recent historical availability gap. ERA5 is reanalysis, not station observations. Acquisition command: `npx tsx scripts/prepare-ireland-weather.ts`. See SANDBOX_WEATHER.md and the current verification report for downloaded coverage and measured requests. The provider is Open-Meteo; no WeatherAPI.com integration or credential is implied.

Engine 1.3 replaces the universal 180-second combustion lifetime with fuel-specific fast and residual consumption. Displayed flame, residual heat and source-driven sensor responses derive from this state. Old recorded engine versions reopen with their inputs preserved and a visible request to recompute. The full V2 level-set front, moisture memory, historical smoke transport and matching anonymous inference remain incomplete; see FUEL_PARAMETER_MANIFEST.md for the implemented equations and assumptions.

Areas can be centered anywhere supported by the raster providers (currently ±85° latitude), with a 1–20 km width and at most 200 × 200 analytical cells. Resolution adapts from 25 m to 100 m. Missing coverage fails visibly; unsupported terrain is not replaced with invented grass or zero elevation. This is local simulation at arbitrary locations, not a single world-sized fire grid.

Map layers use the running map service at 127.0.0.1:4180 through a same-origin sandbox proxy. Set the process environment variable MAP_API_ORIGIN to override that address. This optional display integration consumes that project's PostgreSQL-backed tiles; core prepared-area simulation remains browser-local and does not write to either database. For live external map layers, leave that existing service running. The versioned natural palette uses beige cropland and grey settlements. Prepared data is data/sandbox/environment.json; regenerate with npx tsx scripts/enrich-sandbox-terrain.ts if needed.

Long reconstruction shows progress and a Cancel reconstruction action, including while a sensor inspector is open. Cancel becomes available after worker initialization. Autosave retains the requested cursor while replay is being reconstructed, rather than saving the temporary zero-time initialization frame. Hidden reconstruction ticks compute observations without materializing unused map frames; final frame and history checksums remain unchanged.
