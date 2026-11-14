# Sandbox weather data

The sandbox retains anonymous, local-only operation. Current weather and historical weather are separate source modes. A saved snapshot remains immutable; replay does not fetch weather again.

## Historical Ireland archive

`node node_modules/tsx/dist/cli.mjs scripts/prepare-ireland-weather.ts` downloads actual hourly ERA5 reanalysis through the public Open-Meteo historical API. ERA5 is retrospective model reconstruction, not an Irish weather-station observation network, and cannot establish fire-prediction accuracy.

The requested rectangular sample grid spans 51–55.5°N and 11–5°W at 0.5° spacing (130 points), covering the island of Ireland including Northern Ireland and surrounding sea. This is a rectangle, not a coastline mask. ERA5 native horizontal spacing is 0.25° (approximately 25 km); the downloaded sampling spacing is coarser. Elevation downscaling is disabled (`elevation=nan`), and `cell_selection=nearest` is explicit. Each point records both requested sampling coordinates and the actual returned model-grid coordinates and elevation. Local queries use the nearest downloaded sample in longitude scaled by cosine of latitude; no artificial fine-scale interpolation is claimed.

The default acquisition period is 2026-01-01 to the latest conservative complete UTC date before the documented ERA5 five-day delay. On 2026-11-14 this is **2026-11-08 23:00 UTC**. `WEATHER_START_DATE` and `WEATHER_END_DATE` can reproduce a fixed period, bounded to one year. Two coordinates per request, a 1.5-second inter-batch delay, and four bounded attempts limit acquisition load. A request preserves all five channels for every hour; missing values or discontinuous timestamps fail acquisition. Re-running resumes files only when their checksum and manifest period match.

`data/weather/ireland-era5/manifest.json` is the authoritative completion record. During download it says `loading`, with only completed points listed. Each gzip point file stores five numerical columns with an implicit UTC hourly origin. The manifest preserves per-file SHA-256, size, count, provider URL and retrieval time. Only a complete manifest is advertised as ready. `data/weather/verification.json`, when present, records actual full-file validation, rather than promised coverage.

## API and time semantics

- `GET /api/sandbox/weather/catalog`: provider earliest date, conservative latest historical start, one-hour step and actual local archive status/coverage/count.
- `GET /api/sandbox/weather?latitude=53&longitude=-8&startTime=2026-06-01T00:00:00Z&durationSec=21600`: uses local historical data inside its region and period; otherwise obtains ERA5 globally from Open-Meteo.
- `GET /api/sandbox/weather?...&startTime=<current UTC time>`: retains the current forecast provider. `refresh=1` explicitly bypasses resolved caches, but shares an identical request already in flight.
- Area preparation accepts the requested historical UTC origin and reuses its separately cached numerical terrain.

Temperatures are Celsius, relative humidity percent, wind speed metres per second, wind direction meteorological *from* degrees, and precipitation millimetres accumulated over the preceding hour. Zero stays zero; unsupported or missing values are never converted to zero. Samples use seconds relative to the selected origin, including the preceding hourly sample for an origin between hours. `issuedAt` means retrieval availability, not an invented model issue time.

Dates before 1940, future starts beyond one hour, and the recent historical archive gap receive explicit errors. The recent gap is not silently replaced by current forecast conditions. Local history can use its full downloaded coverage. Remote historical requests are bounded to 31 calendar days. Current forecast acquisition is bounded to 384 hours. An arbitrarily long simulation therefore retains bounded weather arrays; after the last acquired sample, an explicitly labelled hold-last scenario assumption extends to the requested end. This tail is neither observed/reconstructed history nor an actual forecast. Provenance gives the acquired coverage end, extension policy, source mode, requested/source coordinates and spatial method.

## Cache and startup

A lazy manifest index and twelve-point RAM LRU avoid reading the whole archive at startup. Gzip checksums, hourly origin/count and finite columns are validated before local data is used. A corrupt local archive fails visibly. Current and remote historical responses have a separate checksummed persistent cache, exact in-flight deduplication and a 32-response RAM LRU. Current entries expire after 15 minutes; historical remote entries after 30 days. Cache files are pruned after writes to at most 128 entries / 64 MiB. Expired current data is never returned as fresh weather. The dataset and caches require no PostgreSQL or additional service.

## Attribution and access conditions

Primary sources read on 2026-11-14:

- [Open-Meteo historical API](https://open-meteo.com/en/docs/historical-weather-api): ERA5 resolution, hourly variables, delay, multiple coordinates, nearest-cell and elevation parameters.
- [Open-Meteo forecast API](https://open-meteo.com/en/docs): forecast horizon and units.
- [Open-Meteo terms](https://open-meteo.com/en/terms): attribution and free hosted API limits.

Attribution: **ERA5 reanalysis (Copernicus Climate Change Service / ECMWF), distributed by Open-Meteo.com; CC BY 4.0**. The free hosted endpoint is for non-commercial use and imposes request limits (including weighted requests for long periods). Commercial hosted use requires an appropriate Open-Meteo arrangement. No private credential is used by this acquisition.

Unit tests use explicitly synthetic provider responses and miniature archive fixtures in ignored `data/weather/.tests/`. They validate API interpretation and failure handling, not scientific accuracy. Full-stack HTTP timing and actual browser verification are recorded by the coordinator after rebuilding the sandbox.

## Executed acquisition and HTTP verification

On14November2026 the download completed all130points, each with7,488hourly rows, covering1January through8November2026 23:00UTC. Total compressed size is4,807,965bytes. The coordinator verified every SHA-256 and all five hourly numeric columns against the manifest, then exercised the compiled localhost4001catalogue/weather routes. Local readings matched raw archive values; a1,000-hour local request used available history without a31-day artificial cutoff. Outside-Ireland historical and current forecast requests also succeeded. One earlier outside-Ireland request timed out before the successful retry; provider availability remains external.

`node node_modules/tsx/dist/cli.mjs scripts/verify-sandbox-v4.ts` writes `docs/evidence/sandbox-v4-weather.json`. It tests actual HTTP and downloaded files without intercepting provider responses. Repeated requests may use the documented caches. Observed warm local response times were21ms and9ms; the first successful remote historical request took2,647ms and current forecast11,092ms before warm cache hits. These are measured individual requests, not throughput or latency guarantees.
