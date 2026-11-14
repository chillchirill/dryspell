r"""Cache-based FIRMS fire-spread direction prototype (CSV + metrics only).

Usage: .venv\Scripts\python.exe fire_spread.py active | scenario | backtest
Forecasts and backtests use cached inputs only. Terrain downloads require explicit approval.
Use evaluate to refit/re-score output/spread/backtest_clusters.csv without recomputing clusters.
Training uses the first 70 source days; later days are held out. The real-fire
filter (n_points >= 20 and n_new >= 10) is an evaluation cohort, not a predictor.

Spread distances are uncalibrated head-fire path lengths, not burned areas.
At each six-hour interval we use the mean of its endpoint U/V vectors.
10 m wind is reduced by a configurable 0.4 midflame factor. Anderson (1983),
with the FARSITE zero-wind correction, defines the ellipse length/breadth:
  LB = clip(0.936 exp(0.1147 W_mph) + 0.461 exp(-0.0692 W_mph)-0.397, 1, 8).
Source: https://elmfire.io/tech_ref.html (Directional Rate of Spread).
The empirical ROS used HERE is a hackathon assumption, not Anderson's ROS:
  base_kmh = 0.05 * (0.2 + 0.8*(1-RH/100)) * (1+min(dry_days,30)/30)
  head_kmh = base_kmh * (1 + 0.6*midflame_ms).
With ignition at the rear focus, a=head/(1+eccentricity), b=a/LB, c=a*e.
The ellipse radius at angle theta to the head is a*(1-e^2)/(1-e*cos(theta)).
Changing wind directions are integrated as six-hour elliptical increments;
the one reported bearing is the 24h time-mean U/V bearing (wind blows TO).

Backtest: cluster each full UTC day D, issue at D+1 00Z using the training
window for D+1 (cycle D 12Z). Target D+1 detections must be >0.75 km from ALL
D detections, then are assigned to their nearest D cluster within 10 km.
Require >=3 new detections and >=0.75 km centroid displacement. Match the
nearest D-1 cluster within 10 km for persistence, using its already observed
D-1 -> new D bearing. Report model error on the same persistence subset too.
This is a hotspot-progression proxy, not a verified fire-perimeter backtest:
independent ignitions, satellite sampling and cloud gaps may affect matches.
No future detections enter a prediction or a persistence baseline.
"""
from __future__ import annotations

import argparse
import json
import hashlib
from collections import Counter
from pathlib import Path
import time

import numpy as np
import pandas as pd
from scipy.ndimage import map_coordinates
from scipy.spatial import cKDTree
from scipy.optimize import differential_evolution
from sklearn.cluster import DBSCAN

import gfs_weather as gw

ROOT = Path(__file__).resolve().parent
EARTH_KM = 6371.0088
COLUMNS = ["cluster_id", "lat", "lon", "n_points", "frp_sum", "wind_speed_ms",
           "bearing_deg", "spread_km_6h", "spread_km_12h", "spread_km_24h", "source"]
BACKTEST_COLUMNS = ["day", "cluster_id", "lat", "lon", "n_points", "n_new",
                    "observed_distance_km", "wind_speed_ms", "bearing_deg",
                    "observed_bearing_deg", "model_error_deg", "persistence_bearing_deg",
                    "persistence_error_deg", "wind_bin"]


def read_detections(raw: Path) -> pd.DataFrame:
    """Read complete cached VIIRS CSVs; never call FIRMS or load credentials."""
    paths = sorted(p for p in raw.glob("*.csv") if "VIIRS" in p.name.upper())
    if not paths:
        raise FileNotFoundError(f"No complete VIIRS CSVs in {raw}")
    frames = []
    wanted = {"latitude", "longitude", "acq_date", "acq_time", "satellite",
              "frp", "confidence", "instrument", "type"}
    for count, path in enumerate(paths, 1):
        frame = pd.read_csv(path, usecols=lambda c: c in wanted,
                            dtype={"latitude": "float32", "longitude": "float32",
                                   "frp": "float32", "satellite": "category"})
        valid = frame["confidence"].astype(str).str.lower().isin(["n", "h", "nominal", "high"])
        if "instrument" in frame:
            valid &= frame["instrument"].astype(str).str.upper().eq("VIIRS")
        if "type" in frame:
            valid &= frame["type"].eq(0)
        frame = frame.loc[valid].copy()
        hhmm = pd.to_numeric(frame["acq_time"], errors="coerce")
        frame["time"] = (pd.to_datetime(frame["acq_date"], errors="coerce")
                         + pd.to_timedelta((hhmm // 100) * 60 + hhmm % 100, unit="m"))
        valid = (hhmm.between(0, 2359) & (hhmm % 100 < 60)
                 & frame["latitude"].between(-90, 90) & frame["longitude"].between(-180, 180)
                 & frame["time"].notna() & np.isfinite(frame["frp"]) & (frame["frp"] >= 0))
        frame = frame.loc[valid, ["latitude", "longitude", "time", "satellite", "frp"]]
        frame = frame.rename(columns={"latitude": "lat", "longitude": "lon"})
        frame["satellite"] = frame["satellite"].astype(str)
        frames.append(frame)
        if count % 10 == 0 or count == len(paths):
            print(f"  FIRMS cache {count}/{len(paths)} files", flush=True)
    result = pd.concat(frames, ignore_index=True).drop_duplicates(["lat", "lon", "time", "satellite"])
    result = result.drop(columns="satellite").sort_values("time").reset_index(drop=True)
    if result.empty:
        raise ValueError("No valid nominal/high-confidence VIIRS detections")
    print(f"FIRMS: {len(result):,} detections; {result.time.min()} .. {result.time.max()} UTC", flush=True)
    return result


def spherical_mean(lat, lon):
    lat, lon = np.radians(lat), np.radians(lon)
    x, y, z = np.mean(np.cos(lat) * np.cos(lon)), np.mean(np.cos(lat) * np.sin(lon)), np.mean(np.sin(lat))
    return float(np.degrees(np.arctan2(z, np.hypot(x, y)))), float(np.degrees(np.arctan2(y, x)))


def clusters(points, eps_km=2.0, min_samples=5):
    columns = ["cluster_id", "lat", "lon", "n_points", "frp_sum"]
    if points.empty:
        return pd.DataFrame(columns=columns)
    labels = DBSCAN(eps=eps_km / EARTH_KM, min_samples=min_samples,
                    metric="haversine", algorithm="ball_tree", n_jobs=1).fit_predict(
                        np.radians(points[["lat", "lon"]].to_numpy(dtype=float)))
    rows = []
    for label, group in points.assign(cluster_id=labels).groupby("cluster_id", sort=True):
        if label == -1:
            continue
        lat, lon = spherical_mean(group.lat.to_numpy(), group.lon.to_numpy())
        rows.append((int(label), lat, lon, len(group), float(group.frp.sum())))
    return pd.DataFrame(rows, columns=columns)


def sample_grid(grid, lat, lon):
    """Bilinear global grid interpolation, wrapping the longitude seam."""
    grid = np.asarray(grid, dtype=float)
    if grid.shape != (361, 720):
        raise ValueError(f"Expected (361,720) GFS grid, got {grid.shape}")
    coords = [(90 - np.asarray(lat, dtype=float)) / gw.RES_DEG,
              (np.asarray(lon, dtype=float) % 360) / gw.RES_DEG]
    return map_coordinates(np.concatenate([grid, grid[:, :1]], axis=1), coords,
                           order=1, mode="nearest")


def wind_at_points(uv, points):
    return {k: np.stack([sample_grid(grid, points.lat, points.lon) for grid in uv[k]])
            for k in ("u", "v")}


def wind_summary(sampled):
    # Five endpoints spanning 24h: trapezoidal time-average; do not average angles.
    intervals = {k: (sampled[k][:-1] + sampled[k][1:]) / 2 for k in ("u", "v")}
    u, v = intervals["u"].mean(axis=0), intervals["v"].mean(axis=0)
    bearing = np.degrees(np.arctan2(u, v)) % 360
    bearing = np.where(np.hypot(u, v) >= 0.1, bearing, np.nan)
    speed = np.hypot(intervals["u"], intervals["v"]).mean(axis=0)
    return speed, bearing, intervals


def ellipse_rates(speed_ms, rhmin_pct, days_since_rain, midflame_factor=0.4):
    midflame = np.maximum(0, speed_ms) * midflame_factor
    mph = midflame / 0.44704
    lb = np.clip(0.936 * np.exp(np.minimum(0.1147 * mph, 50))
                 + 0.461 * np.exp(-0.0692 * mph) - 0.397, 1, 8)
    eccentricity = np.sqrt(1 - 1 / lb**2)
    dryness = (0.2 + 0.8 * (1 - np.clip(rhmin_pct, 0, 100) / 100)) * (
        1 + np.clip(days_since_rain, 0, 30) / 30)
    head = 0.05 * dryness * (1 + 0.6 * midflame)
    a = head / (1 + eccentricity)
    return {"head": head, "a": a, "b": a / lb, "c": a * eccentricity, "lb": lb,
            "eccentricity": eccentricity}


def ellipse_radius(rates, angle_deg):
    """Radial spread km/h from rear focus, at an angle to the wind TO bearing."""
    e = rates["eccentricity"]
    return rates["a"] * (1 - e**2) / (1 - e * np.cos(np.radians(angle_deg)))


def predict(points, uv, rh, dry_days, source, midflame_factor=0.4):
    result = points.copy()
    if result.empty:
        return pd.DataFrame(columns=COLUMNS)
    sampled = wind_at_points(uv, points)
    speed, bearing, intervals = wind_summary(sampled)
    rates = ellipse_rates(np.hypot(intervals["u"], intervals["v"]),
                          np.asarray(rh)[None, :], np.asarray(dry_days)[None, :], midflame_factor)
    distances = np.cumsum(6 * ellipse_radius(rates, 0), axis=0)
    result["wind_speed_ms"], result["bearing_deg"] = speed, bearing
    for hours, i in [(6, 0), (12, 1), (24, 3)]:
        result[f"spread_km_{hours}h"] = distances[i]
    result["source"] = source
    return result[COLUMNS]


def load_daily_uv(day, cache):
    path = cache / f"uv_day_{day:%Y%m%d}.npz"
    with np.load(path, allow_pickle=False) as z:
        fields = {k: z[k].astype(np.float32) for k in ("u", "v")}
    if any(a.shape != (5, 361, 720) or not np.isfinite(a).all() for a in fields.values()):
        raise ValueError(f"Invalid U/V cache: {path.name}")
    return fields


def active_dryness(points, tau, cache):
    # Use the latest COMPLETE cached daily weather before the issue time.
    candidates = []
    for path in cache.glob("gfs_day_*.npz"):
        day = pd.to_datetime(path.stem[-8:], format="%Y%m%d")
        if day < tau.normalize():
            candidates.append((day, path))
    if not candidates:
        raise FileNotFoundError("No cached prior-day weather for active-fire dryness")
    day, path = max(candidates)
    if tau.normalize() - day > pd.Timedelta(days=1):
        raise FileNotFoundError("Latest cached daily dryness is more than one day old")
    # A missing antecedent day cannot silently count as a rain-free day.
    prior = pd.date_range(tau.normalize() - pd.Timedelta(days=30), tau.normalize() - pd.Timedelta(days=1))
    missing = [d for d in prior if not (cache / f"gfs_day_{d:%Y%m%d}.npz").exists()]
    if missing:
        raise FileNotFoundError(f"Missing {len(missing)} daily caches for active dryness; no download permitted")
    with np.load(path, allow_pickle=False) as z:
        rh = sample_grid(z["rhmin"], points.lat, points.lon)
    past = gw.DailyWeather(cache).antecedent(tau.normalize(), 30)
    dry_days = sample_grid(past["days_since_rain"], points.lat, points.lon)
    print(f"Active dryness: RH minimum from cached {day:%Y-%m-%d} (prior-day proxy); "
          "days-since-rain from preceding 30 cached days.", flush=True)
    return rh, dry_days


def read_scenarios(path):
    if not path.exists():
        raise FileNotFoundError(f"Missing scenario input: {path}")
    forecast = pd.read_csv(path)
    required = {"lat", "lon", "probability", "new_ignition", "rhmin_pct", "days_since_rain", "valid_from_utc"}
    if not required.issubset(forecast.columns):
        raise ValueError(f"Forecast missing columns: {sorted(required - set(forecast.columns))}")
    flag = forecast.new_ignition.astype(str).str.strip().str.lower()
    if not flag.isin(["true", "false"]).all():
        raise ValueError("new_ignition must be True or False")
    chosen = forecast.loc[flag.eq("true")].sort_values(
        ["probability", "lat", "lon"], ascending=[False, True, True]).head(50).copy()
    if chosen.empty:
        raise ValueError("No new_ignition=True cells in forecast_latest.csv")
    if not np.isfinite(chosen[["lat", "lon", "probability", "rhmin_pct", "days_since_rain"]]).all().all():
        raise ValueError("Non-finite scenario inputs")
    if chosen.valid_from_utc.nunique() != 1:
        raise ValueError("Scenario rows have different forecast issue times")
    tau = pd.Timestamp(chosen.valid_from_utc.iloc[0])
    if tau.tzinfo is not None:
        tau = tau.tz_convert("UTC").tz_localize(None)
    chosen["cluster_id"] = np.arange(len(chosen))
    chosen["n_points"], chosen["frp_sum"] = 0, 0.0
    print(f"Scenario: top {len(chosen)} new-ignition cells; probability "
          f"{chosen.probability.min():.4f} .. {chosen.probability.max():.4f}; no threshold.", flush=True)
    return chosen, tau


def bearing_between(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dl = np.radians(np.asarray(lon2) - np.asarray(lon1))
    return np.degrees(np.arctan2(np.sin(dl) * np.cos(p2),
                               np.cos(p1) * np.sin(p2) - np.sin(p1) * np.cos(p2) * np.cos(dl))) % 360


def angular_error(predicted, observed):
    return np.abs((np.asarray(predicted) - np.asarray(observed) + 180) % 360 - 180)


def nearest_on_sphere(reference, query):
    """Exact spherical nearest neighbours via Euclidean chords on unit vectors.

    Chord distance is monotone in great-circle distance on [0, pi]; converting
    it back to arc kilometres preserves the haversine matching thresholds.
    """
    def xyz(points):
        lat, lon = np.radians(points[["lat", "lon"]].to_numpy(dtype=float)).T
        return np.column_stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    distance, indices = cKDTree(xyz(reference)).query(xyz(query), k=1)
    return 2 * EARTH_KM * np.arcsin(np.clip(distance / 2, 0, 1)), indices


def progression(old_points, new_points, old_clusters, novelty_km=0.75, match_km=10, min_new=3):
    """Return old cluster -> observed new-front bearing, displacement and count."""
    if old_points.empty or new_points.empty or old_clusters.empty:
        return {}
    distance, _ = nearest_on_sphere(old_points, new_points)
    new = new_points.loc[distance > novelty_km].copy()
    if new.empty:
        return {}
    distance, indices = nearest_on_sphere(old_clusters, new)
    new["parent"] = old_clusters.cluster_id.to_numpy()[indices]
    new = new.loc[distance <= match_km]
    by_id = old_clusters.set_index("cluster_id")
    observed = {}
    for parent, group in new.groupby("parent"):
        if len(group) < min_new:
            continue
        lat, lon = spherical_mean(group.lat.to_numpy(), group.lon.to_numpy())
        old = by_id.loc[parent]
        p1, p2 = np.radians(old.lat), np.radians(lat)
        dl = np.radians(lon - old.lon)
        h = np.sin((p2 - p1) / 2)**2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2)**2
        displacement = 2 * EARTH_KM * np.arcsin(np.sqrt(np.clip(h, 0, 1)))
        if displacement >= novelty_km:
            observed[int(parent)] = (float(bearing_between(old.lat, old.lon, lat, lon)),
                                     float(displacement), len(group))
    return observed


def persistence_bearings(current, previous, previous_progression, match_km):
    if current.empty or previous.empty or not previous_progression:
        return np.full(len(current), np.nan)
    dist, idx = nearest_on_sphere(previous, current)
    parent_ids = previous.cluster_id.to_numpy()[idx]
    return np.array([previous_progression.get(int(parent), (np.nan,))[0]
                     if d <= match_km else np.nan for d, parent in zip(dist, parent_ids)])


def real_fire_mask(records):
    """Outcome-defined evaluation cohort; n_new is NEVER a model feature."""
    return (records.n_points >= 20) & (records.n_new >= 10)


def error_stats(errors):
    valid = np.asarray(errors, dtype=float)
    valid = valid[np.isfinite(valid)]
    return {"n": len(valid), "median_deg": float(np.median(valid)) if len(valid) else np.nan,
            "mean_deg": float(valid.mean()) if len(valid) else np.nan,
            "hit45_pct": float(100 * np.mean(valid <= 45)) if len(valid) else np.nan}


def metrics_table(records):
    rows = []
    for cohort, selected in [("all_clusters", records), ("real_fires", records.loc[real_fire_mask(records)])]:
        for name, part in [("all", selected)] + [(b, selected.loc[selected.wind_bin == b]) for b in ["<3", "3-6", ">6"]]:
            paired = part.loc[part.persistence_error_deg.notna()]
            wind = error_stats(part.model_error_deg)
            common = error_stats(paired.model_error_deg)
            pers = error_stats(paired.persistence_error_deg)
            rows.append({"cohort": cohort, "wind_bin_ms": name, "clusters": wind["n"],
                         "model_median_deg": wind["median_deg"], "model_mean_deg": wind["mean_deg"],
                         "model_hit45_pct": wind["hit45_pct"], "random_expected_deg": 90.0,
                         "random_hit45_pct": 25.0, "persistence_clusters": pers["n"],
                         "model_paired_median_deg": common["median_deg"],
                         "model_paired_hit45_pct": common["hit45_pct"],
                         "persistence_median_deg": pers["median_deg"],
                         "persistence_hit45_pct": pers["hit45_pct"]})
    return pd.DataFrame(rows)


def temporal_split(records, train_days=70):
    days = np.sort(pd.to_datetime(records.day).dt.normalize().unique())
    if len(days) <= train_days:
        raise ValueError(f"Need more than {train_days} source days; found {len(days)}")
    cutoff = pd.Timestamp(days[train_days - 1])
    training = pd.to_datetime(records.day) <= cutoff
    return training, {"train_first_day": str(pd.Timestamp(days[0]).date()),
                      "train_last_day": str(cutoff.date()), "train_source_days": int(train_days),
                      "test_first_day": str(pd.Timestamp(days[train_days]).date()),
                      "test_last_day": str(pd.Timestamp(days[-1]).date()),
                      "test_source_days": int(len(days) - train_days)}


def direction_vectors(wind, speed, persistence, w_wind, power):
    """Nonnegative normalized weights remove scale non-identifiability.

    f(speed)=(speed/3 m/s)**power. Missing persistence falls back to unit wind.
    For exactly cancelling vectors the deterministic tie-break is wind-only.
    """
    wind, speed, persistence = np.broadcast_arrays(np.asarray(wind, float),
                                                  np.asarray(speed, float), np.asarray(persistence, float))
    wr = np.radians(wind)
    has_pers = np.isfinite(persistence)
    pr = np.radians(np.where(has_pers, persistence, 0))
    weight = w_wind * (np.maximum(speed, 0) / 3.0)**power
    east = weight * np.sin(wr) + (1 - w_wind) * np.sin(pr)
    north = weight * np.cos(wr) + (1 - w_wind) * np.cos(pr)
    fallback = ~has_pers | (np.hypot(east, north) < 1e-12)
    return np.where(fallback, np.sin(wr), east), np.where(fallback, np.cos(wr), north)


def blend_direction(records, parameters):
    east, north = direction_vectors(records.bearing_deg, records.wind_speed_ms,
                                     records.persistence_bearing_deg,
                                     parameters["w_wind"], parameters["wind_power"])
    if parameters.get("w_upslope", 0) != 0:
        available = records.terrain_available.to_numpy(dtype=bool)
        slope = np.where(available, records.slope_deg, 0.)
        bearing = np.radians(np.where(available, records.upslope_bearing_deg, 0.))
        strength = parameters["w_upslope"] * np.tan(np.radians(slope)) / 0.1
        east = east + strength * np.sin(bearing)
        north = north + strength * np.cos(bearing)
    result = np.degrees(np.arctan2(east, north)) % 360
    return np.where(np.hypot(east, north) < 1e-12, records.bearing_deg, result)


def fit_direction_model(training, terrain=False, baseline=None):
    """Fit ONLY the caller's training cohort; no held-out rows passed here.

    Cluster-weighted mean angular error is the objective. Bounds and optimizer
    seed are fixed before test scoring; test metrics never choose a model.
    """
    if training.empty or not np.isfinite(training.observed_bearing_deg).all():
        raise ValueError("Need finite, nonempty training observations")
    # Arrays in the optimizer avoid repeated pandas allocation.
    speed = training.wind_speed_ms.to_numpy(float)
    wr = np.radians(training.bearing_deg.to_numpy(float))
    pr = np.radians(training.persistence_bearing_deg.to_numpy(float))
    has_pers = np.isfinite(pr)
    we, wn = np.sin(wr), np.cos(wr)
    pe, pn = np.sin(np.where(has_pers, pr, 0)), np.cos(np.where(has_pers, pr, 0))
    observed = training.observed_bearing_deg.to_numpy(float)
    te, tn = np.zeros(len(training)), np.zeros(len(training))
    if terrain:
        available = training.terrain_available.to_numpy(bool)
        if not available.any():
            raise ValueError("No usable training terrain")
        strength = np.tan(np.radians(np.where(available, training.slope_deg, 0))) / .1
        angle = np.radians(np.where(available, training.upslope_bearing_deg, 0))
        te, tn = strength * np.sin(angle), strength * np.cos(angle)

    def objective(x):
        alpha, power = x[:2]
        scale = alpha * (np.maximum(speed, 0) / 3.)**power
        east, north = scale * we + (1-alpha) * pe, scale * wn + (1-alpha) * pn
        fallback = ~has_pers | (np.hypot(east, north) < 1e-12)
        east, north = np.where(fallback, we, east), np.where(fallback, wn, north)
        if terrain:
            east, north = east + x[2] * te, north + x[2] * tn
        predicted = np.degrees(np.arctan2(east, north)) % 360
        predicted = np.where(np.hypot(east, north) < 1e-12, np.degrees(wr), predicted)
        return float(angular_error(predicted, observed).mean())

    bounds = [(0., 1.), (0., 3.)] + ([(0., 10.)] if terrain else [])
    result = differential_evolution(objective, bounds, seed=1729, maxiter=100,
                                    popsize=12, tol=1e-7, polish=True, workers=1)
    candidates = [result.x] + [np.array([a, p] + ([0.] if terrain else []))
                              for a, p in [(0, 0), (1, 0), (.5, 1)]]
    if terrain and baseline is not None:
        candidates.append(np.array([baseline["w_wind"], baseline["wind_power"], 0.]))
    best = min(candidates, key=objective)
    parameters = {"w_wind": float(best[0]), "w_pers": float(1-best[0]),
                  "wind_power": float(best[1]), "wind_reference_ms": 3.,
                  "w_upslope": float(best[2]) if terrain else 0.,
                  "train_mean_angular_error_deg": objective(best), "train_clusters": len(training),
                  "objective": "cluster-weighted mean angular error on training real fires",
                  "bounds": bounds, "optimizer_seed": 1729,
                  "optimizer_converged": bool(result.success), "objective_evaluations": int(result.nfev)}
    return parameters


def comparison_metrics(records, predictions):
    """Available-case and common-case results prevent baseline denominator bias."""
    rows = []
    for cohort, selected in [("all_clusters", records), ("real_fires", records.loc[real_fire_mask(records)])]:
        masks = {"available": pd.Series(True, index=selected.index),
                 "common_persistence": selected.persistence_bearing_deg.notna()}
        if "terrain_available" in selected:
            masks["common_terrain"] = selected.terrain_available
            masks["common_terrain_persistence"] = selected.terrain_available & selected.persistence_bearing_deg.notna()
        for availability, mask in masks.items():
            subset = selected.loc[mask]
            for wind_bin, part in [("all", subset)] + [(b, subset.loc[subset.wind_bin == b]) for b in ["<3", "3-6", ">6"]]:
                for model, column in predictions.items():
                    stats = error_stats(angular_error(part[column], part.observed_bearing_deg))
                    rows.append({"cohort": cohort, "availability": availability, "wind_bin_ms": wind_bin,
                                 "model": model, "clusters": stats["n"], "median_error_deg": stats["median_deg"],
                                 "mean_error_deg": stats["mean_deg"], "hit45_pct": stats["hit45_pct"],
                                 "random_median_deg": 90., "random_hit45_pct": 25.})
    return pd.DataFrame(rows)


def evaluate(args):
    out = ROOT / "output/spread"
    path = out / "backtest_clusters.csv"
    if not path.exists():
        raise FileNotFoundError("Run backtest first: cached backtest_clusters.csv is missing")
    records = pd.read_csv(path)
    if records[["day", "cluster_id"]].duplicated().any():
        raise ValueError("Duplicate source-day/cluster IDs in backtest")
    records["wind_bin"] = np.where(records.wind_speed_ms < 3, "<3", np.where(records.wind_speed_ms <= 6, "3-6", ">6"))
    records["model_error_deg"] = angular_error(records.bearing_deg, records.observed_bearing_deg)
    records["persistence_error_deg"] = angular_error(records.persistence_bearing_deg, records.observed_bearing_deg)
    all_metrics = metrics_table(records)
    all_metrics.to_csv(out / "backtest_metrics.csv", index=False, float_format="%.6f")
    print("ALL-DATE DESCRIPTIVE METRICS (not held-out model evaluation)")
    print(all_metrics.to_string(index=False, float_format=lambda v: f"{v:.2f}"), flush=True)
    is_training, split = temporal_split(records)
    real = real_fire_mask(records)
    print(f"Train: {split['train_first_day']} .. {split['train_last_day']} ({split['train_source_days']} source days); "
          f"test: {split['test_first_day']} .. {split['test_last_day']} ({split['test_source_days']} days)", flush=True)
    print(f"Training real fires: {int((is_training & real).sum()):,}; test real fires: {int((~is_training & real).sum()):,}", flush=True)
    parameters = fit_direction_model(records.loc[is_training & real])
    print("Fitted wind/persistence:", json.dumps(parameters, sort_keys=True), flush=True)
    records["blended_bearing_deg"] = blend_direction(records, parameters)
    predictions = {"wind_only": "bearing_deg", "persistence_only": "persistence_bearing_deg", "blended": "blended_bearing_deg"}
    model_file = {"split": split, "wind_persistence": parameters,
                  "backtest_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                  "real_fire_definition": "n_points >= 20 and n_new >= 10"}
    if getattr(args, "terrain", False):
        import fire_terrain
        terrain = fire_terrain.sample_clusters(records.loc[real], ROOT / "data/terrain", out / "terrain_plan.csv")
        records = records.merge(terrain, on=["day", "cluster_id"], how="left", validate="one_to_one")
        records["terrain_available"] = records.terrain_available.eq(True)
        is_training, _ = temporal_split(records)
        real = real_fire_mask(records)
        terrain_parameters = fit_direction_model(records.loc[is_training & real], terrain=True, baseline=parameters)
        records["terrain_blended_bearing_deg"] = blend_direction(records, terrain_parameters)
        predictions["blended_terrain"] = "terrain_blended_bearing_deg"
        model_file["terrain"] = terrain_parameters
        print("Fitted terrain blend:", json.dumps(terrain_parameters, sort_keys=True), flush=True)
        print(f"Terrain available: train {int((is_training & real & records.terrain_available).sum())}, "
              f"test {int((~is_training & real & records.terrain_available).sum())}", flush=True)
    records["partition"] = np.where(is_training, "train", "test")
    test = records.loc[~is_training]
    summary = comparison_metrics(test, predictions)
    suffix = "_terrain" if getattr(args, "terrain", False) else ""
    summary.to_csv(out / f"blend_test_metrics{suffix}.csv", index=False, float_format="%.6f")
    records.to_csv(out / f"blend_predictions{suffix}.csv", index=False, float_format="%.8f")
    (out / f"blend_model{suffix}.json").write_text(json.dumps(model_file, indent=2), encoding="utf-8")
    show = summary.loc[summary.cohort.eq("real_fires")]
    print("HELD-OUT REAL FIRES: available-case and matched-case comparisons; hit45 is a percentage.")
    print(show.drop(columns=["cohort", "random_median_deg", "random_hit45_pct"]).to_string(index=False, float_format=lambda v: f"{v:.2f}"))
    if getattr(args, "terrain", False):
        common = show.loc[(show.availability == "common_terrain") & (show.wind_bin_ms == "all")].set_index("model")
        base, terrain_row = common.loc["blended"], common.loc["blended_terrain"]
        print(f"Terrain change on identical covered test real fires: median error "
              f"{terrain_row.median_error_deg-base.median_error_deg:+.3f} deg; "
              f"hit45 {terrain_row.hit45_pct-base.hit45_pct:+.3f} percentage points.")
    print(f"Saved blend_test_metrics{suffix}.csv, blend_predictions{suffix}.csv, blend_model{suffix}.json", flush=True)


def cached_latest_wind_uv(tau):
    """Mirror existing cycle/step interpolation, but never request the network."""
    tau = pd.Timestamp(tau)
    for back in range(0, 49, 6):
        cycle = tau.floor("6h") - pd.Timedelta(hours=back)
        offset = (tau-cycle) / pd.Timedelta(hours=1)
        first = int(np.floor(offset/3))*3
        steps = list(range(first, first+25, 6))
        if steps[-1] < offset+24:
            steps.append(steps[-1]+6)
        path = ROOT / "data/gfs_uv" / f"uv_cycle_{cycle:%Y%m%dT%H}_{steps[0]:03d}_{steps[-1]:03d}.npz"
        if not path.exists():
            continue
        with np.load(path, allow_pickle=False) as z:
            result = {}
            for key in ("u", "v"):
                fields = z[key].astype(np.float32)
                arrays = []
                for target in offset + np.arange(0, 25, 6):
                    lo = min(int((target-first)//6), len(steps)-2)
                    weight = (target-steps[lo])/6
                    arrays.append((1-weight)*fields[lo]+weight*fields[lo+1])
                result[key] = np.stack(arrays)
        return result, cycle
    raise FileNotFoundError(f"No cached real-time U/V for {tau}; downloads are disabled")


def backtest(args):
    detections = read_detections(ROOT / "data/raw")
    first, last = detections.time.min().normalize(), detections.time.max().normalize()
    # Last observed calendar date may be incomplete; exclude it as a target.
    days = pd.date_range(first, last)
    print(f"Coverage: {len(days)} calendar dates; last date {last:%Y-%m-%d} excluded as incomplete target.", flush=True)
    cache = ROOT / "data/gfs_uv"
    missing_uv = [d for d in days if not (cache / f"uv_day_{d:%Y%m%d}.npz").exists()]
    print(f"U/V unavailable days: {len(missing_uv)}", flush=True)
    grouped = {pd.Timestamp(day): group for day, group in detections.groupby(detections.time.dt.normalize())}
    empty = detections.iloc[:0]
    previous = pd.DataFrame(columns=["cluster_id", "lat", "lon", "n_points", "frp_sum"])
    previous_progression = {}
    records, skips = [], Counter()
    total_clusters, no_target, ambiguous = 0, 0, 0
    for i, day in enumerate(days[:-1]):
        points = grouped.get(day, empty)
        current = clusters(points, args.eps_km, args.min_samples)
        next_day = day + pd.Timedelta(days=1)
        target = grouped.get(next_day, empty)
        observed = progression(points, target, current, args.novelty_km, args.match_km, args.min_new)
        if next_day >= last:
            skips["incomplete_target_day"] += 1
        elif points.empty or target.empty:
            skips["missing_detection_day"] += 1
        elif not (cache / f"uv_day_{next_day:%Y%m%d}.npz").exists():
            skips["missing_gfs_uv_day"] += 1
        elif current.empty:
            skips["no_active_clusters"] += 1
        else:
            total_clusters += len(current)
            sampled = wind_at_points(load_daily_uv(next_day, cache), current)
            speed, bearing, _ = wind_summary(sampled)
            persistence = persistence_bearings(current, previous, previous_progression, args.match_km)
            for j, row in enumerate(current.itertuples(index=False)):
                obs = observed.get(row.cluster_id)
                if obs is None:
                    no_target += 1
                    continue
                if not np.isfinite(bearing[j]):
                    ambiguous += 1
                    continue
                obs_bearing, displacement, n_new = obs
                records.append([day.strftime("%Y-%m-%d"), row.cluster_id, row.lat, row.lon,
                                row.n_points, n_new, displacement, speed[j], bearing[j], obs_bearing,
                                float(angular_error(bearing[j], obs_bearing)), persistence[j],
                                float(angular_error(persistence[j], obs_bearing)),
                                "<3" if speed[j] < 3 else "3-6" if speed[j] <= 6 else ">6"])
        previous, previous_progression = current, observed
        if (i + 1) % 5 == 0 or i == len(days) - 2:
            print(f"  Backtest {i + 1}/{len(days)-1}: {len(records):,} evaluated clusters", flush=True)
    result = pd.DataFrame(records, columns=BACKTEST_COLUMNS)
    summary = metrics_table(result)
    out = ROOT / "output/spread"
    out.mkdir(parents=True, exist_ok=True)
    result.to_csv(out / "backtest_clusters.csv", index=False, float_format="%.6f")
    summary.to_csv(out / "backtest_metrics.csv", index=False, float_format="%.6f")
    print(f"Clusters considered: {total_clusters:,}; without qualifying new front: {no_target:,}; "
          f"undefined wind bearing: {ambiguous:,}")
    print(f"Skipped days for missing GFS U/V: {skips['missing_gfs_uv_day']}; "
          f"missing detections: {skips['missing_detection_day']}; "
          f"incomplete target: {skips['incomplete_target_day']}; no clusters: {skips['no_active_clusters']}")
    print("Median angular errors; paired columns use identical clusters. Random baseline is analytic, not simulated.")
    print(summary.to_string(index=False, float_format=lambda x: f"{x:.2f}"))
    print(f"Saved {out / 'backtest_clusters.csv'} and backtest_metrics.csv", flush=True)


def run_forecast(args):
    persistence = None
    if args.mode == "scenario":
        points, tau = read_scenarios(ROOT / "output/firms/forecast_latest.csv")
        rh, dry = points.rhmin_pct.to_numpy(), points.days_since_rain.to_numpy()
    else:
        detections = read_detections(ROOT / "data/raw")
        tau = detections.time.max() + pd.Timedelta(minutes=1)
        if getattr(args, "as_of", None):
            requested = pd.Timestamp(args.as_of)
            if requested.tzinfo is not None:
                requested = requested.tz_convert("UTC").tz_localize(None)
            if requested > tau or requested < detections.time.min()+pd.Timedelta(hours=48):
                raise ValueError("Requested issue time needs 48h of cached detections and cannot be in the future")
            tau = requested
        recent = detections.loc[(detections.time >= tau - pd.Timedelta(hours=24)) & (detections.time < tau)]
        points = clusters(recent, args.eps_km, args.min_samples)
        previous_points = detections.loc[(detections.time >= tau-pd.Timedelta(hours=48))
                                        & (detections.time < tau-pd.Timedelta(hours=24))]
        previous_clusters = clusters(previous_points, args.eps_km, args.min_samples)
        observed_previous = progression(previous_points, recent, previous_clusters,
                                        args.novelty_km, args.match_km, args.min_new)
        persistence = persistence_bearings(points, previous_clusters, observed_previous, args.match_km)
        print(f"Active: {len(recent):,} last-24h detections -> {len(points):,} clusters", flush=True)
        rh, dry = active_dryness(points, tau, ROOT / "data/gfs")
    print(f"Issue time from cached inputs: {tau} UTC", flush=True)
    uv, cycle = cached_latest_wind_uv(tau)
    print(f"GFS U/V cycle: {cycle:%Y-%m-%d %HZ}; exact +6/+12/+18/+24h via time interpolation", flush=True)
    result = predict(points, uv, rh, dry, args.mode, args.midflame_factor)
    out = ROOT / "output/spread"
    out.mkdir(parents=True, exist_ok=True)
    for name in [f"spread_{args.mode}.csv", "spread_latest.csv"]:
        result.to_csv(out / name, index=False, float_format="%.6f")
    import fire_spread_web
    import sys
    fire_spread_web.export_forecast(sys.modules[__name__], points, uv, rh, dry, args.mode,
                                    tau, cycle, args.midflame_factor, persistence)
    if args.mode == "active":
        fire_spread_web.atomic_json(out / "recent_detections.json", {
            "issued_at_utc": fire_spread_web.utc(tau),
            "points": recent[["lat", "lon", "frp"]].round(4).to_numpy().tolist()})
    print(f"Saved {len(result):,} rows to {out / 'spread_latest.csv'} (also spread_{args.mode}.csv)")
    print("Distances are heuristic cumulative head-fire travel; fuel, terrain and suppression are not modelled.")
    print(result.head(5).to_string(index=False, float_format=lambda x: f"{x:.3f}"))
    if len(result):
        print(f"Median wind: {result.wind_speed_ms.median():.3f} m/s; "
              f"median 24h spread: {result.spread_km_24h.median():.3f} km; "
              f"undefined bearings: {result.bearing_deg.isna().sum()}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("mode", choices=["active", "scenario", "backtest", "evaluate", "terrain-plan", "terrain-download"])
    parser.add_argument("--eps-km", type=float, default=2.0)
    parser.add_argument("--min-samples", type=int, default=5)
    parser.add_argument("--match-km", type=float, default=10.0)
    parser.add_argument("--novelty-km", type=float, default=0.75)
    parser.add_argument("--min-new", type=int, default=3)
    parser.add_argument("--midflame-factor", type=float, default=0.4)
    parser.add_argument("--as-of", help="Active issue time in UTC; align spread with the cached probability forecast")
    parser.add_argument("--terrain", action="store_true", help="Include locally cached terrain in evaluate")
    parser.add_argument("--approve-terrain-download", action="store_true", help="Explicit approval for the printed terrain manifest")
    args = parser.parse_args()
    if (args.eps_km <= 0 or args.match_km <= 0 or args.novelty_km <= 0
            or args.min_samples < 1 or args.min_new < 1 or not 0 < args.midflame_factor <= 1):
        parser.error("Distances/counts must be positive; midflame-factor must be in (0,1]")
    started = time.perf_counter()
    try:
        if args.mode == "backtest":
            backtest(args)
        elif args.mode == "evaluate":
            evaluate(args)
        elif args.mode in ("terrain-plan", "terrain-download"):
            import fire_terrain
            if args.mode == "terrain-plan":
                fire_terrain.plan(ROOT)
            else:
                fire_terrain.download(ROOT, approved=args.approve_terrain_download)
        else:
            run_forecast(args)
    except (FileNotFoundError, gw.MissingGFS, ValueError) as exc:
        parser.exit(1, f"Stopped: {exc}\n")
    print(f"Elapsed: {time.perf_counter() - started:.2f} s", flush=True)


if __name__ == "__main__":
    main()
