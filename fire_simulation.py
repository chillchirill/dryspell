"""Offline adapter for the team's Ireland simulations; never downloads data."""
from functools import lru_cache
import gzip
import json
from pathlib import Path
import subprocess
import threading
import csv

ROOT = Path(__file__).resolve().parent
_lock = threading.Lock()


@lru_cache(maxsize=2)
def _wind_cache(issued_at, forecast_version):
    from fire_spread import cached_latest_wind_uv
    return cached_latest_wind_uv(issued_at)


def forecast_wind(latitude, longitude, duration=3600):
    """Same cached GFS cycle as the map; interpolate vectors, never angles."""
    import numpy as np
    import pandas as pd
    from fire_spread import wind_at_points
    if not all(type(v) in (int, float) and np.isfinite(v) for v in (latitude, longitude, duration)):
        raise ValueError('Invalid wind location or duration')
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180 and duration in (1800, 3600, 10800)):
        raise ValueError('Invalid wind location or duration')
    path = ROOT/'output/firms/forecast_latest.csv'
    issued = pd.Timestamp(pd.read_csv(path, usecols=['valid_from_utc'], nrows=1).valid_from_utc.iloc[0])
    if issued.tzinfo is not None:
        issued = issued.tz_convert('UTC').tz_localize(None)
    uv, cycle = _wind_cache(str(issued), path.stat().st_mtime_ns)
    sampled = wind_at_points(uv, pd.DataFrame({'lat':[latitude], 'lon':[longitude]}))
    times = sorted({0, int(duration), *range(3600, int(duration), 3600)})
    samples=[]
    for t in times:
        u=float(np.interp(t/3600, [0,6,12,18,24], sampled['u'][:,0]))
        v=float(np.interp(t/3600, [0,6,12,18,24], sampled['v'][:,0]))
        if not np.isfinite([u,v]).all():
            raise ValueError('Cached wind is missing at this location')
        speed=float(np.hypot(u,v))
        to=float(np.degrees(np.arctan2(u,v)) % 360) if speed>=.1 else None
        samples.append({'timeSec':t,'windSpeedMps':speed,'windFromDeg':0. if to is None else (to+180)%360,
                        'windToDeg':to,'uMps':u,'vMps':v})
    return {'issuedAt':issued.isoformat()+'Z', 'cycleUTC':pd.Timestamp(cycle).isoformat()+'Z',
            'latitude':latitude,'longitude':longitude,'samples':samples,
            'source':'Cached NOAA GFS 10 m wind from the map forecast; not live station wind',
            'otherWeather':'Synthetic dry-weather what-if: 27 C, 35% RH and no rain'}


def site_path(site):
    if site=='glendalough':return ROOT/'vendor/irish_simulation/environment.json.gz'
    if site not in {f'ireland-{i}' for i in range(7)}:raise ValueError('Unknown Ireland simulation site')
    return ROOT/'vendor/irish_simulation/sites'/f'{site}.json.gz'


def sites():
    rows=[{'id':'glendalough','label':'Glendalough · demonstration area','available':site_path('glendalough').exists()}]
    with (ROOT/'vendor/irish_simulation/planned_sites.csv').open() as stream:
        for row in csv.DictReader(stream):
            site=row['site_id'];lat=float(row['latitude']);lon=float(row['longitude'])
            rows.append({'id':site,'label':f"{lat:.3f}, {lon:.3f} · {float(row['probability'])*100:.2f}%",
                'latitude':lat,'longitude':lon,'country':row['country'],'probability':float(row['probability']),
                'forecastIssuedAt':row['forecast_from_utc'],'available':site_path(site).exists()})
    return rows


@lru_cache(maxsize=8)
def environment(site='glendalough'):
    path = site_path(site)
    if not path.exists():
        raise FileNotFoundError('Prepared Ireland simulation is unavailable')
    data = json.loads(gzip.decompress(path.read_bytes()))
    grid = data['landscape']
    # Keep full terrain server-side; browser needs compact cell classes and placement mask.
    cells = grid['cells']
    nearest = min((i for i, c in enumerate(cells) if c['burnable'] and c['cover'] != 'unknown'),
                  key=lambda i: (i % grid['width'] - grid['width'] / 2)**2 + (i // grid['width'] - grid['height'] / 2)**2)
    b = grid['bounds']
    center = {'longitude': b['west']+(nearest % grid['width']+.5)/grid['width']*(b['east']-b['west']),
              'latitude': b['south']+(nearest // grid['width']+.5)/grid['height']*(b['north']-b['south'])}
    return {'id': data['id'], 'siteId':site,'name': data['name'], 'bounds': b, 'width': grid['width'], 'height': grid['height'],
            'cellSizeM': grid['cellSizeM'], 'defaultIgnition': center,
            'cover': [c['cover'] for c in cells], 'burnable': [bool(c['burnable'] and c['cover'] != 'unknown') for c in cells],
            'elevationM': [c['elevationM'] for c in cells], 'provenance': grid['provenance'],
            'weather': data['weather']['samples'][0], 'warnings': data['warnings']}


def validate_request(value):
    if not isinstance(value, dict):
        raise ValueError('Expected a simulation request')
    allowed = {'ignition', 'sensors', 'durationSec', 'windSpeedMps', 'windFromDeg'}
    if set(value)-{'weatherMode','siteId'} != allowed:
        raise ValueError('Invalid simulation fields')
    if value.get('weatherMode','manual') not in ('manual','forecast_wind'):
        raise ValueError('Choose cached forecast wind or manual scenario wind')
    def number(x):
        return type(x) in (int, float) and -1e9 < x < 1e9
    if not number(value['durationSec']) or value['durationSec'] not in (1800, 3600, 10800):
        raise ValueError('Choose 30 minutes, 1 hour or 3 hours')
    if not number(value['windSpeedMps']) or not 0 <= value['windSpeedMps'] <= 15:
        raise ValueError('Wind speed must be between 0 and 15 m/s')
    if not number(value['windFromDeg']) or not 0 <= value['windFromDeg'] < 360:
        raise ValueError('Invalid wind direction')
    if not isinstance(value['sensors'], list) or len(value['sensors']) > 8:
        raise ValueError('Use at most 8 virtual sensors')
    env = environment(value.get('siteId','glendalough'))
    for point in [value['ignition'], *value['sensors']]:
        if not isinstance(point, dict) or not all(number(point.get(k)) for k in ('longitude', 'latitude')):
            raise ValueError('Invalid position')
        b = env['bounds']
        if not (b['west'] <= point['longitude'] < b['east'] and b['south'] <= point['latitude'] < b['north']):
            raise ValueError('Choose a point inside the selected prepared area')
    for sensor in value['sensors']:
        if sensor.get('profileId') not in ('temperature', 'combined'):
            raise ValueError('Unsupported virtual sensor profile')
    return value


def run(value):
    validate_request(value)
    if not _lock.acquire(blocking=False):
        raise BlockingIOError('Another simulation is calculating. Try again shortly.')
    try:
        value = dict(value)
        if value.get('weatherMode') == 'forecast_wind':
            point=value['ignition']
            value['forecastWind']=forecast_wind(point['latitude'],point['longitude'],value['durationSec'])
        result = subprocess.run(['node', str(ROOT/'scripts/run_irish_simulation.mjs')],
                                input=json.dumps(value, allow_nan=False), capture_output=True,
                                encoding='utf-8', timeout=90, cwd=ROOT)
        if result.returncode:
            # Fixed local worker reports validation errors only; no request/credential logging.
            raise ValueError(result.stderr.strip()[:250] or 'Simulation calculation failed')
        return json.loads(result.stdout)
    finally:
        _lock.release()
