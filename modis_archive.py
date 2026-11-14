"""Download the MODIS fire archive (Nov 2000 - 2026) from NASA FIRMS and reduce it to
burning days per month and 0.25 deg cell.

Uses the yearly global archive files of FIRMS (no key, no API quota). Each year is reduced right
after the download and the zip is deleted, so only a few MB per year stay on disk (data/modis_monthly/).
The run can be stopped and restarted: finished years are skipped.

    python modis_archive.py            # about 1.5 GB of downloads, ~15-30 min
"""
from __future__ import annotations

import sys
import time
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

import firms_fetch as ff

ROOT = Path(__file__).resolve().parent
RAW, OUT = ROOT / "data" / "modis_raw", ROOT / "data" / "modis_monthly"
RES = 0.25
NX, NY = int(round(360 / RES)), int(round(180 / RES))
N = NX * NY
EPOCH = pd.Timestamp("2000-01-01")
START, END = pd.Timestamp("2000-11-01"), pd.Timestamp("2026-08-31")   # MODIS coverage in FIRMS
MIN_CONFIDENCE = 30                                                     # "nominal" and "high"


def reduce_frame(df: pd.DataFrame) -> np.ndarray:
    """Vegetation-fire detections of one table -> unique keys (day * N + cell) of burning (day, cell) pairs."""
    if len(df):
        df = df[pd.to_numeric(df["confidence"], errors="coerce") >= MIN_CONFIDENCE]
        if "type" in df.columns:
            df = df[df["type"] == 0]          # 0 = presumed vegetation fire
    if len(df) == 0:
        return np.zeros(0, np.int64)
    i = np.clip(((df["latitude"].to_numpy() + 90) / RES).astype(np.int64), 0, NY - 1)
    j = np.clip(((df["longitude"].to_numpy() + 180) / RES).astype(np.int64), 0, NX - 1)
    day = (pd.to_datetime(df["acq_date"], format="%Y-%m-%d") - EPOCH).dt.days.to_numpy(np.int64)
    return np.unique(day * N + i * NX + j)


def monthly(keys: np.ndarray):
    when = EPOCH + pd.to_timedelta(keys // N, unit="D")
    ym = (when.year.to_numpy() - 2000) * 12 + when.month.to_numpy() - 1
    u, n = np.unique(ym.astype(np.int64) * N + keys % N, return_counts=True)
    return (u // N).astype(np.int16), (u % N).astype(np.int32), n.astype(np.int16)


def one_year(year: int) -> int:
    """Yearly global archive (all countries, no API quota) -> burning days per (month, cell)."""
    out = OUT / f"y_{year}.npz"
    if out.exists():
        return -1
    name = f"modis_{year}_all_countries.zip"
    zp = ff._download(f"{ff.FIRMS_URL}/data/country/zips/{name}", RAW / name, max_age_hours=1e9)
    keys = []
    cols = {"latitude", "longitude", "acq_date", "confidence", "type"}
    with zipfile.ZipFile(zp) as z:
        for member in z.namelist():
            if member.endswith(".csv"):
                with z.open(member) as fh:
                    keys.append(reduce_frame(pd.read_csv(fh, usecols=lambda c: c in cols)))
    keys = np.unique(np.concatenate(keys)) if keys else np.zeros(0, np.int64)
    ym, cell, n = monthly(keys)
    np.savez_compressed(out, ym=ym, cell=cell, n=n)
    zp.unlink(missing_ok=True)
    return len(keys)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    years = list(range(START.year, END.year + 1))
    print(f"MODIS archive: {len(years)} yearly files ({years[0]}-{years[-1]})", flush=True)
    for y in years:
        t0 = time.time()
        rows = one_year(y)
        print(f"PROGRESS {y}: " + ("already done" if rows < 0 else f"{rows:,} burning cell-days") +
              f" ({time.time() - t0:.0f} s)", flush=True)
    print("MODIS archive complete", flush=True)


if __name__ == "__main__":
    sys.exit(main())
