"""NASA FIRMS wildfire analytics + near-real-time 24-hour fire probability forecast.

Two commands
------------
train    Download ~100 days of global VIIRS fire detections (FIRMS API) and
         NOAA GFS weather, build a (cell, cutoff) data set, validate several
         models on the most recent days and save the best one. Run occasionally
         (e.g. weekly). Also writes the analytics charts.
predict  Load the saved model, pull the newest satellite detections and the
         newest GFS forecast, and predict P(fire in the next 24 h) for EVERY land
         cell on Earth - near existing fires (spread / persistence) and far
         from them (new ignitions driven by weather and fire climatology).
         ``--every 3`` repeats it every 3 hours and automatically scores old
         forecasts against what really happened.

Examples
--------
  python fire_forecast.py train
  python fire_forecast.py predict
  python fire_forecast.py predict --every 3
  python fire_forecast.py predict --bbox -11 35 30 60      # report Europe only

The FIRMS MAP_KEY is read from the FIRMS_MAP_KEY environment variable or the
local .env file. Without a key, ``predict`` falls back to the public 7-day feed.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import time
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import ndimage

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.path import Path as MplPath

from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, brier_score_loss, log_loss,
                             precision_recall_curve, roc_auc_score)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

import firms_fetch
import gfs_weather as gw

ROOT = Path(__file__).resolve().parent
DATA, MODELS = ROOT / "data", ROOT / "models"
MODEL_PATH = MODELS / "fire_model.joblib"
EPOCH = pd.Timestamp("1970-01-01")

CONFIG = {
    "grid_res_deg": 0.25,       # cell size (~28 km)
    "history_days": 100,        # fire history downloaded for training
    "clim_days": 30,            # look-back for fire-climatology features
    "test_days": 14,            # most recent cutoffs held out for validation
    "neg_rate_near": 0.12,      # share of non-burning cells near fires kept for training
    "neg_rate_far": 0.03,       # share of non-burning cells far from fires kept (re-weighted)
    "min_confidence": "nominal",
    "latency_hours": 1,         # cutoff = newest detection hour minus this
    "risk_classes": [(0.0, "Low"), (0.10, "Moderate"), (0.30, "High"), (0.60, "Very high")],
    "map_min_prob": 0.01,
    "leads": [0, 1, 2, 3],      # forecast days: 0 = next 24 h, 1 = the 24 h after that, ...
    "hgb": dict(learning_rate=0.08, max_iter=800, max_leaf_nodes=127, min_samples_leaf=100,
                l2_regularization=1.0, early_stopping=True, validation_fraction=0.1,
                n_iter_no_change=40, random_state=42),
}
RISK_COLORS = {"Low": "#facc15", "Moderate": "#fb923c", "High": "#ef4444", "Very high": "#be123c"}
MAP_TEMPLATE = Path(__file__).with_name("map_template.html")
CLIMATE_TEMPLATE = Path(__file__).with_name("climate_template.html")
SAT_COLORS = {"N20": "#1565c0", "N21": "#00897b", "N": "#6a1b9a"}

FIRE_FEATURES = [
    "c_lag1", "c_lag2", "c_lag3", "frp_lag1", "frpmax_lag1", "night_lag1",
    "burn_days_7", "mean_count_7", "burn_days_30", "days_since_last",
    "n3_lag1", "n5_lag1", "n9_lag1", "n9_lag2", "n9_trend", "n5_mean7", "n9_mean7", "n15_mean7",
    "n9_active7", "n5_frp_lag1", "n9_burnfrac30", "n25_burnfrac30",
]
GEO_FEATURES = ["lat", "lon", "abs_lat", "doy_sin", "doy_cos"] + gw.STATIC_FEATURES
FEATURES = FIRE_FEATURES + GEO_FEATURES + gw.WEATHER_FEATURES
FIRE_ONLY = FIRE_FEATURES + GEO_FEATURES
DESCRIPTIONS = {
    "c_lag1": "detections in the cell, last 24 h", "c_lag2": "detections 24-48 h ago",
    "c_lag3": "detections 48-72 h ago", "frp_lag1": "fire radiative power, last 24 h",
    "frpmax_lag1": "strongest pixel FRP, last 24 h", "night_lag1": "night detections, last 24 h",
    "burn_days_7": "days with fire in the cell (7 d)", "mean_count_7": "mean daily detections (7 d)",
    "burn_days_30": "days with fire in the cell (30 d)", "days_since_last": "days since the cell burned",
    "n3_lag1": "detections in 8 neighbours, 24 h", "n5_lag1": "detections 5x5 cells, 24 h",
    "n9_lag1": "detections 9x9 cells, 24 h", "n9_lag2": "detections 9x9 cells, 24-48 h ago",
    "n9_trend": "9x9 trend (last day minus day before)", "n5_mean7": "mean daily detections 5x5 (7 d)",
    "n9_mean7": "mean daily detections 9x9 (7 d)", "n15_mean7": "mean daily detections 15x15 (7 d)",
    "n9_active7": "burning cells in 9x9 (7 d)", "n5_frp_lag1": "FRP in 5x5 cells, 24 h",
    "n9_burnfrac30": "regional burn frequency 9x9 (30 d)", "n25_burnfrac30": "regional burn frequency 25x25 (30 d)",
    "lat": "latitude", "lon": "longitude", "abs_lat": "absolute latitude",
    "doy_sin": "season (sin)", "doy_cos": "season (cos)",
    "veg": "vegetation cover (monthly, GFS)", "elev": "elevation", "soiltype": "soil type (GFS class)",
    "tmax": "max temperature", "tmean": "mean temperature", "rhmin": "min relative humidity",
    "rhmean": "mean relative humidity", "vpdmax": "max vapour pressure deficit",
    "wsmax": "max wind speed", "wsmean": "mean wind speed", "gustmax": "max wind gust",
    "precip_24h": "rain in the forecast window", "soilw": "soil moisture 0-10 cm",
    "precip_7d": "rain over the last 7 days", "precip_30d": "rain over the last 30 days",
    "days_since_rain": "days since >= 2 mm rain", "tmax_anom": "max temperature anomaly vs 30 d",
}


# ---------------------------------------------------------------------------
# Grid and static layers (land mask, countries)
# ---------------------------------------------------------------------------
class Grid:
    """Global regular lat/lon grid; cell id = row * nx + col."""

    def __init__(self, res: float):
        self.res, self.ny, self.nx = res, int(round(180 / res)), int(round(360 / res))

    def cell(self, lat, lon):
        i = np.clip(((np.asarray(lat) + 90) / self.res).astype(np.int64), 0, self.ny - 1)
        j = np.clip(((np.asarray(lon) + 180) / self.res).astype(np.int64), 0, self.nx - 1)
        return i * self.nx + j

    def center(self, cell):
        i, j = np.divmod(np.asarray(cell), self.nx)
        return -90 + (i + 0.5) * self.res, -180 + (j + 0.5) * self.res


def _load_polygons(path):
    gj = json.loads(Path(path).read_text(encoding="utf-8"))
    out = []
    for f in gj["features"]:
        name = f["properties"].get("NAME") or f["properties"].get("ADMIN")
        g = f["geometry"]
        for poly in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]):
            ring = np.asarray(poly[0])
            area = 0.5 * abs(np.dot(ring[:, 0], np.roll(ring[:, 1], 1)) - np.dot(ring[:, 1], np.roll(ring[:, 0], 1)))
            out.append((name, ring, area))
    return sorted(out, key=lambda x: x[2])  # small first: enclaves win over the surrounding country


def static_layers(grid: Grid):
    """Country index per cell (-1 = sea) and country names; cached on disk."""
    cache = DATA / f"static_{grid.res}.npz"
    borders = firms_fetch.fetch_countries_geojson(DATA)
    polys = _load_polygons(borders)
    if cache.exists():
        z = np.load(cache, allow_pickle=True)
        return z["country"], list(z["names"]), polys
    names = sorted({p[0] for p in polys})
    nid = {n: k for k, n in enumerate(names)}
    lat, lon = grid.center(np.arange(grid.ny * grid.nx))
    country = np.full(lat.size, -1, np.int16)
    pts = np.column_stack([lon, lat])
    for name, ring, _ in polys:
        (x0, y0), (x1, y1) = ring.min(0), ring.max(0)
        cand = np.nonzero((country < 0) & (lon >= x0) & (lon <= x1) & (lat >= y0) & (lat <= y1))[0]
        if cand.size:
            hit = MplPath(ring).contains_points(pts[cand])
            country[cand[hit]] = nid[name]
    country = country.reshape(grid.ny, grid.nx)
    # coastal cells whose centre falls just outside the coarse 1:110m coastline -> nearest country
    land = country >= 0
    grown = ndimage.binary_dilation(land, iterations=1) & ~land
    _, (ii, jj) = ndimage.distance_transform_edt(~land, return_indices=True)
    country[grown] = country[ii[grown], jj[grown]]
    np.savez_compressed(cache, country=country, names=np.array(names, dtype=object))
    return country, names, polys


def static_source_mask(grid: Grid) -> np.ndarray:
    """Cells dominated by non-vegetation heat sources (volcanoes, gas flares, industry, offshore),
    taken from the ``type`` labels of NASA's yearly VIIRS archive. Cached on disk."""
    cache = DATA / f"static_sources_{grid.res}.npy"
    if cache.exists():
        return np.load(cache)
    zp = firms_fetch.fetch_static_archive(DATA / "archive")
    N = grid.ny * grid.nx
    if zp is None:
        return np.zeros(N, bool)
    stat, veg = np.zeros(N), np.zeros(N)
    with zipfile.ZipFile(zp) as z:
        for name in z.namelist():
            if not name.endswith(".csv"):
                continue
            with z.open(name) as fh:
                df = pd.read_csv(fh, usecols=["latitude", "longitude", "type"])
            c, t = grid.cell(df["latitude"], df["longitude"]), df["type"].to_numpy()
            np.add.at(stat, c[t > 0], 1)
            np.add.at(veg, c[t == 0], 1)
    mask = (stat >= 3) & (stat >= 0.3 * (stat + veg))
    np.save(cache, mask)
    print(f"  static heat-source cells (volcano / industrial / offshore): {mask.sum():,}")
    return mask


# Persistent heat sources that NASA does not label (factories, flares, power plants, landfills).
# A ~2 km pixel that shows a detection in most months of a long archive, in all seasons, is not
# vegetation: burned vegetation needs years to grow back, and fire seasons last a few months.
PERSIST_RES = 0.02            # degrees (~2 km)
PERSIST_MIN_MONTHS = 12       # months with a detection (of ~25 in a two-year archive)
PERSIST_MIN_SEASON = 8        # different calendar months with a detection
PERSIST_MIN_HISTORY = 365     # days of archive needed to judge persistence
PERSIST_FILE = DATA / "persistent_sources.npy"
_persist_cache = {}


def _persist_pixel(lat, lon):
    nx = int(round(360 / PERSIST_RES))
    i = ((np.asarray(lat, np.float64) + 90) / PERSIST_RES).astype(np.int64)
    j = ((np.asarray(lon, np.float64) + 180) / PERSIST_RES).astype(np.int64)
    return i * nx + j


def build_persistent_sources(paths) -> np.ndarray:
    """Pixels (and their 8 neighbours) that burn year-round in the downloaded archive. Saved to disk."""
    keys, months = [], set()
    for p in paths:
        df = pd.read_csv(p, usecols=["latitude", "longitude", "acq_date"])
        if df.empty:
            continue
        date = pd.to_datetime(df["acq_date"], format="%Y-%m-%d")
        ym = ((date.dt.year - 2000) * 12 + date.dt.month - 1).to_numpy(np.int64)
        months.update(np.unique(ym).tolist())
        keys.append(np.unique(_persist_pixel(df["latitude"], df["longitude"]) * 4096 + ym))
    if len(months) < PERSIST_MIN_HISTORY // 30:
        return np.zeros(0, np.int64)
    k = np.unique(np.concatenate(keys))
    pix, ym = k // 4096, k % 4096
    u, inv = np.unique(pix, return_inverse=True)
    n_months = np.bincount(inv)
    n_season = np.bincount(np.unique(inv * 12 + ym % 12) // 12, minlength=len(u))
    core = u[(n_months >= PERSIST_MIN_MONTHS) & (n_season >= PERSIST_MIN_SEASON)]
    nx = int(round(360 / PERSIST_RES))
    out = np.unique(np.concatenate([core + di * nx + dj for di in (-1, 0, 1) for dj in (-1, 0, 1)]))
    np.save(PERSIST_FILE, out)
    _persist_cache.clear()
    print(f"  persistent heat sources: {len(core):,} pixels burn year-round "
          f"(detections in >= {PERSIST_MIN_MONTHS} of {len(months)} months)")
    return out


def persistent_sources() -> np.ndarray:
    if "ids" not in _persist_cache:
        _persist_cache["ids"] = np.load(PERSIST_FILE) if PERSIST_FILE.exists() else np.zeros(0, np.int64)
    return _persist_cache["ids"]


def drop_static(det: pd.DataFrame, grid: Grid, mask: np.ndarray, quiet: bool = False) -> pd.DataFrame:
    bad = mask[grid.cell(det["lat"], det["lon"])]
    ids = persistent_sources()
    pers = np.isin(_persist_pixel(det["lat"], det["lon"]), ids) & ~bad if len(ids) else np.zeros(len(det), bool)
    if not quiet:
        print(f"  removed {bad.sum():,} detections ({bad.mean():.1%}) at static heat sources"
              + (f" and {pers.sum():,} ({pers.mean():.1%}) at persistent ones" if len(ids) else ""))
    return det[~(bad | pers)].reset_index(drop=True)


def land_cells(grid: Grid, country, extra_cells=None, bbox=None, static=None) -> np.ndarray:
    mask = (country >= 0).ravel().copy()
    if extra_cells is not None:
        mask[np.asarray(extra_cells)] = True  # islands / coasts where fires were actually seen
    if static is not None:
        mask &= ~static
    lat, lon = grid.center(np.arange(mask.size))
    mask &= (lat > -60) & (lat < 80)
    if bbox:
        w, s, e, n = bbox
        mask &= (lon >= w) & (lon <= e) & (lat >= s) & (lat <= n)
    return np.nonzero(mask)[0]


def country_of_ids(idx, names):
    idx = np.asarray(idx)
    return np.where(idx >= 0, np.array(names, dtype=object)[np.maximum(idx, 0)], "Ocean / unassigned")


def country_of(cells, country, names):
    return country_of_ids(country.ravel()[np.asarray(cells)], names)


# ---------------------------------------------------------------------------
# Fire history (hourly sparse table) and feature maps
# ---------------------------------------------------------------------------
def to_hour(ts) -> int:
    ts = pd.Timestamp(ts)
    if ts.tzinfo is not None:
        ts = ts.tz_convert("UTC").tz_localize(None)
    return int((ts - EPOCH) // pd.Timedelta(hours=1))


def from_hour(h: int) -> pd.Timestamp:
    return EPOCH + pd.Timedelta(hours=int(h))


class FireHistory:
    """Detections aggregated per (UTC hour, cell): count, FRP sum/max, night count."""

    def __init__(self, det: pd.DataFrame, grid: Grid):
        hour = ((det["time"] - EPOCH) // pd.Timedelta(hours=1)).to_numpy(np.int64)
        df = pd.DataFrame({"hour": hour, "cell": grid.cell(det["lat"], det["lon"]),
                           "frp": det["frp"].to_numpy(np.float32),
                           "night": (det["daynight"] == "N").to_numpy(np.float32)})
        g = df.groupby(["hour", "cell"], sort=True).agg(
            count=("frp", "size"), frp=("frp", "sum"), frpmax=("frp", "max"), night=("night", "sum"))
        self.hour = g.index.get_level_values(0).to_numpy(np.int64)
        self.cell = g.index.get_level_values(1).to_numpy(np.int64)
        self.vals = {k: g[k].to_numpy(np.float32) for k in ("count", "frp", "frpmax", "night")}
        self.first_hour, self.last_hour = int(hour.min()), int(hour.max())

    @classmethod
    def concat(cls, parts, first_hour: int | None = None):
        """Join histories of consecutive, non-overlapping periods (oldest first)."""
        self = cls.__new__(cls)
        self.hour = np.concatenate([p.hour for p in parts])
        if np.any(np.diff(self.hour) < 0):
            raise ValueError("fire-history parts overlap in time")
        a = 0 if first_hour is None else int(np.searchsorted(self.hour, first_hour))
        self.hour = self.hour[a:]
        self.cell = np.concatenate([p.cell for p in parts])[a:]
        self.vals = {k: np.concatenate([p.vals[k] for p in parts])[a:] for k in parts[0].vals}
        self.first_hour, self.last_hour = int(self.hour[0]), int(self.hour[-1])
        return self

    def slice(self, h0, h1):
        a, b = np.searchsorted(self.hour, [h0, h1])
        return self.hour[a:b], self.cell[a:b], {k: v[a:b] for k, v in self.vals.items()}


def box(a: np.ndarray, k: int) -> np.ndarray:
    """Sum over a k x k window (separable); longitude wraps around the dateline."""
    r, ones = k // 2, np.ones(k, np.float32)
    p = np.pad(a.astype(np.float32), ((0, 0), (r, r)), mode="wrap")
    p = ndimage.correlate1d(p, ones, axis=1, mode="constant")[:, r:-r]
    return ndimage.correlate1d(p, ones, axis=0, mode="constant")


def fire_maps(hist: FireHistory, tau_h: int, grid: Grid, clim: int, with_target: bool) -> dict:
    """Global feature maps describing fire activity before cutoff ``tau_h`` (and the target after)."""
    N, shape = grid.ny * grid.nx, (grid.ny, grid.nx)
    hour, cell, v = hist.slice(tau_h - 24 * clim, tau_h)
    lag = (tau_h - 1 - hour) // 24 + 1  # 1 = last 24 h

    def bc(mask, w):
        return np.bincount(cell[mask], weights=w[mask], minlength=N).astype(np.float32).reshape(shape)

    m = {f"c_lag{k}": bc(lag == k, v["count"]) for k in (1, 2, 3)}
    m["frp_lag1"] = bc(lag == 1, v["frp"])
    m["night_lag1"] = bc(lag == 1, v["night"])
    fmax = np.zeros(N, np.float32)
    np.maximum.at(fmax, cell[lag == 1], v["frpmax"][lag == 1])
    m["frpmax_lag1"] = fmax.reshape(shape)
    cnt7 = bc(lag <= 7, v["count"])
    u = np.unique(cell * 64 + lag)
    uc, ul = u // 64, u % 64
    act7 = np.bincount(uc[ul <= 7], minlength=N).astype(np.float32).reshape(shape)
    act30 = np.bincount(uc, minlength=N).astype(np.float32).reshape(shape)
    dsl = np.full(N, clim + 1, np.float32)
    np.minimum.at(dsl, uc, ul.astype(np.float32))
    c1, c2 = m["c_lag1"], m["c_lag2"]
    m.update({
        "burn_days_7": act7, "mean_count_7": cnt7 / 7, "burn_days_30": act30,
        "days_since_last": dsl.reshape(shape),
        "n3_lag1": box(c1, 3) - c1, "n5_lag1": box(c1, 5), "n9_lag1": box(c1, 9), "n9_lag2": box(c2, 9),
        "n5_mean7": box(cnt7 / 7, 5), "n9_mean7": box(cnt7 / 7, 9), "n15_mean7": box(cnt7 / 7, 15),
        "n9_active7": box(act7 > 0, 9), "n5_frp_lag1": box(m["frp_lag1"], 5),
        "n9_burnfrac30": box(act30, 9) / (81 * clim), "n25_burnfrac30": box(act30, 25) / (625 * clim),
    })
    m["n9_trend"] = m["n9_lag1"] - m["n9_lag2"]
    if with_target:
        _, tc, tv = hist.slice(tau_h, tau_h + 24)
        m["target"] = np.bincount(tc, weights=tv["count"], minlength=N).astype(np.float32).reshape(shape)
    return m


def target_map(hist: FireHistory, tau_h: int, lead: int, grid: Grid) -> np.ndarray:
    """Detections per cell in the 24 h window that starts ``lead`` days after the cutoff."""
    _, tc, tv = hist.slice(tau_h + 24 * lead, tau_h + 24 * lead + 24)
    return np.bincount(tc, weights=tv["count"], minlength=grid.ny * grid.nx).astype(np.float32).reshape(grid.ny, grid.nx)


def make_rows(maps: dict, cells: np.ndarray, grid: Grid, tau: pd.Timestamp, window, past,
              lead: int = 0, static_wx: dict | None = None) -> pd.DataFrame:
    """Feature rows for the 24 h window starting ``lead`` days after ``tau`` (fire history stays as of ``tau``)."""
    i, j = np.divmod(cells, grid.nx)
    lat, lon = grid.center(cells)
    mid = tau + pd.Timedelta(days=lead, hours=12)  # centre of the target window
    doy = 2 * np.pi * mid.dayofyear / 365.25
    df = pd.DataFrame({k: maps[k][i, j] for k in FIRE_FEATURES})
    df["lat"], df["lon"], df["abs_lat"] = lat.astype(np.float32), lon.astype(np.float32), np.abs(lat).astype(np.float32)
    df["doy_sin"], df["doy_cos"] = np.float32(np.sin(doy)), np.float32(np.cos(doy))
    wx = gw.weather_features(window, past, lat, lon)
    df = pd.concat([df, wx, gw.static_features(static_wx, mid.month, lat, lon)], axis=1)
    df["cell"] = cells
    df["near"] = maps["n9_active7"][i, j] > 0  # any fire within ~1 deg during the last 7 days
    return df


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
def _signed_log1p(X):
    return np.sign(X) * np.log1p(np.abs(X))


def make_logit():
    return make_pipeline(FunctionTransformer(_signed_log1p), StandardScaler(),
                         LogisticRegression(max_iter=3000, C=1.0))


def predict_members(members, X):
    """Mean probability of an ensemble given as [(model, feature_list), ...]."""
    return np.mean([m.predict_proba(X[f])[:, 1] for m, f in members], axis=0)


def _scores(y, p, w):
    if y.sum() == 0 or y.sum() == len(y):
        return {"ROC_AUC": np.nan, "PR_AUC": np.nan, "Brier": np.nan, "LogLoss": np.nan, "best_F1": np.nan}
    p = np.clip(p, 1e-6, 1 - 1e-6)
    prec, rec, _ = precision_recall_curve(y, p, sample_weight=w)
    f1 = 2 * prec * rec / np.maximum(prec + rec, 1e-12)
    return {"ROC_AUC": roc_auc_score(y, p, sample_weight=w),
            "PR_AUC": average_precision_score(y, p, sample_weight=w),
            "Brier": brier_score_loss(y, p, sample_weight=w),
            "LogLoss": log_loss(y, p, sample_weight=w, labels=[0, 1]), "best_F1": np.nanmax(f1)}


LOGIT_MAX_ROWS = 1_000_000  # a linear model does not need more; keeps memory low
HGB_MAX_ROWS = 5_000_000    # boosting copies its input as float64: ~0.7 GB per million rows


def _cap_rows(X, y, w, limit=HGB_MAX_ROWS, seed=7):
    """Random subset of at most ``limit`` rows (the same subset for the same input size)."""
    if len(X) <= limit:
        return X, y, w
    idx = np.sort(np.random.default_rng(seed).choice(len(X), size=limit, replace=False))
    print(f"    using a random {limit:,} of {len(X):,} rows (memory limit)")
    return X.iloc[idx], y[idx], w[idx]


def _metric_table(preds, te, yte, wte) -> pd.DataFrame:
    far = ~te["near"].to_numpy()
    rows = []
    for name, p in preds.items():
        a, b = _scores(yte, p, wte), _scores(yte[far], p[far], wte[far])
        rows.append({"model": name, **a, "new_ignition_ROC_AUC": b["ROC_AUC"], "new_ignition_PR_AUC": b["PR_AUC"]})
    return pd.DataFrame(rows).set_index("model")


GB_NAME = "Gradient boosting, fire + weather"


def train_models(data: pd.DataFrame, cfg=CONFIG, light: bool = False):
    dates = np.sort(data["date"].unique())
    test_dates = dates[-cfg["test_days"]:]
    is_te = data["date"].isin(test_dates).to_numpy()
    n_tr = int((~is_te).sum())
    # rows are in date order, so the split is a plain slice (no second copy of a large table)
    tr, te = (data.iloc[:n_tr], data.iloc[n_tr:]) if is_te[n_tr:].all() else (data[~is_te], data[is_te])
    ytr, wtr, yte, wte = tr["y"].to_numpy(), tr["w"].to_numpy(), te["y"].to_numpy(), te["w"].to_numpy()
    print(f"  train: {len(tr):,} rows from {len(dates) - len(test_dates)} days | "
          f"test: {len(te):,} rows from {len(test_dates)} days "
          f"({pd.Timestamp(test_dates[0]):%Y-%m-%d} .. {pd.Timestamp(test_dates[-1]):%Y-%m-%d})")

    def fit_hgb(feats, X, y, w, **kw):
        t0 = time.time()
        X, y, w = _cap_rows(X, y, w)
        m = HistGradientBoostingClassifier(**dict(cfg["hgb"], **kw)).fit(X[feats], y, sample_weight=w)
        print(f"    HGB on {len(feats)} features: {m.n_iter_} trees, {time.time() - t0:.0f}s")
        return m

    preds = {
        "Persistence (burned in last 24 h)": (te["c_lag1"] > 0).astype(float).to_numpy(),
        "7-day burn frequency": (te["burn_days_7"] / 7).to_numpy(),
    }
    if light:  # later forecast days: one boosting model, no ensemble, no refit, no importance
        hgb = fit_hgb(FEATURES, tr, ytr, wtr)
        preds[GB_NAME] = hgb.predict_proba(te[FEATURES])[:, 1]
        metrics = _metric_table(preds, te, yte, wte)
        metrics["selected"] = metrics.index == GB_NAME
        return [(hgb, FEATURES)], GB_NAME, metrics, None, (te, preds)
    hgb_fire = fit_hgb(FIRE_ONLY, tr, ytr, wtr)
    preds["Gradient boosting, fire history only"] = hgb_fire.predict_proba(te[FIRE_ONLY])[:, 1]
    t0 = time.time()
    rng = np.random.default_rng(1)
    sub_tr = np.sort(rng.choice(len(tr), size=min(len(tr), LOGIT_MAX_ROWS), replace=False))
    logit = make_logit().fit(tr[FEATURES].iloc[sub_tr], ytr[sub_tr], logisticregression__sample_weight=wtr[sub_tr])
    print(f"    logistic regression: {time.time() - t0:.0f}s")
    preds["Logistic regression, fire + weather"] = logit.predict_proba(te[FEATURES])[:, 1]
    hgb = fit_hgb(FEATURES, tr, ytr, wtr)
    preds["Gradient boosting, fire + weather"] = hgb.predict_proba(te[FEATURES])[:, 1]
    preds["Ensemble (boosting + logistic)"] = 0.5 * (preds["Gradient boosting, fire + weather"]
                                                     + preds["Logistic regression, fire + weather"])

    metrics = _metric_table(preds, te, yte, wte)
    learned = ["Logistic regression, fire + weather", "Gradient boosting, fire + weather",
               "Ensemble (boosting + logistic)"]
    best = metrics.loc[learned, "PR_AUC"].idxmax()
    metrics["selected"] = metrics.index == best
    print(f"  selected (best held-out PR-AUC): {best}")

    rng = np.random.default_rng(0)
    sub = rng.choice(len(te), size=min(40000, len(te)), replace=False)
    imp = permutation_importance(hgb, te[FEATURES].iloc[sub], yte[sub], sample_weight=wte[sub],
                                 scoring="average_precision", n_repeats=3, random_state=0, n_jobs=4)
    importance = (pd.DataFrame({"feature": FEATURES, "importance": imp.importances_mean, "std": imp.importances_std})
                  .assign(group=lambda d: np.where(d["feature"].isin(gw.WEATHER_FEATURES), "weather",
                                                   np.where(d["feature"].isin(GEO_FEATURES), "location/season",
                                                            "fire history")),
                          description=lambda d: d["feature"].map(DESCRIPTIONS))
                  .sort_values("importance", ascending=False))

    print("  refitting the selected model on all days ...")
    y, w = data["y"].to_numpy(), data["w"].to_numpy()
    members = []
    if best != "Logistic regression, fire + weather":
        Xc, yc, wc = _cap_rows(data, y, w)
        members.append((HistGradientBoostingClassifier(**dict(cfg["hgb"], early_stopping=False,
                                                              max_iter=max(100, hgb.n_iter_)))
                        .fit(Xc[FEATURES], yc, sample_weight=wc), FEATURES))
        del Xc, yc, wc
    if best != "Gradient boosting, fire + weather":
        sub = np.sort(rng.choice(len(data), size=min(len(data), LOGIT_MAX_ROWS), replace=False))
        members.append((make_logit().fit(data[FEATURES].iloc[sub], y[sub], logisticregression__sample_weight=w[sub]),
                         FEATURES))
    return members, best, metrics, importance, (te, preds)


# ---------------------------------------------------------------------------
# Data loading helpers
# ---------------------------------------------------------------------------
def fire_paths(days: int, args) -> list[Path]:
    raw = DATA / "raw"
    key = args.map_key or os.environ.get("FIRMS_MAP_KEY")
    if key and not args.offline:
        paths = firms_fetch.fetch_api(raw, key, days, firms_fetch.DEFAULT_SOURCES)
    elif key and args.offline:
        start = (pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=days + 5)).date()
        paths = [p for p in sorted(raw.glob("api_VIIRS_NOAA2*_world_*.csv"))
                 if pd.Timestamp(p.stem.split("_")[-2]).date() >= start]
    else:
        print("  no FIRMS_MAP_KEY: using the public 7-day feed (30-day climatology features will be truncated)")
        paths = firms_fetch.fetch_nrt(raw, firms_fetch.DEFAULT_SOURCES, offline=args.offline)
    return paths


def load_fire_data(days: int, args) -> pd.DataFrame:
    det = firms_fetch.load_detections(fire_paths(days, args), CONFIG["min_confidence"])
    cutoff = det["time"].max() - pd.Timedelta(days=days)
    return det[det["time"] >= cutoff].reset_index(drop=True)


LONG_HISTORY_DAYS = 150  # above this, detections are aggregated month by month to keep memory low


def load_fire_history(days: int, args, grid: Grid, static: np.ndarray, recent_days: int):
    """Fire history for ``days`` days plus the raw detections of the last ``recent_days`` (for analytics).

    Years of detections do not fit in memory as one table, so files are read in ~30-day
    groups, cleaned, and reduced to the hourly (hour, cell) table one group at a time.
    """
    if days <= LONG_HISTORY_DAYS:
        det = drop_static(load_fire_data(days, args), grid, static)
        return FireHistory(det, grid), det
    groups = {}
    for p in fire_paths(days, args):
        try:
            start = pd.Timestamp(p.stem.split("_")[-2])
        except ValueError:
            raise SystemExit("a long history needs the FIRMS API key (FIRMS_MAP_KEY)")
        groups.setdefault((start - EPOCH).days // 30, []).append(p)
    parts, recent, n_det, n_static = [], [], 0, 0
    for k, key in enumerate(sorted(groups), 1):
        det = firms_fetch.load_detections(groups[key], CONFIG["min_confidence"])
        n0 = len(det)
        det = drop_static(det, grid, static, quiet=True)
        n_det, n_static = n_det + len(det), n_static + n0 - len(det)
        parts.append(FireHistory(det, grid))
        recent = (recent + [det])[-(recent_days // 30 + 2):]
        if k % 6 == 0 or k == len(groups):
            print(f"    {k}/{len(groups)} months read, {n_det:,} detections so far")
    last = parts[-1].last_hour
    hist = FireHistory.concat(parts, first_hour=last - 24 * days)
    print(f"  removed {n_static:,} detections ({n_static / max(1, n_det + n_static):.1%}) at static and persistent heat sources")
    det = pd.concat(recent, ignore_index=True)
    det["satellite"] = det["satellite"].astype(str).astype("category")
    det = det[det["time"] >= det["time"].max() - pd.Timedelta(days=recent_days)].reset_index(drop=True)
    return hist, det


def _risk_class(p):
    bounds = [b for b, _ in CONFIG["risk_classes"]][1:]
    return np.array([n for _, n in CONFIG["risk_classes"]])[np.digitize(p, bounds)]


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------
def analytics(det, grid, country, names, out: Path, polys):
    """Daily / country / hotspot / diurnal summaries without copying the detection table."""
    cell = grid.cell(det["lat"].to_numpy(), det["lon"].to_numpy())
    cid = country.ravel()[cell]
    day = det["time"].dt.normalize()
    frp = det["frp"]
    is_high = (det["confidence"] == "high").to_numpy()
    is_night = (det["daynight"] == "N").to_numpy()
    tmp = pd.DataFrame({"day": day.to_numpy(), "cell": cell, "cid": cid, "frp": frp.to_numpy(),
                        "high": is_high, "night": is_night, "sat": det["satellite"].to_numpy()})
    last_complete = det["time"].max().normalize() - pd.Timedelta(days=1)
    g = tmp.groupby("day")
    daily = pd.DataFrame({
        "detections": g.size(), "high_conf_share": g["high"].mean(), "night_share": g["night"].mean(),
        "total_frp_GW": g["frp"].sum() / 1e3, "mean_frp_MW": g["frp"].mean(), "max_frp_MW": g["frp"].max(),
        "active_cells": g["cell"].nunique(), "countries": g["cid"].nunique()})
    sat_day = tmp.groupby(["day", "sat"], observed=True).size().unstack(fill_value=0)
    for sat in sat_day.columns:
        daily[f"det_{sat}"] = sat_day[sat]
    daily["complete_day"] = daily.index <= last_complete
    daily.index = daily.index.date
    daily.index.name = "date"

    cg = tmp.groupby("cid")
    by_country = pd.DataFrame({"detections": cg.size(), "total_frp_GW": cg["frp"].sum() / 1e3,
                               "max_frp_MW": cg["frp"].max(), "active_cells": cg["cell"].nunique(),
                               "days_with_fire": cg["day"].nunique()})
    by_country.index = country_of_ids(by_country.index.to_numpy(), names)
    by_country.index.name = "country"
    by_country = by_country.groupby(level=0).sum().sort_values("detections", ascending=False)
    by_country["share_pct"] = 100 * by_country["detections"] / len(tmp)

    hg = tmp.groupby("cell")
    hot = pd.DataFrame({"detections": hg.size(), "total_frp_MW": hg["frp"].sum(), "max_frp_MW": hg["frp"].max(),
                        "days_with_fire": hg["day"].nunique()})
    hot = hot.sort_values("total_frp_MW", ascending=False).head(25)
    hot["country"] = country_of(hot.index.to_numpy(), country, names)
    hot["cell_lat"], hot["cell_lon"] = grid.center(hot.index.to_numpy())
    hot["burned_share_of_days"] = hot["days_with_fire"] / tmp["day"].nunique()
    hot = hot.reset_index(drop=True)

    t = det["time"]
    solar = ((t.dt.hour + t.dt.minute / 60 + det["lon"] / 15) % 24).astype(np.int8)
    diurnal = (pd.DataFrame({"h": solar.to_numpy(), "dn": det["daynight"].astype(str).to_numpy()})
               .groupby(["h", "dn"]).size().unstack(fill_value=0))
    del tmp

    daily.to_csv(out / "daily_summary.csv")
    by_country.to_csv(out / "countries.csv")
    hot.to_csv(out / "top_hotspots.csv", index=False)
    _plot_analytics(det, daily, by_country, diurnal, polys, out)
    return daily, by_country, hot


def _borders(ax, polys):
    for _, ring, _ in polys:
        ax.plot(ring[:, 0], ring[:, 1], color="#9e9e9e", lw=0.35, zorder=1)


def _clean(ax):
    ax.spines[["top", "right"]].set_visible(False)


def _plot_analytics(det, daily, by_country, diurnal, polys, out):
    x = pd.to_datetime(pd.Series(daily.index))
    fig, ax = plt.subplots(figsize=(13, 4.8))
    bottom = np.zeros(len(daily))
    for col in [c for c in daily.columns if c.startswith("det_")]:
        v = daily[col].fillna(0).to_numpy()
        ax.bar(x, v, bottom=bottom, width=0.85, color=SAT_COLORS.get(col[4:], "#757575"), label=f"VIIRS {col[4:]}")
        bottom += v
    ax.set_ylabel("fire detections per day")
    ax2 = ax.twinx()
    ax2.plot(x, daily["total_frp_GW"], color="#d84315", lw=1.8, label="total FRP (GW)")
    ax2.set_ylabel("total fire radiative power, GW", color="#d84315")
    ax2.set_ylim(0, daily["total_frp_GW"].max() * 1.2)
    h1, l1 = ax.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax.legend(h1 + h2, l1 + l2, loc="upper left", frameon=False, fontsize=9)
    ax.set_title("Global active-fire detections per day (NASA FIRMS VIIRS); last day is partial", loc="left")
    fig.tight_layout()
    fig.savefig(out / "01_daily_detections.png", dpi=130)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(14, 7))
    _borders(ax, polys)
    H, xe, ye = np.histogram2d(det["lon"].to_numpy(), det["lat"].to_numpy(), bins=[720, 280],
                               range=[[-180, 180], [-60, 80]], weights=det["frp"].to_numpy())
    H = np.ma.masked_less_equal(H.T, 0)
    from matplotlib.colors import LogNorm
    im = ax.pcolormesh(xe, ye, H, cmap="inferno_r", norm=LogNorm(vmin=max(H.min(), 1), vmax=H.max()), zorder=2)
    fig.colorbar(im, ax=ax, shrink=0.7, label="total FRP per 0.5 deg cell, MW (log)")
    ax.set_xlim(-180, 180)
    ax.set_ylim(-60, 80)
    ax.set_aspect("equal")
    ax.set_title(f"Fire radiative power {daily.index[0]} .. {daily.index[-1]} ({len(det):,} detections)", loc="left")
    fig.tight_layout()
    fig.savefig(out / "02_fire_map.png", dpi=130)
    plt.close(fig)

    top = by_country.drop(index="Ocean / unassigned", errors="ignore").head(15)[::-1]
    fig, ax = plt.subplots(figsize=(9, 6))
    ax.barh(top.index, top["detections"], color="#e64a19")
    for k, (v, s) in enumerate(zip(top["detections"], top["share_pct"])):
        ax.text(v, k, f" {v:,}  ({s:.1f}%)", va="center", fontsize=8)
    ax.set_xlim(0, top["detections"].max() * 1.3)
    ax.set_xlabel("detections")
    ax.set_title("Top 15 countries by fire detections", loc="left")
    _clean(ax)
    fig.tight_layout()
    fig.savefig(out / "03_top_countries.png", dpi=130)
    plt.close(fig)

    fig, (a1, a2) = plt.subplots(1, 2, figsize=(13, 4.5))
    for col, color, lab in [("D", "#ffa000", "day pass"), ("N", "#283593", "night pass")]:
        if col in diurnal:
            a1.bar(diurnal.index, diurnal[col], color=color, label=lab, width=0.8)
    a1.set_xlabel("local solar time, hour")
    a1.set_ylabel("detections")
    a1.set_title("When fires are observed (VIIRS overpasses ~01:30 / 13:30)", loc="left")
    a1.legend(frameon=False)
    frp = det["frp"].clip(lower=0.1)
    a2.hist(frp, bins=np.logspace(-1, np.log10(frp.max()), 60), color="#c62828")
    a2.set_xscale("log")
    a2.set_yscale("log")
    a2.set_xlabel("fire radiative power per pixel, MW")
    a2.set_title(f"FRP distribution (median {frp.median():.1f} MW, 99th pct {frp.quantile(0.99):.0f} MW)", loc="left")
    for a in (a1, a2):
        _clean(a)
    fig.tight_layout()
    fig.savefig(out / "04_diurnal_frp.png", dpi=130)
    plt.close(fig)


def plot_model(metrics, eval_data, importance, data, out: Path):
    te, preds = eval_data
    y, w, far = te["y"].to_numpy(), te["w"].to_numpy(), ~te["near"].to_numpy()
    sel = metrics.index[metrics["selected"]][0]
    colors = dict(zip(preds, ["#9e9e9e", "#8d6e63", "#7e57c2", "#1e88e5", "#c62828", "#2e7d32"]))
    fig, axes = plt.subplots(1, 3, figsize=(18, 5.2))
    for ax, mask, title, col in [(axes[0], np.ones_like(far), "all land cells", "PR_AUC"),
                                 (axes[1], far, "new ignitions (no fire within ~1 deg for 7 days)",
                                  "new_ignition_PR_AUC")]:
        for name, p in preds.items():
            if np.nanstd(p[mask]) == 0:
                continue
            pr, rc, _ = precision_recall_curve(y[mask], p[mask], sample_weight=w[mask])
            ax.plot(rc, pr, color=colors[name], lw=2.4 if name == sel else 1.2,
                    label=f"{name} (AP {metrics.loc[name, col]:.3f})")
        ax.set_xlabel("recall (share of burning cells found)")
        ax.set_ylabel("precision (share of flagged cells that burned)")
        ax.set_title(f"Precision-recall on held-out days: {title}", loc="left", fontsize=10)
        ax.legend(fontsize=7, frameon=False, loc="upper right")
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1.02)
        _clean(ax)
    p = preds[sel]
    bins = np.array([0, 0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0])
    idx = np.clip(np.digitize(p, bins) - 1, 0, len(bins) - 2)
    mp = [np.average(p[idx == b], weights=w[idx == b]) if (idx == b).any() else np.nan for b in range(len(bins) - 1)]
    ob = [np.average(y[idx == b], weights=w[idx == b]) if (idx == b).any() else np.nan for b in range(len(bins) - 1)]
    a = axes[2]
    a.plot([0, 1], [0, 1], ls="--", color="#bdbdbd", lw=1, label="perfect calibration")
    a.plot(mp, ob, marker="o", color="#c62828", lw=2, label=sel)
    a.set_xlabel("predicted probability")
    a.set_ylabel("observed fire frequency")
    a.set_title("Calibration on held-out days", loc="left", fontsize=10)
    a.legend(frameon=False, fontsize=8)
    _clean(a)
    fig.tight_layout()
    fig.savefig(out / "05_model_evaluation.png", dpi=130)
    plt.close(fig)

    imp = importance.head(20)[::-1]
    gcol = {"fire history": "#e64a19", "weather": "#1e88e5", "location/season": "#8d6e63"}
    fig, ax = plt.subplots(figsize=(10, 7))
    ax.barh([f"{f}: {d}" for f, d in zip(imp["feature"], imp["description"])], imp["importance"],
            xerr=imp["std"], color=[gcol[g] for g in imp["group"]])
    for g, c in gcol.items():
        ax.barh([imp["feature"].iloc[0] + ": " + imp["description"].iloc[0]], [0], color=c, label=g)
    ax.legend(frameon=False, loc="lower right")
    ax.set_xlabel("drop in PR-AUC when the feature is shuffled")
    ax.set_title("What drives the forecast (permutation importance, boosting model)", loc="left")
    _clean(ax)
    fig.tight_layout()
    fig.savefig(out / "06_feature_importance.png", dpi=130)
    plt.close(fig)

    # empirical fire frequency vs weather (training data; weights restore the true frequencies)
    fig, axes = plt.subplots(1, 3, figsize=(17, 4.5))
    for ax, col, bins, lab in [(axes[0], "vpdmax", [0, .5, 1, 1.5, 2, 2.5, 3, 4, 5, 8], "max VPD, kPa"),
                               (axes[1], "days_since_rain", [0, 1, 2, 4, 7, 10, 15, 20, 25, 31],
                                "days since >= 2 mm rain"),
                               (axes[2], "rhmin", [0, 10, 20, 30, 40, 50, 60, 70, 80, 101], "min relative humidity, %")]:
        for near, color, lab2 in [(True, "#e64a19", "near recent fires"),
                                  (False, "#1e88e5", "far from recent fires (x10)")]:
            d = data[data["near"] == near]
            b = pd.cut(d[col], bins, include_lowest=True)
            gsum = d.assign(yw=d["y"] * d["w"]).groupby(b, observed=True)[["yw", "w"]].sum()
            freq = gsum["yw"] / gsum["w"] * (1 if near else 10)
            ax.plot([iv.mid for iv in freq.index], freq.to_numpy(), marker="o", color=color, label=lab2)
        ax.set_xlabel(lab)
        ax.set_ylabel("share of cells burning in the next 24 h")
        ax.legend(frameon=False, fontsize=8)
        _clean(ax)
    axes[0].set_title("Fire weather: observed fire frequency vs. conditions", loc="left")
    fig.tight_layout()
    fig.savefig(out / "08_fire_vs_weather.png", dpi=130)
    plt.close(fig)


def plot_forecast(fc, polys, title, out: Path):
    fig, ax = plt.subplots(figsize=(14, 7))
    _borders(ax, polys)
    show = fc[fc["probability"] >= 0.02].sort_values("probability")
    sc = ax.scatter(show["lon"], show["lat"], c=show["probability"], s=2.5, cmap="YlOrRd", vmin=0, vmax=1,
                    linewidths=0, zorder=2)
    fig.colorbar(sc, ax=ax, shrink=0.7, label="probability of fire in the cell")
    ax.set_xlim(fc["lon"].min() - 2, fc["lon"].max() + 2)
    ax.set_ylim(fc["lat"].min() - 2, fc["lat"].max() + 2)
    ax.set_aspect("equal")
    ax.set_title(title, loc="left")
    fig.tight_layout()
    fig.savefig(out / "07_forecast_map.png", dpi=130)
    plt.close(fig)


def _jsonable(v):
    if isinstance(v, (bool, np.bool_)):
        return bool(v)
    if isinstance(v, (int, np.integer)):
        return int(v)
    if isinstance(v, (float, np.floating)):
        return round(float(v), 3)
    return v


def write_html_map(X_by, probs, country_names, recent, tau, info, out: Path):
    """Write the interactive map: one probability per square and forecast day, plus weather, as columns."""
    ks = sorted(probs)
    P = np.stack([probs[k] for k in ks])
    keep = np.nonzero(P.max(axis=0) >= CONFIG["map_min_prob"])[0]
    X0 = X_by[0]
    codes, names = pd.factorize(pd.Series(np.asarray(country_names)[keep]).fillna("Unassigned"))

    def col(x, scale=1):
        return np.round(np.asarray(x)[keep] * scale).astype(int).tolist()

    data = {
        "lat": np.round(X0["lat"].to_numpy()[keep], 3).tolist(), "lon": np.round(X0["lon"].to_numpy()[keep], 3).tolist(),
        "cty": codes.tolist(), "countries": [str(n) for n in names],
        "det": col(X0["c_lag1"]), "fresh": col(~X0["near"].to_numpy()), "rain7": col(X0["precip_7d"], 10),
        "dsr": col(X0["days_since_rain"]),
        "p": [col(probs[k], 1000) for k in ks],
        "tmax": [col(X_by[k]["tmax"], 10) for k in ks], "rh": [col(X_by[k]["rhmin"]) for k in ks],
        "wind": [col(X_by[k]["wsmax"], 10) for k in ks],
    }
    days = [{"from": f"{tau + pd.Timedelta(days=k):%Y-%m-%dT%H:%M:%S}Z",
             "to": f"{tau + pd.Timedelta(days=k + 1):%Y-%m-%dT%H:%M:%S}Z"} for k in ks]
    pts = [[round(a, 3), round(b, 3), round(f, 1)] for a, b, f in zip(recent["lat"], recent["lon"], recent["frp"])]
    meta = {
        "days": days,
        "rows": [["Model", info["model"]]]
        + [[f"Day {k + 1}: ROC-AUC / PR-AUC", f"{m['roc']:.3f} / {m['pr']:.3f}"] for k, m in sorted(info["leads"].items())]
        + [["Weather", f"NOAA GFS {info['cycle']:%Y-%m-%d %HZ}"],
           ["Fire data up to", f"{info['data_to']:%Y-%m-%d %H:%M} UTC"],
           ["Grid", f"{CONFIG['grid_res_deg']}° cells"]],
    }
    borders = [[[round(float(y), 2), round(float(x), 2)] for x, y in ring] for _, ring, _ in static_layers(Grid(CONFIG["grid_res_deg"]))[2]]
    (out / "forecast_map.html").write_text(render_map_html(data, pts, borders, meta), encoding="utf-8")


def render_map_html(data, pts, borders, meta) -> str:
    """Fill map_template.html with the data (plain token replacement, so the template stays real HTML/JS)."""
    fill = {"__DATA__": data, "__PTS__": pts, "__BORDERS__": borders, "__META__": meta,
            "__COLORS__": RISK_COLORS, "__RES__": CONFIG["grid_res_deg"]}
    html = MAP_TEMPLATE.read_text(encoding="utf-8")
    for token, value in fill.items():
        html = html.replace(token, json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    return html


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------
def cmd_train(args):
    import joblib
    t_start = time.time()
    tag = getattr(args, "tag", "")
    out = Path(args.out) / f"exp_{tag}" if tag else Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    model_path = MODELS / f"fire_model_{tag}.joblib" if tag else MODEL_PATH
    step, neg_near, neg_far = args.step, args.neg_near, args.neg_far
    print(f"Training setup: every {step} day(s), non-burning cells kept {neg_near:.1%} near fires / "
          f"{neg_far:.1%} far" + (f"  [experiment '{tag}']" if tag else ""))
    grid = Grid(CONFIG["grid_res_deg"])
    print(f"[1/6] Fire history ({args.days} days, VIIRS NOAA-20 + NOAA-21)")
    country, names, polys = static_layers(grid)
    static = static_source_mask(grid)
    if args.days >= PERSIST_MIN_HISTORY:
        build_persistent_sources(fire_paths(args.days, args))
    hist, det = load_fire_history(args.days, args, grid, static, CONFIG["history_days"])
    print(f"  history {from_hour(hist.first_hour):%Y-%m-%d} .. {from_hour(hist.last_hour):%Y-%m-%d %H:%M} UTC, "
          f"{len(hist.hour):,} burning (hour, cell) records")

    print(f"[2/6] Analytics ({len(det):,} detections since {det['time'].min():%Y-%m-%d})")
    daily, by_country, hot = analytics(det, grid, country, names, out, polys)
    print(daily[["detections", "total_frp_GW", "active_cells", "night_share"]].tail(10).round(2).to_string())
    print("\nTop 10 countries:")
    print(by_country.head(10).round(2).to_string())

    print("\n[3/6] Weather (NOAA GFS) and land fields")
    del det
    leads = sorted(set(args.leads))
    static_wx = gw.static_fields(DATA / "gfs")
    clim = CONFIG["clim_days"]
    first_day = from_hour(hist.first_hour).normalize() + pd.Timedelta(days=1)
    last_day = from_hour(hist.last_hour).normalize()
    all_days = pd.date_range(first_day + pd.Timedelta(days=clim), last_day - pd.Timedelta(days=1))
    ok_days = [d for d in all_days if to_hour(d) + 24 <= hist.last_hour - 2]  # target window fully observed
    wx_cache = DATA / "gfs"
    missing = set(gw.ensure_daily(pd.date_range(first_day, ok_days[-1]), wx_cache, parallel_days=4))
    wx = gw.DailyWeather(wx_cache)
    # Thin only the training days; the held-out days stay daily and are sampled with the default rates,
    # so experiments with different --step / --neg-* settings are scored on exactly the same test rows.
    n_test = CONFIG["test_days"]
    plan = {}
    for k in leads:
        # a lead-k sample uses the weather of day d+k and needs the window d+k fully observed
        cs = [d for d in all_days if to_hour(d) + 24 * (k + 1) <= hist.last_hour - 2
              and d not in missing and d + pd.Timedelta(days=k) not in missing]
        plan[k] = (cs[:-n_test][::-1][::step][::-1] + cs[-n_test:], set(cs[-n_test:]))
        print(f"  lead {k} (day {k + 1}): {len(plan[k][0]) - n_test} training + {n_test} test cutoffs, "
              f"{plan[k][0][0]:%Y-%m-%d} .. {plan[k][0][-1]:%Y-%m-%d}")
    in_plan = {k: set(c) for k, (c, _) in plan.items()}

    print("[4/6] Building the (cell, cutoff) data sets (saved to disk, one lead at a time is trained)")
    cells_all = land_cells(grid, country, np.unique(hist.cell), args.bbox, static)
    # held-out days are scored on the cells a standard (history_days) run would use, whatever --days is
    _, recent_cells, _ = hist.slice(hist.last_hour - 24 * CONFIG["history_days"], hist.last_hour + 1)
    cells_test = land_cells(grid, country, np.unique(recent_cells), args.bbox, static)
    frames_dir = DATA / "frames" / (tag or "prod")
    shutil.rmtree(frames_dir, ignore_errors=True)
    frames_dir.mkdir(parents=True)
    days_all = sorted(set().union(*in_plan.values()))
    for n, d in enumerate(days_all, 1):
        maps = fire_maps(hist, to_hour(d), grid, clim, with_target=False)
        past = wx.antecedent(d, clim)
        # one draw per grid cell and day, identical in every run
        r_all = np.random.default_rng(int(d.strftime("%Y%m%d"))).random(grid.ny * grid.nx, dtype=np.float32)
        for k in leads:
            if d not in in_plan[k]:
                continue
            is_test = d in plan[k][1]
            cells = cells_test if is_test else cells_all
            i, j = np.divmod(cells, grid.nx)
            y = target_map(hist, to_hour(d), k, grid)[i, j] > 0
            near = maps["n9_active7"][i, j] > 0
            rate_near, rate_far = ((CONFIG["neg_rate_near"], CONFIG["neg_rate_far"]) if is_test
                                   else (neg_near, neg_far))
            r = r_all[cells]
            keep = y | (near & (r < rate_near)) | (~near & (r < rate_far))
            w = np.where(y, 1.0, np.where(near, 1 / rate_near, 1 / rate_far))
            df = make_rows(maps, cells[keep], grid, d, wx.load(d + pd.Timedelta(days=k)), past,
                           lead=k, static_wx=static_wx)
            df["y"], df["w"], df["date"] = y[keep].astype(np.int8), w[keep].astype(np.float32), d
            df.to_pickle(frames_dir / f"L{k}_{d:%Y%m%d}.pkl")
        if n % 10 == 0:
            print(f"    {n}/{len(days_all)} cutoffs")

    print("[5/6] Training and validating models")
    bundle_leads = {}
    for k in leads:
        files = sorted(frames_dir.glob(f"L{k}_*.pkl"))
        data = pd.concat([pd.read_pickle(f) for f in files], ignore_index=True)
        wpos = (data["y"] * data["w"]).sum() / data["w"].sum()
        print(f"\n--- lead {k}: forecast day {k + 1} ---")
        print(f"  {len(data):,} rows ({int(data['y'].sum()):,} burning); share of land cells burning per 24 h: "
              f"{wpos:.2%}; new-ignition positives: {int((data['y'].astype(bool) & ~data['near']).sum()):,}")
        members, best, metrics, importance, eval_data = train_models(data, light=k > 0)
        print("\nHeld-out performance (weighted to the true class balance):")
        print(metrics.round(4).to_string())
        metrics.to_csv(out / f"model_metrics_lead{k}.csv")
        if k == 0:
            print("\nTop features:")
            print(importance.head(12)[["feature", "group", "importance", "description"]].round(4).to_string(index=False))
            plot_model(metrics, eval_data, importance, data, out)
            metrics.to_csv(out / "model_metrics.csv")
            importance.to_csv(out / "feature_importance.csv", index=False)
        sel = metrics.loc[best]
        bundle_leads[k] = {"members": members, "name": best,
                           "metrics": {"roc": sel["ROC_AUC"], "pr": sel["PR_AUC"], "brier": sel["Brier"],
                                       "roc_new": sel["new_ignition_ROC_AUC"], "pr_new": sel["new_ignition_PR_AUC"]},
                           "train_rows": int((~data["date"].isin(list(plan[k][1]))).sum())}
        del data, eval_data, members

    MODELS.mkdir(exist_ok=True)
    first = bundle_leads[leads[0]]
    joblib.dump({"members": first["members"], "name": first["name"], "features": FEATURES, "leads": bundle_leads,
                 "config": dict(CONFIG, neg_rate_near=neg_near, neg_rate_far=neg_far, cutoff_step=step),
                 "trained": pd.Timestamp.now(tz="UTC"), "cutoffs": (days_all[0], days_all[-1]),
                 "metrics": first["metrics"], "train_rows": first["train_rows"],
                 "fire_cells": np.unique(hist.cell)}, model_path, compress=3)
    if not args.keep_frames:
        shutil.rmtree(frames_dir, ignore_errors=True)
    print(f"\n[6/6] Model saved to {model_path}  (total {time.time() - t_start:.0f}s)")
    print("Next: python fire_forecast.py predict")


def verify_archive(arch: Path, hist: FireHistory, grid: Grid, out: Path):
    """Score archived forecasts (every forecast day) whose 24 h window is now fully observed."""
    log = out / "verification.csv"
    done = pd.read_csv(log) if log.exists() else pd.DataFrame()
    if len(done) and "lead" not in done:
        done["lead"] = 0
    seen = set(zip(done["forecast_file"], done["lead"])) if len(done) else set()
    rows = []
    for f in sorted(arch.glob("forecast_*.npz")):
        z = np.load(f)
        for k in range(0, 8):
            key = "prob" if k == 0 else f"prob{k}"
            if key not in z.files or (f.name, k) in seen:
                continue
            th = int(z["tau_h"]) + 24 * k
            if th + 24 > hist.last_hour - 2 or th < hist.first_hour:
                continue
            _, tc, _ = hist.slice(th, th + 24)
            burn = np.zeros(grid.ny * grid.nx, bool)
            burn[tc] = True
            y, p = burn[z["cells"]], z[key].astype(np.float32)
            rows.append({"forecast_file": f.name, "lead": k, "valid_from_utc": from_hour(th), "cells": len(y),
                         "burning_cells": int(y.sum()), "expected_cells": float(p.sum()),
                         "ROC_AUC": roc_auc_score(y, p), "PR_AUC": average_precision_score(y, p),
                         "Brier": brier_score_loss(y, p)})
    if rows:
        done = pd.concat([done, pd.DataFrame(rows)], ignore_index=True)
        done.to_csv(log, index=False)
    return done if len(done) else None


def cmd_predict(args):
    import joblib
    t0 = time.time()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    if not MODEL_PATH.exists():
        raise SystemExit("no trained model - run: python fire_forecast.py train")
    bundle = joblib.load(MODEL_PATH)
    leads = bundle.get("leads") or {0: {"members": bundle["members"], "name": bundle["name"],
                                        "metrics": bundle["metrics"]}}
    grid = Grid(bundle["config"]["grid_res_deg"])
    clim = bundle["config"]["clim_days"]
    country, names, polys = static_layers(grid)

    static = static_source_mask(grid)
    det = drop_static(load_fire_data(clim + 2, args), grid, static)
    hist = FireHistory(det, grid)
    tau_h = hist.last_hour - CONFIG["latency_hours"]
    tau = from_hour(tau_h)
    t_fire = time.time()

    window, cycle = gw.latest_window(tau)
    static_wx = gw.static_fields(DATA / "gfs")
    gw.ensure_daily(pd.date_range(tau.normalize() - pd.Timedelta(days=clim), tau.normalize() - pd.Timedelta(days=1)),
                    DATA / "gfs", parallel_days=4)
    past = gw.DailyWeather(DATA / "gfs").antecedent(tau.normalize(), clim)
    t_wx = time.time()

    # forecast over land only: offshore detections are platforms / ships, not vegetation fires
    cells = land_cells(grid, country, None, args.bbox, static)
    maps = fire_maps(hist, tau_h, grid, clim, with_target=False)
    X_by, probs = {}, {}
    for k in sorted(leads):  # all forecast days use the same GFS run
        win_k = window if k == 0 else gw.window_for_cycle(cycle, tau + pd.Timedelta(days=k))
        X_by[k] = make_rows(maps, cells, grid, tau, win_k, past, lead=k, static_wx=static_wx)
        probs[k] = predict_members(leads[k]["members"], X_by[k])
    X, p = X_by[0], probs[0]
    t_model = time.time()

    valid_to = tau + pd.Timedelta(hours=24)
    fc_country = country_of(cells, country, names)
    fc = pd.DataFrame({
        "valid_from_utc": tau, "valid_to_utc": valid_to, "lat": X["lat"].round(3), "lon": X["lon"].round(3),
        "country": fc_country, "probability": p.round(4), "risk_class": _risk_class(p),
        **{f"prob_day{k + 1}": probs[k].round(4) for k in sorted(probs) if k > 0},
        "new_ignition": ~X["near"].to_numpy(), "detections_last_24h": X["c_lag1"].astype(int),
        "burn_days_30": X["burn_days_30"].astype(int), "tmax_C": X["tmax"].round(1),
        "rhmin_pct": X["rhmin"].round(0), "vpdmax_kPa": X["vpdmax"].round(2), "wind_max_ms": X["wsmax"].round(1),
        "rain_24h_mm": X["precip_24h"].round(1), "rain_7d_mm": X["precip_7d"].round(1),
        "days_since_rain": X["days_since_rain"].astype(int),
    }).sort_values("probability", ascending=False)
    fc[fc[[c for c in fc.columns if c.startswith("prob")]].max(axis=1) >= 0.01].to_csv(out / "forecast_latest.csv", index=False)
    fc["p_new"] = np.where(fc["new_ignition"], fc["probability"], 0.0)
    by_c = (fc.groupby("country")
            .agg(expected_burning_cells=("probability", "sum"),
                 very_high_cells=("probability", lambda s: int((s >= 0.6).sum())),
                 expected_new_ignitions=("p_new", "sum"))
            .sort_values("expected_burning_cells", ascending=False))
    by_c.round(1).to_csv(out / "forecast_by_country.csv")

    arch = out / "archive"
    arch.mkdir(exist_ok=True)
    np.savez_compressed(arch / f"forecast_{tau:%Y%m%dT%H}.npz", cells=cells.astype(np.int32),
                        prob=p.astype(np.float16), tau_h=tau_h,
                        **{f"prob{k}": probs[k].astype(np.float16) for k in sorted(probs) if k > 0})
    verified = verify_archive(arch, hist, grid, out)

    recent = det[det["time"] >= tau - pd.Timedelta(hours=24)]
    info = dict(bundle["metrics"], model=bundle["name"], cycle=cycle, data_to=from_hour(hist.last_hour + 1),
                leads={k: leads[k]["metrics"] for k in leads})
    title = (f"Fire probability {tau:%Y-%m-%d %H:%M} .. {valid_to:%Y-%m-%d %H:%M} UTC "
             f"(weather: GFS {cycle:%Y-%m-%d %HZ})")
    plot_forecast(fc, polys, title, out)
    write_html_map(X_by, probs, fc_country, recent, tau, info, out)
    if args.analytics:
        analytics(det[det["time"] >= det["time"].max() - pd.Timedelta(days=7)], grid, country, names, out, polys)

    print(f"\nForecast window: {tau:%Y-%m-%d %H:%M} -> {valid_to:%Y-%m-%d %H:%M} UTC | fire data up to "
          f"{from_hour(hist.last_hour + 1):%Y-%m-%d %H:%M} UTC | weather GFS {cycle:%Y-%m-%d %HZ}")
    print(f"Model: {bundle['name']} (trained {bundle['trained']:%Y-%m-%d})")
    print(f"Land cells scored: {len(fc):,} | expected burning cells: {fc['probability'].sum():,.0f} "
          f"(new ignitions: {fc['p_new'].sum():,.0f})")
    print("Cells by risk class:", fc["risk_class"].value_counts().reindex(RISK_COLORS).fillna(0).astype(int).to_dict())
    print("\nTop countries (expected burning cells):")
    print(by_c.head(12).round(1).to_string())
    print("\nHighest new-ignition risk (no fire within ~1 deg this week):")
    print(fc[fc["new_ignition"]].head(8)[["lat", "lon", "country", "probability", "tmax_C", "rhmin_pct",
                                         "wind_max_ms", "days_since_rain"]].to_string(index=False))
    if verified is not None:
        print("\nVerification of past forecasts:")
        print(verified.tail(5).round(3).to_string(index=False))
    print(f"\nTimings: fire data {t_fire - t0:.0f}s, weather {t_wx - t_fire:.0f}s, "
          f"features+model {t_model - t_wx:.0f}s, total {time.time() - t0:.0f}s")
    print(f"Outputs: {out / 'forecast_map.html'}  {out / 'forecast_latest.csv'}")


def monthly_burn_days(days: int, args, grid: Grid, static: np.ndarray):
    """Share of days with a detection per (calendar month, cell), for every complete month of the history."""
    groups = {}
    for pth in fire_paths(days, args):
        try:
            start = pd.Timestamp(pth.stem.split("_")[-2])
        except ValueError:
            raise SystemExit("the seasonal view needs the FIRMS API key (FIRMS_MAP_KEY)")
        groups.setdefault((start - EPOCH).days // 30, []).append(pth)
    N = grid.ny * grid.nx
    keys, t_min, t_max = [], None, None
    for k, key in enumerate(sorted(groups), 1):
        det = firms_fetch.load_detections(groups[key], CONFIG["min_confidence"])
        det = drop_static(det, grid, static, quiet=True)
        t_min = det["time"].min() if t_min is None else min(t_min, det["time"].min())
        t_max = det["time"].max() if t_max is None else max(t_max, det["time"].max())
        day = (det["time"].dt.floor("D") - EPOCH).dt.days.to_numpy(np.int64)
        keys.append(np.unique(day * N + grid.cell(det["lat"], det["lon"])))
        del det
        if k % 6 == 0 or k == len(groups):
            print(f"    {k}/{len(groups)} months read")
    keys = np.unique(np.concatenate(keys))
    day, cell = keys // N, keys % N
    last_full = t_max.floor("D") - pd.Timedelta(days=1)         # the newest day may be incomplete
    first_day = max(t_min.floor("D"), last_full - pd.Timedelta(days=days))
    when = EPOCH + pd.to_timedelta(day, unit="D")
    ym = (when.year * 12 + when.month - 1).to_numpy()
    out = {}
    for m in np.unique(ym):
        start = pd.Timestamp(int(m) // 12, int(m) % 12 + 1, 1)
        end = start + pd.offsets.MonthEnd(0)
        if start < first_day or end > last_full:
            continue                                              # partial month: skip
        out[int(m)] = (np.bincount(cell[ym == m], minlength=N) / end.day).astype(np.float32)
    return out, first_day, last_full


MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def cmd_climate(args):
    """Month / season / year view: how fire activity moves through the year and how it changed vs the year before."""
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    grid = Grid(CONFIG["grid_res_deg"])
    country, names, polys = static_layers(grid)
    static = static_source_mask(grid)
    if args.days >= PERSIST_MIN_HISTORY:
        build_persistent_sources(fire_paths(args.days, args))
    print(f"[1/2] Burning days per month ({args.days} days of VIIRS fire detections)")
    cache = DATA / "climate_months.npz"
    if args.reuse and cache.exists():
        with np.load(cache) as z:
            months = {int(k[1:]): z[k] for k in z.files if k.startswith("m")}
            first_day, last_full = pd.Timestamp(str(z["first"])), pd.Timestamp(str(z["last"]))
        print("  reusing the saved monthly tables (data/climate_months.npz)")
    else:
        months, first_day, last_full = monthly_burn_days(args.days, args, grid, static)
        np.savez_compressed(cache, first=str(first_day), last=str(last_full), **{f"m{k}": v for k, v in months.items()})
    yms = sorted(months)
    if len(yms) < 12:
        raise SystemExit(f"need at least 12 complete months, found {len(yms)}: use --days 760")
    recent = yms[-12:]
    before = yms[-24:-12] if len(yms) >= 24 else []
    label = lambda y: (f"{MONTH_NAMES[y[0] % 12]} {y[0] // 12} - {MONTH_NAMES[y[-1] % 12]} {y[-1] // 12}")
    print(f"  recent 12 months: {label(recent)}" + (f" | the year before: {label(before)}" if before else ""))
    N = grid.ny * grid.nx
    PB = np.zeros((12, N), np.float32)
    PA = np.zeros((12, N), np.float32)
    for y in recent:
        PB[y % 12] = months[y]
    for y in before:
        PA[y % 12] = months[y]
    ever = np.nonzero((PB.max(0) > 0) | (PA.max(0) > 0))[0]
    cells = land_cells(grid, country, ever, args.bbox, static)

    print("[2/2] Writing the map")
    pb, pa = PB[:, cells], PA[:, cells]
    both = np.maximum(pb.max(0), pa.max(0))
    keep = np.nonzero(both >= CONFIG["map_min_prob"])[0]
    lat, lon = grid.center(cells)
    cnames = np.asarray(country_of(cells, country, names))
    codes, uniq = pd.factorize(pd.Series(cnames[keep]).fillna("Unassigned"))

    def mat(a):
        return [np.round(a[m][keep] * 1000).astype(int).tolist() for m in range(12)]

    data = {"lat": np.round(lat[keep], 3).tolist(), "lon": np.round(lon[keep], 3).tolist(),
            "cty": codes.tolist(), "countries": [str(n) for n in uniq],
            "B": mat(pb), "A": mat(pa) if before else None}
    totals = {"B": [round(float(pb[m].sum()), 1) for m in range(12)],
              "A": [round(float(pa[m].sum()), 1) for m in range(12)] if before else None}
    meta = {"recent": label(recent), "before": label(before) if before else None, "totals": totals,
            "now_month": int(pd.Timestamp.now(tz="UTC").month) - 1,
            "rows": [["Fire data", f"NASA FIRMS VIIRS, {first_day:%Y-%m-%d} to {last_full:%Y-%m-%d}"],
                     ["Months used", f"{len(yms)} complete months"],
                     ["Grid", f"{CONFIG['grid_res_deg']}° cells"]]}
    borders = [[[round(float(y), 2), round(float(x), 2)] for x, y in ring] for _, ring, _ in polys]
    html = CLIMATE_TEMPLATE.read_text(encoding="utf-8")
    fill = {"__DATA__": data, "__BORDERS__": borders, "__META__": meta, "__RES__": CONFIG["grid_res_deg"]}
    for token, value in fill.items():
        html = html.replace(token, json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    (out / "climate_map.html").write_text(html, encoding="utf-8")
    pd.DataFrame({"month": MONTH_NAMES, "burning_squares_recent": totals["B"],
                  "burning_squares_before": totals["A"] if before else np.nan}).to_csv(out / "climate_by_month.csv", index=False)
    print(f"  {len(keep):,} squares on the map. Saved {out / 'climate_map.html'} and climate_by_month.csv")


def cmd_backtest(args):
    """Score the next-24 h model in blocks spread over the whole history (needs ``train --keep-frames``)."""
    tag = args.tag or "prod"
    files = sorted((DATA / "frames" / tag).glob("L0_*.pkl"))
    if not files:
        raise SystemExit(f"no saved training data for '{tag}': run  train --days 760 --keep-frames  first")
    cols = FEATURES + ["y", "w", "date", "near"]
    data = pd.concat([pd.read_pickle(f)[cols] for f in files], ignore_index=True)
    dates = np.sort(data["date"].unique())
    d0, d1 = pd.Timestamp(dates[0]), pd.Timestamp(dates[-1])
    span, gap = args.block_days, 30
    starts = pd.date_range(d0 + pd.Timedelta(days=gap), d1 - pd.Timedelta(days=span), periods=args.blocks).normalize()
    rng = np.random.default_rng(3)
    rows = []
    for s0 in starts:
        e0 = s0 + pd.Timedelta(days=span)
        is_te = ((data["date"] >= s0) & (data["date"] < e0)).to_numpy()
        far_gap = ((data["date"] < s0 - pd.Timedelta(days=gap)) | (data["date"] >= e0 + pd.Timedelta(days=gap))).to_numpy()
        te, tr_idx = data[is_te], np.nonzero(far_gap)[0]
        if len(te) == 0 or te["y"].sum() == 0 or len(tr_idx) < 100_000:
            continue
        tr_idx = np.sort(rng.choice(tr_idx, size=min(len(tr_idx), args.train_rows), replace=False))
        tr = data.iloc[tr_idx]
        t0 = time.time()
        m = HistGradientBoostingClassifier(**dict(CONFIG["hgb"], max_iter=300, learning_rate=0.1)).fit(
            tr[FEATURES], tr["y"].to_numpy(), sample_weight=tr["w"].to_numpy())
        p = m.predict_proba(te[FEATURES])[:, 1]
        y, w = te["y"].to_numpy(), te["w"].to_numpy()
        sc, base = _scores(y, p, w), _scores(y, (te["burn_days_7"] / 7).to_numpy(), w)
        far = ~te["near"].to_numpy()
        sn = _scores(y[far], p[far], w[far]) if far.any() and y[far].sum() else {"ROC_AUC": np.nan}
        rows.append({"from": f"{s0:%Y-%m-%d}", "to": f"{e0 - pd.Timedelta(days=1):%Y-%m-%d}", "month": f"{s0 + pd.Timedelta(days=span // 2):%b %Y}",
                     "burning_share": float((y * w).sum() / w.sum()), "model_PR_AUC": sc["PR_AUC"],
                     "baseline_PR_AUC": base["PR_AUC"], "model_ROC_AUC": sc["ROC_AUC"], "Brier": sc["Brier"],
                     "new_ignition_ROC_AUC": sn["ROC_AUC"]})
        print(f"  {rows[-1]['from']} .. {rows[-1]['to']}: PR-AUC {sc['PR_AUC']:.3f} (7-day baseline {base['PR_AUC']:.3f}), "
              f"ROC-AUC {sc['ROC_AUC']:.3f}  [{time.time() - t0:.0f}s]")
    res = pd.DataFrame(rows)
    out = Path(args.out)
    res.to_csv(out / "seasonal_backtest.csv", index=False)
    print("\n" + res.round(3).to_string(index=False))
    fig, ax = plt.subplots(figsize=(9, 4))
    x = np.arange(len(res))
    ax.bar(x - 0.2, res["baseline_PR_AUC"], 0.4, label="7-day burn frequency", color="#9aa1ac")
    ax.bar(x + 0.2, res["model_PR_AUC"], 0.4, label="model", color="#ef4444")
    ax.set_xticks(x, res["month"], rotation=30)
    ax.set_ylabel("PR-AUC")
    ax.set_title("Next-24 h forecast quality by season (blocks the model did not train on)")
    ax.legend()
    fig.tight_layout()
    fig.savefig(out / "09_seasonal_backtest.png", dpi=130)
    plt.close(fig)
    print(f"\nSaved {out / 'seasonal_backtest.csv'} and 09_seasonal_backtest.png")


def main():
    firms_fetch.load_env(ROOT / ".env")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    bt = sub.add_parser("backtest", help="quality by season on the saved training data")
    bt.add_argument("--tag", default="", help="experiment tag of the training run (default: production run)")
    bt.add_argument("--blocks", type=int, default=8)
    bt.add_argument("--block-days", type=int, default=21)
    bt.add_argument("--train-rows", type=int, default=1_500_000)
    bt.add_argument("--out", default=str(ROOT / "output" / "firms"))
    for name in ("train", "predict", "climate"):
        sp = sub.add_parser(name)
        sp.add_argument("--map-key", default=None, help="FIRMS MAP_KEY (default: env FIRMS_MAP_KEY / .env)")
        sp.add_argument("--bbox", nargs=4, type=float, metavar=("W", "S", "E", "N"),
                        help="restrict cells to a region, e.g. -11 35 30 60 (Europe)")
        sp.add_argument("--offline", action="store_true", help="use cached fire data only")
        sp.add_argument("--out", default=str(ROOT / "output" / "firms"))
        if name == "train":
            sp.add_argument("--days", type=int, default=CONFIG["history_days"])
            sp.add_argument("--step", type=int, default=1,
                            help="use every N-th day as a training cutoff (held-out test days are always daily)")
            sp.add_argument("--neg-near", type=float, default=CONFIG["neg_rate_near"],
                            help="share of non-burning cells near fires kept for training")
            sp.add_argument("--neg-far", type=float, default=CONFIG["neg_rate_far"],
                            help="share of non-burning cells far from fires kept for training")
            sp.add_argument("--leads", type=int, nargs="+", default=CONFIG["leads"],
                            help="forecast days to train: 0 = next 24 h, 1 = the day after, ...")
            sp.add_argument("--keep-frames", action="store_true",
                            help="keep the saved training tables in data/frames (needed for 'backtest')")
            sp.add_argument("--tag", default="",
                            help="experiment name: saves models/fire_model_<tag>.joblib and <out>/exp_<tag>/ "
                                 "instead of replacing the production model")
        elif name == "climate":
            sp.add_argument("--days", type=int, default=760, help="history to use (two full years need 760)")
            sp.add_argument("--reuse", action="store_true", help="reuse the saved monthly tables (skips reading the fire files)")
        else:
            sp.add_argument("--every", type=float, default=0, help="repeat every N hours (near-real-time mode)")
            sp.add_argument("--analytics", action="store_true", help="also refresh the 7-day analytics charts")
    args = ap.parse_args()
    if args.cmd == "backtest":
        cmd_backtest(args)
    elif args.cmd == "climate":
        cmd_climate(args)
    elif args.cmd == "train":
        cmd_train(args)
    elif args.every > 0:
        while True:
            try:
                cmd_predict(args)
            except Exception as exc:  # keep the loop alive on transient network errors
                print(f"forecast failed: {exc}")
            nxt = pd.Timestamp.now(tz="UTC") + pd.Timedelta(hours=args.every)
            print(f"\nnext run at {nxt:%Y-%m-%d %H:%M} UTC (Ctrl+C to stop)")
            time.sleep(args.every * 3600)
    else:
        cmd_predict(args)


if __name__ == "__main__":
    import fire_forecast  # run through the module so saved models reference ``fire_forecast.*``

    fire_forecast.main()
