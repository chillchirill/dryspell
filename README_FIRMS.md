# Wildfire analytics and near-real-time fire probability (NASA FIRMS + NOAA GFS)

Uses the satellite detections behind the [FIRMS Fire Map](https://firms.modaps.eosdis.nasa.gov/map/) (VIIRS 375 m, NOAA-20 and NOAA-21) and NOAA GFS weather. For **every land cell of 0.25° (~28 km)** it predicts the probability of at least one fire detection **in the next 24 hours from now**.

## Usage
```bash
pip install -r requirements.txt
# put your free FIRMS key in .env:   FIRMS_MAP_KEY=xxxxxxxx
python fire_forecast.py train                 # ~8 min: 100 days of fires + weather, trains and saves the model
python fire_forecast.py predict               # ~30 s: forecast for the next 24 h from the latest data
python fire_forecast.py predict --every 3     # near-real-time: repeat every 3 h, auto-verify old forecasts
python fire_forecast.py predict --bbox -11 35 30 60   # only Europe (W S E N)
python fire_forecast.py predict --analytics   # also refresh the 7-day analytics charts
```
Retrain occasionally (e.g. weekly) so the model follows the fire season.

## Outputs (`output/firms/`)
| File | Content |
|---|---|
| `forecast_map.html` | Interactive map: probability per cell, new-ignition layer, last-24 h detections, weather in popups |
| `forecast_latest.csv` | Every cell with p ≥ 1%: probability, risk class, new-ignition flag, weather |
| `forecast_by_country.csv` | Expected number of burning cells per country |
| `verification.csv` | Past forecasts scored against what actually burned (filled automatically) |
| `01`–`04*.png` | Analytics: daily detections, FRP map, top countries, diurnal cycle / FRP distribution |
| `05`–`08*.png` | Model evaluation, feature importance, forecast map, fire vs. weather |

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

## Results (held out: 2026-10-29 … 11-11)
| Model | ROC-AUC | PR-AUC | Brier | New-ignition ROC-AUC |
|---|---|---|---|---|
| Persistence (burned in last 24 h) | 0.755 | 0.303 | 0.041 | 0.50 |
| 7-day burn frequency | 0.889 | 0.501 | 0.028 | 0.50 |
| Boosting, fire history only | 0.957 | 0.611 | 0.026 | 0.91 |
| Boosting, fire + weather | 0.963 | 0.657 | 0.024 | 0.93 |
| **Ensemble (selected)** | **0.963** | **0.660** | **0.024** | **0.91** |

- Weather raises PR-AUC from 0.611 to 0.660. Rain in the forecast window and the temperature anomaly are the 3rd and 4th most important features.
- The probabilities are well calibrated (`05_model_evaluation.png`).
- Near active fires, the chance of burning rises from ~1% at VPD < 0.5 kPa to ~18% at VPD > 5 kPa (`08_fire_vs_weather.png`).

## Limitations
- **New ignitions far from any fire are rare and hard to predict.** They make up about 0.04% of cells per day. The model ranks them well (ROC-AUC ≈ 0.91), but their absolute probabilities stay low (≤ 15%). Fire is often started by people, and no weather model can see that.
- Some industrial heat sources that NASA does not label can still appear, e.g. small oil-field flares.
- FIRMS near-real-time data lag 1–3 h, so the forecast window starts at the newest complete hour.
- 100 days do not cover a full annual cycle. Seasonal effects will improve with longer history: `train --days 365`, which needs more RAM.
