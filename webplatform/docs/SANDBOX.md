# Anonymous sandbox

Run from the webplatform directory:

    npm run sandbox:build
    npm run sandbox:start

Open http://127.0.0.1:4001. No login, database, analysis service or firewall rule is required. The existing application on4000 and its Live/History contexts are unchanged. Run commands from this directory so the prepared data and compiled static assets resolve correctly.

The sandbox opens with an attributed Glendalough example. Pan to another location and choose **Use this area**, or open **Experiment menu → Choose another area** and enter coordinates and width. The server acquires actual ESA WorldCover and Copernicus elevation windows, plus Open-Meteo weather. Preparation keeps the current experiment until successful; Cancel, Retry and Undo are available. Current provider acquisition requires Internet access. Saved runs retain immutable terrain/weather for offline replay. This is an experimental surface-fire simulation, not a validated real-world fire forecast.

Local storage belongs to this browser/origin. Export important experiments before clearing browser data. A local saved experiment is not a server publication. Regional tiles from the other agent's map/PostgreSQL service are integrated; arbitrary-location numerical grids are now acquired directly through the platform's analytical raster adapters.

Verification commands (start the compiled sandbox first):

    npm run typecheck
    npx vitest run packages/simulation apps/sandbox
    npx playwright test --config playwright.sandbox.config.ts

Deterministic browser cases replace external weather responses with labelled fixtures while executing the actual terrain HTTP endpoint, compiled UI, IndexedDB and worker. The new-area browser journey uses actual analytical acquisition and real Open-Meteo through the compiled server. See SANDBOX_REVIEW.md for exact executed evidence and MAP_INTEGRATION.md for the completed analytical-area integration.

Open **Experiment menu → Duration in hours**, enter a positive number (for example 0.5, 12.5 or 48), and choose **Apply duration**. There is no fixed six-hour cap; inputs round to five-second ticks within JavaScript's representable UTC date range. New experiments default to six hours. Earlier thirty-minute inputs remain editable. Changing duration starts a new draft revision and preserves objects. Longer requests acquire available forecast weather; beyond its actual coverage, the last conditions are held as an explicitly labelled scenario assumption. This extension is not a weather forecast.

The engine retains a recent six-hour receipt-time window for charts and at most 512 sensor checkpoints. Rewinding reconstructs older measurements deterministically. Long uncached seeks still require computation proportional to simulated time; accepting arbitrary hours does not promise instantaneous multi-year computation.

Areas can be centered anywhere supported by the raster providers (currently ±85° latitude), with a 1–20 km width and at most 200 × 200 analytical cells. Resolution adapts from 25 m to 100 m. Missing coverage fails visibly; unsupported terrain is not replaced with invented grass or zero elevation. This is local simulation at arbitrary locations, not a single world-sized fire grid.

Map layers now use the running map service at127.0.0.1:4177 through a same-origin sandbox proxy. This optional display integration consumes that project's PostgreSQL-backed tiles; core prepared-area simulation remains browser-local and does not write to either database. For live external map layers, leave that existing service running. New prepared data is data/sandbox/environment.json; regenerate with npx tsx scripts/enrich-sandbox-terrain.ts if needed.
