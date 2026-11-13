"""Download and normalise NASA FIRMS active-fire data.

Three ways to get data (all serve the same detections shown on
https://firms.modaps.eosdis.nasa.gov/map/):

1. ``nrt``     - public global CSV feeds, last 7 days, no key required (default).
2. ``api``     - FIRMS Area API, any number of past days. Needs a free MAP_KEY
                 (https://firms.modaps.eosdis.nasa.gov/api/map_key/), passed via
                 the FIRMS_MAP_KEY environment variable or --map-key.
3. ``country`` - yearly per-country archives (science-quality, includes the
                 ``type`` column that separates vegetation fires from volcanoes,
                 gas flares and other static sources). No key required.
"""
from __future__ import annotations

import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from pandas.api.types import union_categoricals

FIRMS_URL = "https://firms.modaps.eosdis.nasa.gov"

# Public 7-day global feeds (no key)
NRT_FEEDS = {
    "VIIRS_NOAA20_NRT": "data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_7d.csv",
    "VIIRS_NOAA21_NRT": "data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_7d.csv",
    "VIIRS_SNPP_NRT": "data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_7d.csv",
    "MODIS_NRT": "data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_7d.csv",
}
DEFAULT_SOURCES = ["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"]
API_MAX_DAYS_PER_CALL = 5

NATURAL_EARTH_COUNTRIES = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
                           "master/geojson/ne_110m_admin_0_countries.geojson")

HEADERS = {"User-Agent": "firms-fire-forecast/2.0 (research script)"}


def _download(url: str, dest: Path, max_age_hours: float = 3.0, timeout: int = 300) -> Path:
    """Download ``url`` to ``dest`` unless a fresh cached copy already exists."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and (time.time() - dest.stat().st_mtime) < max_age_hours * 3600:
        print(f"  cached   {dest.name}")
        return dest
    shown = url.split("/api/area/csv/")[0] + "/api/area/csv/<MAP_KEY>/" + url.split("/api/area/csv/")[1].split("/", 1)[1] if "/api/area/csv/" in url else url
    print(f"  download {shown}")
    for attempt in range(30):
        r = requests.get(url, headers=HEADERS, stream=True, timeout=timeout)
        if r.status_code == 400 and "transaction limit" in r.text:
            r.close()  # FIRMS API quota (5000 transactions / 10 min): wait and retry
            print(f"  FIRMS API quota reached, waiting 60 s ({dest.name})")
            time.sleep(60)
            continue
        break
    with r:
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code} for {shown}: {r.text[:200]}")
        tmp = dest.with_suffix(dest.suffix + ".part")
        with open(tmp, "wb") as fh:
            for chunk in r.iter_content(1 << 20):
                fh.write(chunk)
    tmp.replace(dest)
    return dest


def fetch_nrt(raw_dir: Path, sources=DEFAULT_SOURCES, offline: bool = False) -> list[Path]:
    """Public global 7-day near-real-time CSVs."""
    paths = []
    for src in sources:
        dest = raw_dir / Path(NRT_FEEDS[src]).name
        if offline:
            if not dest.exists():
                raise FileNotFoundError(f"{dest} missing; run without --offline first")
            paths.append(dest)
        else:
            paths.append(_download(f"{FIRMS_URL}/{NRT_FEEDS[src]}", dest))
    return paths


def load_env(path: Path) -> None:
    """Read KEY=VALUE lines from a local .env file into os.environ (if not already set)."""
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def fetch_api(raw_dir: Path, map_key: str, days: int, sources=DEFAULT_SOURCES,
              area: str = "world", end: date | None = None, workers: int = 2) -> list[Path]:
    """FIRMS Area API, at least ``days`` days ending at ``end`` (default: today, UTC).

    Requests are split into 5-day chunks aligned to a fixed calendar, so older
    chunks are downloaded once and reused by later runs; only the chunk that
    contains today is refreshed. ``area`` is ``world`` or ``west,south,east,north``.
    """
    end = end or pd.Timestamp.now(tz="UTC").date()
    start = end - timedelta(days=days - 1)
    epoch = date(2000, 1, 1)
    start -= timedelta(days=(start - epoch).days % API_MAX_DAYS_PER_CALL)
    tag = area.replace(",", "_")
    jobs = []
    for src in sources:
        d = start
        while d <= end:
            n = API_MAX_DAYS_PER_CALL
            dest = raw_dir / f"api_{src}_{tag}_{d}_{n}d.csv"
            url = f"{FIRMS_URL}/api/area/csv/{map_key}/{src}/{area}/{n}/{d}"
            # complete past chunks never change; the chunk that is still filling is refreshed
            age = 2.0 if d + timedelta(days=n) > end else 1e9
            if d + timedelta(days=n) > end and dest.exists() and \
                    (time.time() - dest.stat().st_mtime) / 86400 > (end - d).days + 1:
                age = 0  # was downloaded before the chunk's last day ended
            jobs.append((url, dest, age, src, d))
            d += timedelta(days=n)

    def one(job):
        url, dest, age, src, d = job
        _download(url, dest, max_age_hours=age)
        head = dest.read_text(encoding="utf-8", errors="ignore")[:200]
        if not head.startswith("latitude"):
            dest.unlink()
            raise RuntimeError(f"FIRMS API error for {src} {d}: {head.strip()}")
        return dest

    with ThreadPoolExecutor(workers) as ex:
        return list(ex.map(one, jobs))


def fetch_country(raw_dir: Path, country: str, year: int, product: str = "viirs-snpp") -> list[Path]:
    """Yearly archive for one country, e.g. country='Australia', product='viirs-snpp'|'modis'."""
    name = f"{product}_{year}_{country.replace(' ', '_')}.csv"
    url = f"{FIRMS_URL}/data/country/{product}/{year}/{name}"
    return [_download(url, raw_dir / name, max_age_hours=24 * 30)]


def fetch_static_archive(dest_dir: Path, year: int = 2025) -> Path | None:
    """Yearly global VIIRS S-NPP archive; its ``type`` column marks volcanoes (1),
    static land sources such as gas flares and industry (2) and offshore sources (3)."""
    name = f"viirs-snpp_{year}_all_countries.zip"
    try:
        return _download(f"{FIRMS_URL}/data/country/zips/{name}", dest_dir / name, max_age_hours=24 * 365)
    except Exception as exc:
        print(f"  warning: could not download the static-source archive ({exc})")
        return None


def fetch_countries_geojson(dest_dir: Path) -> Path | None:
    """Natural Earth 1:110m country polygons (used for country attribution and maps)."""
    try:
        return _download(NATURAL_EARTH_COUNTRIES, dest_dir / "ne_110m_admin_0_countries.geojson",
                         max_age_hours=24 * 365)
    except Exception as exc:  # maps still work without borders
        print(f"  warning: could not download country borders ({exc})")
        return None


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------
def _norm_confidence(s: pd.Series) -> pd.Series:
    """VIIRS uses l/n/h (or low/nominal/high); MODIS uses 0-100."""
    num = pd.to_numeric(s, errors="coerce")
    if num.notna().mean() > 0.9:
        return pd.Series(np.select([num < 30, num < 80], ["low", "nominal"], "high"), index=s.index)
    first = s.astype(str).str.strip().str.lower().str[0]
    return first.map({"l": "low", "n": "nominal", "h": "high"}).fillna("nominal")


def load_detections(paths, min_confidence: str = "nominal", vegetation_only: bool = True) -> pd.DataFrame:
    """Read FIRMS CSVs into one compact table (file by file, to keep memory low).

    Columns: lat, lon (float32), time (naive UTC datetime), satellite, confidence,
    daynight (categorical), frp (float32, MW).
    """
    keep_conf = {"low": {"low", "nominal", "high"}, "nominal": {"nominal", "high"}, "high": {"high"}}[min_confidence]
    cols = {"latitude", "longitude", "acq_date", "acq_time", "satellite", "confidence", "frp", "daynight", "type"}
    frames = []
    for p in paths:
        df = pd.read_csv(p, dtype={"acq_time": str, "satellite": "category", "daynight": "category"},
                         usecols=lambda c: c in cols)
        if df.empty:
            continue
        conf = _norm_confidence(df["confidence"])
        ok = conf.isin(keep_conf).to_numpy()
        if vegetation_only and "type" in df.columns:
            # 0 = presumed vegetation fire, 1 = volcano, 2 = static land source, 3 = offshore
            ok &= df["type"].to_numpy() == 0
        df, conf = df[ok], conf[ok]
        hhmm = pd.to_numeric(df["acq_time"], errors="coerce").fillna(0).astype(np.int32).to_numpy()
        time_ = (pd.to_datetime(df["acq_date"], format="%Y-%m-%d").to_numpy()
                 + ((hhmm // 100) * 60 + hhmm % 100).astype("timedelta64[m]"))
        frames.append(pd.DataFrame({
            "lat": df["latitude"].to_numpy(np.float32), "lon": df["longitude"].to_numpy(np.float32),
            "time": time_,
            "satellite": df["satellite"].astype(str).astype("category").to_numpy(),
            "confidence": pd.Categorical(conf.to_numpy(), categories=["low", "nominal", "high"]),
            "frp": pd.to_numeric(df["frp"], errors="coerce").fillna(0.0).to_numpy(np.float32),
            "daynight": pd.Categorical(df["daynight"].astype(str).to_numpy(), categories=["D", "N"]),
        }))
        del df, conf
    if not frames:
        raise ValueError("no detections loaded")
    sat = union_categoricals([f["satellite"].astype("category") for f in frames])
    for f in frames:
        f["satellite"] = pd.Categorical(f["satellite"].astype(str), categories=sat.categories)
    det = pd.concat(frames, ignore_index=True)
    del frames
    det = det.drop_duplicates(["lat", "lon", "time", "satellite"])
    return det.sort_values("time").reset_index(drop=True)
