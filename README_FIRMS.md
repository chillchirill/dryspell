# Wildfire analytics and near-real-time fire probability (NASA FIRMS + NOAA GFS)

Uses the satellite detections behind the [FIRMS Fire Map](https://firms.modaps.eosdis.nasa.gov/map/) (VIIRS 375 m, NOAA-20 and NOAA-21) and NOAA GFS weather. For **every land cell of 0.25° (~28 km)** it predicts the probability of at least one fire detection **in the next 24 hours from now**.

## Usage
```bash
pip install -r requirements.txt
# put your free FIRMS key in .env:   FIRMS_MAP_KEY=xxxxxxxx
python fire_forecast.py train                 # ~8 min per forecast day: 100 days of fires + weather
python fire_forecast.py predict               # ~1 min: forecast for the next 4 days (24 h steps) from the latest data
python fire_forecast.py predict --every 3     # near-real-time: repeat every 3 h, auto-verify old forecasts
python fire_forecast.py predict --bbox -11 35 30 60   # only Europe (W S E N)
python fire_forecast.py predict --analytics   # also refresh the 7-day analytics charts
python fire_forecast.py train --days 760 --step 3 --keep-frames   # two years (see below), keeps the tables for `backtest`
python fire_forecast.py backtest --tag prod   # quality by season on the saved tables
```
Retrain occasionally (e.g. weekly) so the model follows the fire season.

## Outputs (`output/firms/`)
| File | Content |
|---|---|
| `forecast_map.html` | Animated 4-day map (play button and time slider): probability per square, new-fire-area filter, last-24 h detections, weather in popups. The "Ground sensors" panel is a placeholder: sensors are stored in the browser, no live data yet |
| `forecast_latest.csv` | Every cell with p ≥ 1% on any day: probability for day 1 and `prob_day2..4`, risk class, new-ignition flag, weather |
| `forecast_by_country.csv` | Expected number of burning cells per country |
| `verification.csv` | Past forecasts scored against what actually burned (filled automatically) |
| `01`–`04*.png` | Analytics: daily detections, FRP map, top countries, diurnal cycle / FRP distribution |
| `05`–`08*.png` | Model evaluation, feature importance, forecast map, fire vs. weather |
| `seasonal_backtest.csv`, `09_*.png` | Forecast quality by season (from `backtest`) |

## How it works
1. **Fire history**: FIRMS Area API, 100 days, both VIIRS satellites. Volcanoes, gas flares, industrial and offshore heat sources are removed using NASA's `type` labels from the yearly VIIRS archive, about 7% of detections.
2. **Weather**: NOAA GFS 0.5°, read from the public AWS archive, downloading only the needed GRIB fields.
   - Forecast window: max temperature, min/mean humidity, VPD, wind, gusts, rain, soil moisture.
   - Antecedent conditions: rain over 7 and 30 days, days since rain, temperature anomaly.
3. **Features per cell** are computed from rolling 24-hour windows before the cutoff time, so they work at any hour, not only at midnight. They cover:
   - the cell's own fire history (last 24/48/72 h, 7 and 30 days, days since it last burned);
   - neighbourhood activity from 3×3 up to 25×25 cells;
   - location and season;
   - weather.
4. **Training**: 69 daily cutoffs. Every burning cell is kept; cells without fire are subsampled and re-weighted, so the probabilities match the real base rate.
5. **Validation**: the model is tested on the last 14 days, which it never saw during training. The candidates were:
   - persistence;
   - 7-day frequency;
   - gradient boosting on fire history only;
   - logistic regression;
   - gradient boosting with weather;
   - the ensemble of the last two.
   
   The best one by PR-AUC is refit on all days and saved.
6. **Predict** loads the saved model, fetches the newest detections and the newest GFS cycle, and scores all ~254,000 land cells.

## Results (held out: 2026-10-30 … 11-12, models trained on two years)
| Forecast for | PR-AUC | ROC-AUC | Brier | New-ignition ROC-AUC |
|---|---|---|---|---|
| Day 1 (next 24 h) | 0.657 | 0.965 | 0.023 | 0.923 |
| Day 2 | 0.627 | 0.961 | 0.024 | 0.931 |
| Day 3 | 0.616 | 0.960 | 0.024 | 0.940 |
| Day 4 | 0.608 | 0.958 | 0.024 | 0.943 |
| Day 4, simple rule "burned in the last 7 days" | 0.432 | 0.862 | 0.030 | 0.50 |

- Quality drops slowly with the forecast day: day 4 is still far better than the simple rule.
- Weather matters more for later days: rain and the temperature anomaly are among the top features.
- Elevation, vegetation and soil type (static GFS fields) add almost nothing on top of fire history and weather.
- Days 2-4 are trained on the weather that really happened on that day, but at forecast time they get a 2-4 day weather *forecast*. Real accuracy of the later days is therefore a bit lower; `predict` archives every day, and `verification.csv` scores each one once its day has passed.
- The probabilities are well calibrated (`05_model_evaluation.png`).
- Near active fires, the chance of burning rises from ~1% at VPD < 0.5 kPa to ~18% at VPD > 5 kPa (`08_fire_vs_weather.png`).

## Quality by season (`backtest`)
Eight 21-day blocks spread over two years. For each block a smaller model (1.5 million rows, 300 trees) is trained on the rest of the data, leaving a 30-day gap on both sides, and scored on the block. Next-24 h forecast:

| Block | PR-AUC | 7-day rule | ROC-AUC |
|---|---|---|---|
| Dec 2024 | 0.751 | 0.634 | 0.978 |
| Apr 2025 | 0.593 | 0.416 | 0.960 |
| Jul 2025 | 0.691 | 0.558 | 0.967 |
| Oct 2025 | 0.661 | 0.492 | 0.966 |
| Jan 2026 | 0.730 | 0.607 | 0.977 |
| Apr 2026 | 0.580 | 0.421 | 0.959 |
| Jul 2026 | 0.750 | 0.616 | 0.971 |
| Nov 2026 | 0.651 | 0.496 | 0.963 |

- The model beats the simple 7-day rule in every season by 0.11 to 0.18 PR-AUC.
- Spring (April) is the hardest, about 0.58-0.59: many small agricultural fires that are hard to anticipate. Winter and mid-summer, when large seasonal fires dominate, are easiest (0.73-0.75).
- The ranking of new ignitions stays stable (ROC-AUC 0.84-0.92), weakest in July 2026.
- The November block matches the main held-out test (0.651 vs 0.657), so that test is representative.

## Seasons and years (`climate`)
```bash
python fire_forecast.py climate           # ~10 min the first time (reads two years of fire files), writes output/firms/climate_map.html
python fire_forecast.py climate --reuse   # redraw from the saved monthly tables (a few seconds)
```
A second map, linked from the 4-day map, for the global picture instead of the next days:
- **Months, seasons, whole year.** Each square shows on what share of days of that month it has a fire seen by satellite, averaged over the last two complete years (24 months, so each calendar month has two observations). The months play as an animation; seasons are Dec-Feb, Mar-May, Jun-Aug, Sep-Nov.
- **Change vs the year before.** Last 12 months minus the 12 before, per square (red = more fire days, blue = fewer), plus a global chart by month and the total change.
- This is the usual pattern of the season, not a weather forecast: the weather months ahead is unknown. Two years show the yearly rhythm and a first comparison, not a climate trend. For a real trend, download more years of FIRMS data (`--days` larger, `data/climate_months.npz` is rebuilt).
- Same filters as the forecast: only vegetation fires, labelled and year-round heat sources removed, land only.

## Limitations
- **New ignitions far from any fire are rare and hard to predict.** They make up about 0.04% of cells per day. The model ranks them well (ROC-AUC ≈ 0.91), but their absolute probabilities stay low (≤ 15%). Fire is often started by people, and no weather model can see that.
- Heat sources that NASA does not label are removed only if they burn year-round (see below). Short-lived ones, e.g. a flare that ran for a few weeks, can still appear.
- FIRMS near-real-time data lag 1–3 h, so the forecast window starts at the newest complete hour.
- A 100-day training window does not cover a full annual cycle. Use the two-year training below; `backtest` shows how quality varies by season.

## Longer history (two years) and forecast days
```bash
python fire_forecast.py train --days 760 --step 3            # ~1 h with cached data (first time ~2 h: ~6 GB of fires, ~660 days of weather)
python fire_forecast.py train --days 760 --step 3 --tag y3   # same, saved as models/fire_model_y3.joblib for comparison
python fire_forecast.py train --leads 0 1                    # only the first two forecast days
```
- `--step 3` uses every third day for training; the last 14 days are always tested daily. On 100 days this costs about 0.001 PR-AUC.
- One model per forecast day (`--leads`, default 0 1 2 3). Fire history is taken at the forecast time; the weather and the target belong to the day being forecast.
- Fire history is read month by month to keep memory low. Boosting trains on at most 5 million rows (a random subset above that).
- Older data come from the FIRMS standard-quality archive (`*_SP`), recent data from near-real-time (`*_NRT`).
- Two years instead of 100 days barely change the overall score but rank new ignitions better (new-ignition ROC-AUC 0.91 → 0.93).

## Persistent heat sources
Factories, flares, power plants and landfills that NASA does not label look like fires that never stop.
With a long archive (`train --days 365` or more) the script finds them itself: a ~2 km pixel with detections in
at least 12 months and in at least 8 different calendar months is treated as a permanent source. Vegetation
cannot do that, because fire seasons last a few months and burned ground needs time to grow back.
Detections at these pixels and their direct neighbours are dropped in training and in `predict`.
The list is saved to `data/persistent_sources.npy` and rebuilt on every long training run.
