# Deploy DrySpell on Render

Use a **Web Service with Docker**, not a Static Site. Python serves the cached
maps/calendar and runs simulations through Node. No training or FIRMS/GFS/terrain
download happens on startup. The controller receiver remains the team's separate
service; DrySpell provides a read-only WebSocket relay for HTTPS browsers.

## First deployment

1. Sign in at https://dashboard.render.com/ using GitHub.
2. Choose **New > Web Service**, connect `chillchirill/dryspell`, branch `main`.
3. Name: `dryspell` (or an available variant). Region: Frankfurt.
4. Language/runtime: **Docker**. Dockerfile: `./Dockerfile`; root directory blank.
5. Choose **Free** for this first deployment. Leave Docker Command blank.
6. Health check path: `/healthz`. No FIRMS key or `.env` is required.
7. Click **Deploy Web Service**. Wait for the service to become live, then open
   the actual `https://...onrender.com` address shown by Render.

Alternatively, **New > Blueprint** can read the included `render.yaml`, which
explicitly selects the Free plan. Confirm the resources/pricing in Render before
creating them. No database or paid disk is required.

Check the calendar, **Back to forecast**, seasons and a short Ireland simulation.
The Free service sleeps after 15 minutes without traffic and can take about a
minute to wake. Its 512 MB RAM and limited CPU may constrain long simulations;
test your presentation sequence on the deployed service. Do not assume local
performance predicts free-tier performance. Keep the local demo/video as backup.

## Controller

On HTTPS the sensor panel defaults to `wss://<your-site>/ws/telemetry`.
The gateway connects to the fixed `TELEMETRY_UPSTREAM` server setting, defaulting
to the team's `ws://51.68.199.185:2500/ws`. Change that setting in Render only if
the team's receiver changes. The browser cannot choose a proxy target or send
commands to the hardware through this relay. Readings still need a matching
deviceId and a manually placed marker. Real sensor readings do not modify ML
probabilities or the historical calendar. If hardware is off, there are no live
readings to display. The gateway-to-receiver leg currently uses plain WS.

## Domain

Get the `onrender.com` deployment working first. Then open service Settings >
Custom Domains, add `dryspell.online`, and apply the exact DNS records shown by
Render at the registrar. Render manages the HTTPS certificate. The custom domain
is optional for submission; the working Render URL is usable immediately.

## What is included

`deploy/snapshot.zip` is an allowlisted, compressed runtime snapshot, accompanied
by sizes and SHA256 checksums in `deploy/snapshot.json`. It includes prebuilt
HTML, forecast/history data, four spread exports and the matching wind cache.
Terrain/runtime modules are already under `vendor/irish_simulation`. It excludes
`.env`, credentials, `.venv`, training archives and model binaries. These are
dated demo forecasts, not an automatically updating live forecast service.

To publish newer results, rebuild the dashboard locally and then run:

```powershell
.venv\Scripts\python.exe fire_dashboard.py build
.venv\Scripts\python.exe scripts/package_hosting.py
```

Commit the changed templates/source and the two snapshot files together before
deploying. Never replace the allowlist with a recursive copy of the workspace.
Docker context uses its own allowlist so local secrets cannot enter the image.
The container restores the snapshot on startup; it does not rely on persistent
filesystem changes surviving a free-tier restart.

## Verification

The local gateway integration check uses synthetic messages only on loopback:

```powershell
.venv\Scripts\python.exe -c "import subprocess; subprocess.run(['node','deploy/check_gateway.mjs'],check=True)"
```

Docker Engine must be running to test the actual Linux container locally. Render
can build it without Docker running on the developer's laptop. A successful
local gateway test does not verify a Render deployment or its resource limits.
