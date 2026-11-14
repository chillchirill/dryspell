# Dryspell

A geographic fire and sensor simulator. The map is the workspace: choose a sensor profile, place sensors and ignitions, Run, inspect observations, pause the run and rewind independently. Simulation is the default context; Live and History use separately authenticated real telemetry.

This repository includes experimental modelling. Passing software tests does not validate wildfire forecasts. See [work status](docs/WORK_STATUS.md), [scientific assumptions](docs/MODELLING.md), [ML requirements](docs/ML.md) and [independent review](docs/INDEPENDENT_REVIEW.md) for evidence and remaining work.

## Local startup

Requirements: Node 24 and Docker with Compose. Run these commands from `webplatform/`:

```sh
npm ci
cp .env.example .env
# Set POSTGRES_PASSWORD and matching DATABASE_URL in .env.
# Set DRYSPELL_ADMIN_PASSWORD (12+ characters) in your shell, then:
npm run setup:admin
docker compose up -d --wait db
npm run db:migrate
npm run db:seed
npm run build
npm start
```

In another terminal in the same directory, run `npm run worker`. Open [localhost:4000](http://localhost:4000). The server serves compiled React and WebSocket on the same port. No Vite development server is required. In PowerShell use `Copy-Item .env.example .env`; use `$env:DRYSPELL_ADMIN_PASSWORD='your-password'` for setup. Passwords are salted scrypt hashes in the ignored server-only `config/admin.config.cjs` file.

Windows development defaults to `HOST=127.0.0.1`; PostgreSQL also binds loopback. No Windows firewall opening is needed. The local test administrator credentials created during verification are in ignored `.env.test`; they are not published in project documentation. To set your own password deliberately, set `DRYSPELL_ADMIN_PASSWORD` and run `npm run setup:admin -- --replace`, then restart the web process so it reloads the administrator configuration.

The included 5 km Glendalough sample uses a real bounded ESA WorldCover 2021/Copernicus DSM extraction. Its dry summer weather is explicitly a synthetic fixture. A separately retained live Open-Meteo response proves that adapter access was exercised; it does not turn the dry-weather scenario into an observed fire. Inspect sources and effective terrain in the map.

## Verify

`npm run typecheck` checks the complete workspace. `npx vitest run packages apps/server apps/web` runs domain/provider/unit checks; the outbox database test additionally requires `RUN_DB_TESTS=1` and a test DATABASE_URL.

For the actual full stack, create a dedicated test database, set TEST_DATABASE_URL in .env, and prepare local test credentials:

```sh
docker compose exec -T db psql -U dryspell -d postgres -c 'CREATE DATABASE dryspell_test'
npx tsx scripts/setup-local-test.ts
npm run build
# Port 4000 must be free; harness starts/stops its own web and worker processes.
npm run verify:stack
```

The setup-local-test command deliberately replaces the local administrator config and stores random test credentials in ignored `.env.test`; do not use it on production. The test harness rejects a database name without `_test`. It uses actual PostgreSQL, actual HTTP, actual worker jobs and actual WebSocket delivery. Browser captures go to `output/playwright`, failures/traces to `test-results`. Installed Chrome is used on Windows; elsewhere run `npx playwright install chromium` or set PLAYWRIGHT_CHANNEL to an installed browser.

## API and operations

See [API guide](docs/API.md), [OpenAPI](docs/openapi.yaml), [contracts/time semantics](docs/CONTRACTS.md), [architecture](docs/ARCHITECTURE.md), [data provenance](docs/SOURCES.md), [design](docs/DESIGN.md), and [UX review](docs/UX_REVIEW.md).

The telemetry entry point is `POST /api/v1/telemetry` with a separately issued Bearer device token. Register the sensor as administrator first. Missing channels remain absent; numeric zero is preserved. Device credentials cannot edit locations or write simulation observations. No files or services from the independent `../iot/` producer are used.

Ubuntu entry point: `sudo -E bash scripts/install.sh --port 4000`. See [deployment instructions and verification limits](docs/DEPLOYMENT.md). Runtime units are dryspell-db, dryspell-web and dryspell-worker; maintenance includes retention and coordinated backups. Public credentials require TLS configuration; the optional proxy keeps application HTTP/WS on4000 internally. NASA live acquisition requires FIRMS_MAP_KEY. Real training requires the georeferenced event metadata and historical shards documented in ML.md.

## New anonymous sandbox

The simplified sandbox is a separate entry while the next map/database integration is developed. It needs neither an administrator password nor PostgreSQL:

    npm run sandbox:build
    npm run sandbox:start

Open http://127.0.0.1:4001. The existing application remains on4000. See [sandbox instructions](docs/SANDBOX.md). All local listeners remain loopback-only; no firewall change is needed.
