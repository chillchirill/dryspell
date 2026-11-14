"""NASA SRTM30 terrain at native 30 arc-seconds (~927 m north/south).

Data: NASA/NGA SRTM version 2.1, public mirror of the USGS distribution:
https://srtm.kurviger.de/SRTM30/ ; product geometry checked against NASA CMR.
https://lpdaac.usgs.gov/documents/179/SRTM_User_Guide_V3.pdf
Only DEM archives covering real-fire cluster centroids are selected. SRTM's
radar coverage is -56 <= latitude < 60; northern GTOPO30 fill is not evaluated
as SRTM terrain. No extra packages or high-resolution DEMs are downloaded.

plan() fetches only catalogue metadata and HTTP HEAD headers. download() is
explicitly gated. Terrain uses cell-centred, big-endian int16 DEMs. Gradients
are computed from the ~1km surface in physical metres, with one-sided edge
stencils inside each selected tile. Void-adjacent samples remain missing.
Aspect is the downhill bearing; upslope is the opposite bearing, clockwise
from north. Flat ground has slope 0 and contributes a zero upslope vector.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

import numpy as np
import pandas as pd
import requests
from scipy.ndimage import map_coordinates

CMR = 'https://cmr.earthdata.nasa.gov/search/granules.json'
COLLECTION = 'C2763266346-LPCLOUD'
MIRROR = 'https://srtm.kurviger.de/SRTM30'
RES_DEG = 1 / 120
EARTH_M = 6371008.8


def plan(root):
    """Print a concrete size estimate without requesting any elevation payload."""
    out = root / 'output/spread'
    records = pd.read_csv(out / 'backtest_clusters.csv')
    real = records.loc[(records.n_points >= 20) & (records.n_new >= 10)]
    covered = real.loc[real.lat.between(-56, 60, inclusive='left')]
    catalog_path = out / 'terrain_catalog.json'
    if catalog_path.exists():
        catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    else:
        response = requests.get(CMR, params={'collection_concept_id': COLLECTION, 'page_size': 100}, timeout=30)
        response.raise_for_status()
        catalog = response.json()['feed']['entry']
        catalog_path.write_text(json.dumps(catalog, indent=2), encoding='utf-8')
    selected = []
    for granule in catalog:
        south, west, north, east = map(float, granule['boxes'][0].split())
        n = int(((covered.lat >= south) & (covered.lat < north) & (covered.lon >= west) & (covered.lon < east)).sum())
        if not n:
            continue
        tile = granule['title'].split('.')[0].lower()
        selected.append({'tile': tile, 'south': south, 'west': west, 'north': north, 'east': east,
                         'n_clusters': n, 'url': f'{MIRROR}/{tile}/{tile}.dem.zip',
                         'nrows': round((north-south)/RES_DEG), 'ncols': round((east-west)/RES_DEG)})
    if sum(t['n_clusters'] for t in selected) != len(covered):
        raise ValueError('NASA catalogue does not uniquely cover all eligible cluster centroids')

    def metadata(tile):
        response = requests.head(tile['url'], allow_redirects=True, timeout=30)
        response.raise_for_status()
        size = response.headers.get('Content-Length')
        if size is None:
            raise ValueError(f"Cannot estimate download size for {tile['tile']}: missing Content-Length")
        tile['download_bytes'] = int(size)
        tile['dem_bytes'] = tile['nrows'] * tile['ncols'] * 2
        return tile

    with ThreadPoolExecutor(max_workers=4) as pool:
        selected = list(pool.map(metadata, selected))
    manifest = pd.DataFrame(selected).sort_values('tile').reset_index(drop=True)
    manifest.to_csv(out / 'terrain_plan.csv', index=False)
    record_hash = hashlib.sha256((out / 'backtest_clusters.csv').read_bytes()).hexdigest()
    info = {'product': 'NASA/NGA SRTM30 v2.1, 30 arc-second; public USGS-data mirror',
            'backtest_sha256': record_hash, 'real_clusters': len(real), 'eligible_clusters': len(covered),
            'outside_srtm_coverage': len(real)-len(covered), 'tiles': len(manifest),
            'download_bytes': int(manifest.download_bytes.sum()), 'dem_bytes': int(manifest.dem_bytes.sum()),
            'plan_sha256': hashlib.sha256((out / 'terrain_plan.csv').read_bytes()).hexdigest()}
    (out / 'terrain_plan.json').write_text(json.dumps(info, indent=2), encoding='utf-8')
    print(f"TERRAIN PLAN: {len(manifest)} selected SRTM30 DEM tiles; {info['download_bytes']/1e6:.3f} MB "
          f"compressed; {info['dem_bytes']/1e6:.1f} MB unpacked DEMs.")
    print(f"Eligible real-fire clusters: {len(covered):,}/{len(real):,}; "
          f"outside -56..60 SRTM coverage: {len(real)-len(covered):,} (wind/persistence fallback).")
    print('Resolution: 30 arc-seconds (~927 m latitude), already averaged to approximately 1 km.')
    print('Source: NASA/NGA SRTM30 v2.1 via srtm.kurviger.de public mirror; no Earthdata login required.')
    print('No elevation data downloaded. Review output/spread/terrain_plan.csv before approving.')
    return manifest


def verified_plan(root):
    out = root / 'output/spread'
    info = json.loads((out / 'terrain_plan.json').read_text())
    if hashlib.sha256((out / 'terrain_plan.csv').read_bytes()).hexdigest() != info['plan_sha256']:
        raise ValueError('Terrain manifest changed; regenerate and review the download plan')
    if hashlib.sha256((out / 'backtest_clusters.csv').read_bytes()).hexdigest() != info['backtest_sha256']:
        raise ValueError('Backtest changed; regenerate and review the terrain plan')
    return pd.read_csv(out / 'terrain_plan.csv'), info


def download(root, approved=False):
    """Download only a reviewed manifest, only after explicit user approval."""
    manifest, info = verified_plan(root)
    print(f"Terrain download: {len(manifest)} tiles, estimated {info['download_bytes']/1e6:.3f} MB; "
          f"unpacked DEMs {info['dem_bytes']/1e6:.1f} MB.", flush=True)
    if not approved:
        raise ValueError('Terrain download requires user approval and --approve-terrain-download')
    cache = root / 'data/terrain'
    cache.mkdir(parents=True, exist_ok=True)
    for row in manifest.itertuples(index=False):
        if not row.url.startswith(MIRROR + '/') or row.url != f'{MIRROR}/{row.tile}/{row.tile}.dem.zip':
            raise ValueError('Unexpected terrain source in manifest')
        target = cache / f'{row.tile}.dem'
        if target.exists() and target.stat().st_size == row.dem_bytes:
            print(f'  cached {row.tile}', flush=True)
            continue
        archive = cache / f'{row.tile}.dem.zip'
        if not archive.exists():
            part = archive.with_suffix('.zip.part')
            with requests.get(row.url, stream=True, timeout=(30, 120)) as response:
                response.raise_for_status()
                with part.open('wb') as handle:
                    for chunk in response.iter_content(1024 * 1024):
                        handle.write(chunk)
            if part.stat().st_size != row.download_bytes:
                raise ValueError(f'Size mismatch for {row.tile}; partial archive retained, not loaded')
            part.replace(archive)
        with zipfile.ZipFile(archive) as z:
            names = [n for n in z.namelist() if Path(n).suffix.lower() == '.dem']
            if len(names) != 1 or z.getinfo(names[0]).file_size != row.dem_bytes:
                raise ValueError(f'Unexpected DEM member or dimensions in {row.tile}')
            part = target.with_suffix('.dem.part')
            with z.open(names[0]) as source, part.open('wb') as destination:
                shutil.copyfileobj(source, destination)
            part.replace(target)
        print(f'  downloaded {row.tile}: {row.download_bytes/1e6:.3f} MB', flush=True)
    print('Terrain manifest cached; run fire_spread.py evaluate --terrain.', flush=True)


def gradient_fields(elevation, north, resolution=RES_DEG):
    """Physical east/north dz/distance; missing elevations stay unknown."""
    dem = np.asarray(elevation, dtype=np.float32).copy()
    dem[(dem == -32768) | (dem == -9999)] = np.nan
    northward_spacing = EARTH_M * np.radians(resolution)
    latitude = north - (np.arange(dem.shape[0]) + .5) * resolution
    eastward_spacing = northward_spacing * np.cos(np.radians(latitude))
    row_gradient, col_gradient = np.gradient(dem, edge_order=1)
    valid = np.isfinite(dem)
    return (np.where(valid, col_gradient / eastward_spacing[:, None], np.nan),
            np.where(valid, -row_gradient / northward_spacing, np.nan))


def sample_gradients(east, northward, lat, lon, north, west, resolution=RES_DEG):
    # Pixel centers are half a cell inside the tile's bounding box.
    coords = [(north-np.asarray(lat))/resolution-.5, (np.asarray(lon)-west)/resolution-.5]
    e = map_coordinates(east, coords, order=1, mode='nearest')
    n = map_coordinates(northward, coords, order=1, mode='nearest')
    magnitude = np.hypot(e, n)
    slope = np.degrees(np.arctan(magnitude))
    upslope = np.where(magnitude > 1e-10, np.degrees(np.arctan2(e, n)) % 360, 0.)
    aspect = np.where(magnitude > 1e-10, (upslope+180) % 360, np.nan)
    available = np.isfinite(slope) & np.isfinite(upslope)
    return slope, aspect, upslope, available


def sample_clusters(records, cache, manifest_path):
    manifest = pd.read_csv(manifest_path)
    result = records[['day', 'cluster_id', 'lat', 'lon']].copy()
    result['slope_deg'] = np.nan
    result['aspect_deg'] = np.nan
    result['upslope_bearing_deg'] = np.nan
    result['terrain_available'] = False
    result['terrain_tile'] = ''
    eligible = result.lat.between(-56, 60, inclusive='left')
    for row in manifest.itertuples(index=False):
        mask = eligible & result.lat.between(row.south, row.north, inclusive='left') & result.lon.between(row.west, row.east, inclusive='left')
        if not mask.any():
            continue
        path = cache / f'{row.tile}.dem'
        if not path.exists() or path.stat().st_size != row.dem_bytes:
            raise FileNotFoundError(f'Missing/incomplete cached terrain {path.name}; approval is required before download')
        dem = np.memmap(path, dtype='>i2', mode='r', shape=(row.nrows, row.ncols))
        east, northward = gradient_fields(dem, row.north)
        slope, aspect, upslope, available = sample_gradients(east, northward,
            result.loc[mask, 'lat'], result.loc[mask, 'lon'], row.north, row.west)
        result.loc[mask, 'slope_deg'] = slope
        result.loc[mask, 'aspect_deg'] = aspect
        result.loc[mask, 'upslope_bearing_deg'] = upslope
        result.loc[mask, 'terrain_available'] = available
        result.loc[mask, 'terrain_tile'] = row.tile
        print(f'  Terrain sampled {row.tile}: {int(available.sum())}/{int(mask.sum())} valid clusters', flush=True)
        del dem, east, northward
    result.to_csv(manifest_path.parent / 'terrain_features.csv', index=False, float_format='%.8f')
    return result.drop(columns=['lat', 'lon'])
