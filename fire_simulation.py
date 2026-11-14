"""Offline adapter for the team's Glendalough simulation; never downloads data."""
from functools import lru_cache
import gzip
import json
from pathlib import Path
import subprocess
import threading

ROOT = Path(__file__).resolve().parent
_lock = threading.Lock()


@lru_cache(maxsize=1)
def environment():
    path = ROOT / 'vendor/irish_simulation/environment.json.gz'
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
    return {'id': data['id'], 'name': data['name'], 'bounds': b, 'width': grid['width'], 'height': grid['height'],
            'cellSizeM': grid['cellSizeM'], 'defaultIgnition': center,
            'cover': [c['cover'] for c in cells], 'burnable': [bool(c['burnable'] and c['cover'] != 'unknown') for c in cells],
            'elevationM': [c['elevationM'] for c in cells], 'provenance': grid['provenance'],
            'weather': data['weather']['samples'][0], 'warnings': data['warnings']}


def validate_request(value):
    if not isinstance(value, dict):
        raise ValueError('Expected a simulation request')
    allowed = {'ignition', 'sensors', 'durationSec', 'windSpeedMps', 'windFromDeg'}
    if set(value) != allowed:
        raise ValueError('Invalid simulation fields')
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
    env = environment()
    for point in [value['ignition'], *value['sensors']]:
        if not isinstance(point, dict) or not all(number(point.get(k)) for k in ('longitude', 'latitude')):
            raise ValueError('Invalid position')
        b = env['bounds']
        if not (b['west'] <= point['longitude'] < b['east'] and b['south'] <= point['latitude'] < b['north']):
            raise ValueError('Choose a point inside the prepared Glendalough area')
    for sensor in value['sensors']:
        if sensor.get('profileId') not in ('temperature', 'combined'):
            raise ValueError('Unsupported virtual sensor profile')
    return value


def run(value):
    validate_request(value)
    if not _lock.acquire(blocking=False):
        raise BlockingIOError('Another simulation is calculating. Try again shortly.')
    try:
        result = subprocess.run(['node', str(ROOT/'scripts/run_irish_simulation.mjs')],
                                input=json.dumps(value, allow_nan=False), capture_output=True,
                                encoding='utf-8', timeout=90, cwd=ROOT)
        if result.returncode:
            # Fixed local worker reports validation errors only; no request/credential logging.
            raise ValueError(result.stderr.strip()[:250] or 'Simulation calculation failed')
        return json.loads(result.stdout)
    finally:
        _lock.release()
