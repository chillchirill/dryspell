"""Fire-weather features from NOAA GFS (0.5 deg), public AWS archive, no key needed.

For a 24-hour window we read 5 forecast steps (6-hourly) of 2 m temperature,
2 m relative humidity, 10 m wind, gusts, plus soil moisture (0-10 cm) and the
accumulated precipitation, and turn them into daily fire-weather fields:

    tmax, tmean, rhmin, rhmean, vpdmax, wsmax, wsmean, gustmax, precip, soilw

* Training days use the forecast issued 12 h before the day starts
  (cycle D-1 12Z, steps 12..36 h) - the same information a forecaster would
  have had - and are cached under data/gfs/.
* Real-time forecasts use the newest GFS cycle that already covers the next 24 h.

Only the needed GRIB messages are downloaded (HTTP range requests using the
.idx index files), so a day costs ~15 MB instead of ~2 GB.
"""
from __future__ import annotations

import re
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import eccodes
import numpy as np
import pandas as pd
import requests
from scipy import ndimage

BUCKET = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
RES_TAG, RES_DEG = "0p50", 0.5
STEP_VARS = [("TMP", "2 m above ground"), ("RH", "2 m above ground"),
             ("UGRD", "10 m above ground"), ("VGRD", "10 m above ground"), ("GUST", "surface")]
DAILY_FIELDS = ["tmax", "tmean", "rhmin", "rhmean", "vpdmax", "wsmax", "wsmean", "gustmax",
                "precip", "soilw"]
RAIN_DAY_MM = 2.0

_session = requests.Session()
_session.headers["User-Agent"] = "firms-fire-forecast/2.0 (research script)"
_decode_lock = threading.Lock()


class MissingGFS(Exception):
    pass


def grib_url(cycle: pd.Timestamp, step: int) -> str:
    return (f"{BUCKET}/gfs.{cycle:%Y%m%d}/{cycle:%H}/atmos/"
            f"gfs.t{cycle:%H}z.pgrb2.{RES_TAG}.f{step:03d}")


def _read_idx(url: str):
    r = _session.get(url + ".idx", timeout=60)
    if r.status_code != 200:
        return None
    lines = r.text.strip().splitlines()
    out = []
    for k, line in enumerate(lines):
        p = line.split(":")
        end = int(lines[k + 1].split(":")[1]) - 1 if k + 1 < len(lines) else None
        out.append((p[3], p[4], p[5], int(p[1]), end))
    return out


def _acc_pattern(step: int) -> str:
    if step % 24 == 0:
        return rf"0-({step} hour|{step // 24} day) acc fcst"
    return rf"0-{step} hour acc fcst"


def _locate(entries, var, level, desc_re=None):
    for v, lev, desc, s, e in entries:
        if v == var and lev == level and (desc_re is None or re.fullmatch(desc_re, desc)):
            return s, e
    raise MissingGFS(f"{var} {level} {desc_re} not in index")


def _fetch(url, s, e) -> bytes:
    rng = f"bytes={s}-{e}" if e is not None else f"bytes={s}-"
    for attempt in range(4):
        try:
            r = _session.get(url, headers={"Range": rng}, timeout=120)
            r.raise_for_status()
            return r.content
        except requests.RequestException:
            if attempt == 3:
                raise


def _decode(msg: bytes) -> np.ndarray:
    with _decode_lock:
        gid = eccodes.codes_new_from_message(msg)
        try:
            ni, nj = eccodes.codes_get(gid, "Ni"), eccodes.codes_get(gid, "Nj")
            vals = eccodes.codes_get_values(gid)
        finally:
            eccodes.codes_release(gid)
    return vals.reshape(nj, ni).astype(np.float32)


def window_fields(cycle: pd.Timestamp, steps: list[int], workers: int = 12) -> dict:
    """Daily fire-weather fields on the GFS grid for forecast ``steps`` of ``cycle``."""
    jobs = [((var, st), st, var, lev, None) for st in steps for var, lev in STEP_VARS]
    jobs.append((("SOILW", steps[0]), steps[0], "SOILW", "0-0.1 m below ground", None))
    for st in {steps[0], steps[-1]}:
        if st > 0:
            jobs.append((("APCP", st), st, "APCP", "surface", _acc_pattern(st)))
    urls = {st: grib_url(cycle, st) for st in steps}
    with ThreadPoolExecutor(workers) as ex:
        idx = dict(zip(urls, ex.map(lambda st: _read_idx(urls[st]), urls)))
    if any(v is None for v in idx.values()):
        raise MissingGFS(f"GFS cycle {cycle:%Y-%m-%d %HZ} not (fully) available")
    ranges = [(key, urls[st], *_locate(idx[st], var, lev, d)) for key, st, var, lev, d in jobs]
    with ThreadPoolExecutor(workers) as ex:
        msgs = list(ex.map(lambda r: _fetch(r[1], r[2], r[3]), ranges))
    f = {r[0]: _decode(m) for r, m in zip(ranges, msgs)}

    T = np.stack([f[("TMP", s)] for s in steps]) - 273.15
    RH = np.clip(np.stack([f[("RH", s)] for s in steps]), 0, 100)
    WS = np.hypot(np.stack([f[("UGRD", s)] for s in steps]), np.stack([f[("VGRD", s)] for s in steps]))
    VPD = 0.6108 * np.exp(17.27 * T / (T + 237.3)) * (1 - RH / 100)
    acc_last = f[("APCP", steps[-1])]
    acc_first = f[("APCP", steps[0])] if steps[0] > 0 else 0.0
    return {
        "tmax": T.max(0), "tmean": T.mean(0), "rhmin": RH.min(0), "rhmean": RH.mean(0),
        "vpdmax": VPD.max(0), "wsmax": WS.max(0), "wsmean": WS.mean(0),
        "gustmax": np.stack([f[("GUST", s)] for s in steps]).max(0),
        "precip": np.clip(acc_last - acc_first, 0, None),
        "soilw": np.where(f[("SOILW", steps[0])] > 1.5, 1.0, f[("SOILW", steps[0])]),  # water/ice = saturated
    }


# ---------------------------------------------------------------------------
# Daily cache (training and recent past)
# ---------------------------------------------------------------------------
def _day_path(cache: Path, day: pd.Timestamp) -> Path:
    return cache / f"gfs_day_{day:%Y%m%d}.npz"


def ensure_daily(days, cache: Path, parallel_days: int = 3) -> list[pd.Timestamp]:
    """Download/cached daily windows [D 00Z, D+1 00Z) from cycle D-1 12Z. Returns missing days."""
    cache.mkdir(parents=True, exist_ok=True)
    todo = [pd.Timestamp(d) for d in days if not _day_path(cache, pd.Timestamp(d)).exists()]
    missing = []

    def one(day):
        try:
            fields = window_fields(day - pd.Timedelta(hours=12), [12, 18, 24, 30, 36])
        except MissingGFS:
            return day
        np.savez_compressed(_day_path(cache, day), **{k: v.astype(np.float16) for k, v in fields.items()})
        return None

    if todo:
        print(f"  GFS: downloading {len(todo)} day(s) of weather "
              f"({todo[0]:%Y-%m-%d} .. {todo[-1]:%Y-%m-%d})")
    with ThreadPoolExecutor(parallel_days) as ex:
        for k, res in enumerate(ex.map(one, todo), 1):
            if res is not None:
                missing.append(res)
            if k % 10 == 0:
                print(f"    {k}/{len(todo)}")
    return missing


class DailyWeather:
    """Access to cached daily fields + derived antecedent (past) conditions."""

    def __init__(self, cache: Path):
        self.cache = cache
        self._light = {}  # day -> (precip, tmax) float32

    def has(self, day) -> bool:
        return _day_path(self.cache, pd.Timestamp(day)).exists()

    def load(self, day) -> dict:
        with np.load(_day_path(self.cache, pd.Timestamp(day))) as z:
            return {k: z[k].astype(np.float32) for k in DAILY_FIELDS}

    def _pt(self, day):
        day = pd.Timestamp(day)
        if day not in self._light:
            if not self.has(day):
                self._light[day] = None
            else:
                with np.load(_day_path(self.cache, day)) as z:
                    self._light[day] = (z["precip"].astype(np.float32), z["tmax"].astype(np.float32))
        return self._light[day]

    def antecedent(self, day, n: int = 30) -> dict:
        """Conditions over the n days before ``day``: precip sums, dry spell, mean tmax."""
        day = pd.Timestamp(day).normalize()
        prev = [self._pt(day - pd.Timedelta(days=k)) for k in range(1, n + 1)]
        avail = [(k, p) for k, p in enumerate(prev, 1) if p is not None]
        if not avail:
            raise MissingGFS(f"no past weather before {day:%Y-%m-%d}")
        shape = avail[0][1][0].shape
        p7, p30, tsum = np.zeros(shape, np.float32), np.zeros(shape, np.float32), np.zeros(shape, np.float32)
        dsr = np.full(shape, n + 1, np.float32)
        for k, (pr, tx) in sorted(avail, reverse=True):  # oldest first, newest overwrites dsr
            if k <= 7:
                p7 += pr
            p30 += pr
            tsum += tx
            dsr[pr >= RAIN_DAY_MM] = k
        return {"precip_7d": p7, "precip_30d": p30, "days_since_rain": dsr,
                "tmax_mean30": tsum / len(avail)}


def latest_window(tau: pd.Timestamp, hours: int = 24):
    """Fields for [tau, tau+hours) from the newest GFS cycle that is already published."""
    tau = pd.Timestamp(tau).tz_localize(None) if pd.Timestamp(tau).tzinfo else pd.Timestamp(tau)
    base = tau.floor("6h")
    for back in range(0, 49, 6):
        cyc = base - pd.Timedelta(hours=back)
        off = int(np.ceil((tau - cyc) / pd.Timedelta(hours=3))) * 3
        steps = [off + k for k in range(0, hours + 1, 6)]
        last = _session.head(grib_url(cyc, steps[-1]) + ".idx", timeout=30)
        if last.status_code != 200:
            continue
        try:
            return window_fields(cyc, steps), cyc
        except MissingGFS:
            continue
    raise MissingGFS(f"no GFS cycle covers {tau}")


def weather_features(window: dict, past: dict, lat, lon) -> pd.DataFrame:
    """Sample GFS fields (bilinear) at cell centres and build the weather feature columns."""
    rows = (90.0 - np.asarray(lat)) / RES_DEG
    cols = (np.asarray(lon) % 360.0) / RES_DEG

    def s(a):
        a = np.concatenate([a, a[:, :1]], axis=1)  # wrap at 360 deg
        return ndimage.map_coordinates(a, [rows, cols], order=1, mode="nearest").astype(np.float32)

    out = {k: s(window[k]) for k in DAILY_FIELDS}
    out["precip_24h"] = out.pop("precip")
    for k in ("precip_7d", "precip_30d", "days_since_rain"):
        out[k] = s(past[k])
    out["tmax_anom"] = out["tmax"] - s(past["tmax_mean30"])
    return pd.DataFrame(out)


WEATHER_FEATURES = ["tmax", "tmean", "rhmin", "rhmean", "vpdmax", "wsmax", "wsmean", "gustmax",
                    "precip_24h", "soilw", "precip_7d", "precip_30d", "days_since_rain", "tmax_anom"]
