"""Offline, long-record MODIS/VIIRS activity calendar from the supplied handoff ZIP.

No downloads, extraction, pickle loading, or execution of packaged code.
The comparable unit is a detected grid-cell day, not a fire or burned area.
Country-level scale adjustment is exploratory, not event-level harmonization.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile

import numpy as np
import pandas as pd
from matplotlib.path import Path as PolygonPath
from fire_spread_web import atomic_json

ROOT = Path(__file__).resolve().parent
COUNTRIES = ['Ireland', 'United Kingdom', 'Spain', 'France']
NX, NY, RES = 1440, 720, .25
PREFIX = 'harmonization_handoff/'


def cell_ids(lat, lon):
    lat, lon = np.asarray(lat, float), np.asarray(lon, float)
    if not (np.isfinite(lat).all() and np.isfinite(lon).all() and
            ((lat >= -90) & (lat <= 90)).all() and ((lon >= -180) & (lon <= 180)).all()):
        raise ValueError('Invalid coordinates')
    return np.clip(np.floor((lat+90)/RES).astype(int), 0, NY-1)*NX + np.clip(np.floor((lon+180)/RES).astype(int), 0, NX-1)


def month_number(value):
    t = pd.Timestamp(value)
    return t.year*12+t.month-1


def month_label(number):
    year, month = divmod(int(number), 12)
    return f'{year:04d}-{month+1:02d}'


def verify_package(archive):
    manifest = archive.read(PREFIX+'SHA256SUMS.txt').decode('utf-8')
    checked = 0
    for line in manifest.splitlines():
        if not line.strip(): continue
        digest, name = line.split(maxsplit=1)
        name = name.strip()
        if not re.fullmatch(r'[0-9a-f]{64}', digest) or '..' in Path(name).parts:
            raise ValueError('Invalid checksum manifest')
        if hashlib.sha256(archive.read(PREFIX+name)).hexdigest() != digest:
            raise ValueError(f'Checksum mismatch: {name}')
        checked += 1
    return checked


def common_grid(geojson, excluded):
    """Use interior cells to limit clipping differences in the coarse country subset.

    Centre and four corners must lie within the SAME delivered country polygon.
    This deliberately excludes boundary/coastal cells; it is not full-country coverage.
    """
    ids = np.arange(NX*NY)
    lat = -90+(ids//NX+.5)*RES
    lon = -180+(ids % NX+.5)*RES
    country = np.full(len(ids), -1, np.int8)
    for feature in geojson['features']:
        name = feature['properties'].get('NAME') or feature['properties'].get('ADMIN')
        if name not in COUNTRIES: continue
        g = feature['geometry']
        polygons = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        for polygon in polygons:
            ring = np.asarray(polygon[0], float)
            if ring[:, 0].min() < -12 or ring[:, 0].max() > 12: continue
            candidates = np.flatnonzero((lon >= ring[:, 0].min()) & (lon <= ring[:, 0].max()) &
                                        (lat >= ring[:, 1].min()) & (lat <= ring[:, 1].max()))
            inside = np.ones(len(candidates), bool)
            for dx, dy in [(0, 0), (-.125, -.125), (-.125, .125), (.125, -.125), (.125, .125)]:
                coords = np.column_stack((lon[candidates]+dx, lat[candidates]+dy))
                inside &= PolygonPath(ring).contains_points(coords)
                for hole in polygon[1:]: inside &= ~PolygonPath(hole).contains_points(coords)
            country[candidates[inside]] = COUNTRIES.index(name)
    if excluded.shape != country.shape or excluded.dtype != np.bool_:
        raise ValueError('Invalid shared static-source mask')
    country[excluded] = -1
    return country


def reduce_viirs(frame, country_grid, first, last):
    data = frame.copy()
    data['date'] = pd.to_datetime(data.acq_date, errors='raise')
    data['cell'] = cell_ids(data.latitude, data.longitude)
    data['month_id'] = data.date.dt.year*12+data.date.dt.month-1
    data['grid_country'] = country_grid[data.cell.to_numpy()]
    code = data.country.map({name: i for i, name in enumerate(COUNTRIES)}).fillna(-2).to_numpy()
    confidence = data.confidence.astype(str).str.lower().str.strip()
    types = pd.to_numeric(data.type, errors='coerce')
    data['type_unknown'] = types.isna()
    data['calendar_included'] = (data.month_id.between(first, last) &
        confidence.isin(['n', 'h', 'nominal', 'high']) & (types.eq(0) | types.isna()) &
        (data.grid_country.to_numpy() == code) & (data.grid_country >= 0))
    retained = data.loc[data.calendar_included]
    # Union across satellites and overpasses: at most one detection-day per cell.
    days = retained.groupby(['month_id', 'cell', 'date'], as_index=False).agg(type_unknown=('type_unknown', 'max'))
    counts = days.groupby(['month_id', 'cell'], as_index=False).agg(viirs=('date', 'size'), unknown=('type_unknown', 'sum'))
    return data, counts


def file_coverage(manifest, month):
    start = pd.Timestamp(month+'-01')
    dates = pd.date_range(start, start+pd.offsets.MonthEnd(0))
    covered = {sat: set() for sat in ['20', '21']}
    for name in manifest['file']:
        match = re.fullmatch(r'api_VIIRS_NOAA(20|21)_(?:SP|NRT)_world_(\d{4}-\d{2}-\d{2})_(\d+)d.csv', name)
        if match:
            sat, date, length = match.groups()
            covered[sat].update(pd.date_range(date, periods=int(length)))
    # File date coverage, NOT proof of cloud-free satellite observation coverage.
    return all(set(dates).issubset(covered[sat]) for sat in covered)


def fit_scale(records):
    overlap = [r for r in records if r['modis'] is not None and r['viirs'] is not None and not r['unknown']]
    cut = int(len(overlap)*.7)
    train, test = overlap[:cut], overlap[cut:]
    if len(train) < 6 or len(test) < 3 or sum(r['viirs'] > 0 for r in train) < 4:
        return {'factor': None, 'reason': 'Insufficient overlapping activity for calibration'}
    v = np.array([r['viirs'] for r in train], float)
    m = np.array([r['modis'] for r in train], float)
    factor = float(np.dot(v, m)/np.dot(v, v))  # nonnegative least squares through origin
    raw = float(np.mean([abs(r['viirs']-r['modis']) for r in test]))
    adjusted = float(np.mean([abs(factor*r['viirs']-r['modis']) for r in test]))
    return {'factor': factor, 'train_first': train[0]['month'], 'train_last': train[-1]['month'],
            'train_months': len(train), 'test_first': test[0]['month'], 'test_last': test[-1]['month'],
            'test_months': len(test), 'test_mae_raw': raw, 'test_mae_adjusted': adjusted,
            'test_bias_raw': float(np.mean([r['viirs']-r['modis'] for r in test])),
            'test_bias_adjusted': float(np.mean([factor*r['viirs']-r['modis'] for r in test])),
            'improved_on_test': adjusted < raw,
            'note': 'Country totals only; fixed shared mask. Not prospective validation or physical equivalence.'}


def harmonize_records(records, calibration):
    """One source per month on the MODIS reference scale; never sum sensors.

    The frozen factor is not selected or refitted using held-out errors.
    Unknown-type NRT data remain visible but explicitly provisional.
    """
    factor = calibration['factor']
    for row in records:
        flags = []
        if row['modis'] is not None:
            value, source = float(row['modis']), 'MODIS'
            if int(row['month'][:4]) < 2003:
                flags.append('early_satellite_coverage')
        elif row['viirs'] is not None and factor is not None:
            value, source = float(row['viirs']*factor), 'VIIRS adjusted'
            flags.append('country_scale_estimate')
            if row['unknown'] or row.get('viirs_type_filter', '').startswith('NRT'):
                flags.append('unknown_type_provisional')
            if not calibration.get('improved_on_test', False):
                flags.append('no_held_out_improvement')
        else:
            value, source = None, None
            flags.append('unavailable')
        row.update(harmonized=value, harmonized_source=source, quality_flags=flags)


def add_historical_comparisons(records):
    """Past same-month MODIS reference; never includes the selected year or future.

    2003-2023 is the fixed reference pool. Its observation coverage is unknown;
    quantiles describe retained satellite detections, not fire probabilities.
    """
    for row in records:
        year = int(row['month'][:4])
        reference = [r for r in records if 2003 <= int(r['month'][:4]) <= 2023
                     and int(r['month'][:4]) < year and r['month'][5:] == row['month'][5:]
                     and r['modis'] is not None]
        row.update(baseline_years=len(reference), baseline_first=reference[0]['month'] if reference else None,
                   baseline_last=reference[-1]['month'] if reference else None,
                   baseline_median=None, baseline_p10=None, baseline_p90=None,
                   anomaly_absolute=None, anomaly_pct=None, anomaly_status='insufficient_reference')
        if len(reference) < 5:
            continue
        lo, med, hi = (float(x) for x in np.quantile([r['modis'] for r in reference], [.1, .5, .9]))
        row.update(baseline_median=med, baseline_p10=lo, baseline_p90=hi)
        value = row['harmonized']
        if value is None:
            row['anomaly_status'] = 'unavailable'
            continue
        row.update(anomaly_absolute=value-med, anomaly_pct=100*(value-med)/med if med else None,
                   anomaly_status='above_reference' if value > hi else 'below_reference' if value < lo else 'within_reference')


def build(package, out=None):
    package = Path(package)
    out = Path(out) if out else ROOT/'output/history'
    with zipfile.ZipFile(package) as z:
        checked = verify_package(z)
        raw = pd.read_csv(io.BytesIO(z.read(PREFIX+'data/viirs_subset/viirs_subset_IE_GB_ES_FR.csv.gz')),
                          compression='gzip', dtype={'confidence': str, 'version': str, 'acq_time': str})
        last = month_number(raw.acq_date.max())-1
        first = month_number('2000-01-01')  # Actual start is resolved from supplied MODIS months below.
        geo = json.loads(z.read(PREFIX+'data/reference/ne_110m_admin_0_countries.geojson'))
        static = np.load(io.BytesIO(z.read(PREFIX+'data/reference/static_sources_0.25.npy')), allow_pickle=False)
        grid = common_grid(geo, static)
        data, viirs = reduce_viirs(raw, grid, first, last)
        manifest = pd.read_csv(io.BytesIO(z.read(PREFIX+'data/viirs_subset/viirs_subset_source_files.csv')))
        modis_parts, modis_months = [], set()
        for year in range(2000, last//12+1):
            name = PREFIX+f'data/modis_monthly/y_{year}.npz'
            if name not in z.namelist(): continue
            with np.load(io.BytesIO(z.read(name)), allow_pickle=False) as source:
                month = source['ym'].astype(int)+2000*12
                cell, count = source['cell'].astype(int), source['n'].astype(int)
                if not ((cell >= 0) & (cell < NX*NY)).all() or not ((count >= 1) & (count <= 31)).all():
                    raise ValueError('Invalid MODIS monthly arrays')
                modis_months.update(int(x) for x in np.unique(month))
                keep = (month >= first) & (month <= last) & (grid[cell] >= 0)
                modis_parts.append(pd.DataFrame({'month_id': month[keep], 'cell': cell[keep], 'modis': count[keep]}))
        if not modis_parts: raise FileNotFoundError('No supplied MODIS monthly history')
        first = min(modis_months)
        labels = [month_label(m) for m in range(first, last+1)]
        coverage = {label: (month_number(raw.acq_date.min()) <= month_number(label+'-01') <= last
                            and file_coverage(manifest, label)) for label in labels}
        usable_months = {month_number(label+'-01') for label, complete in coverage.items() if complete}
        data.loc[~data.month_id.isin(usable_months), 'calendar_included'] = False
        modis = pd.concat(modis_parts, ignore_index=True)
        if modis.duplicated(['month_id', 'cell']).any(): raise ValueError('Duplicate MODIS monthly cells')
        cells = modis.merge(viirs, on=['month_id', 'cell'], how='outer').fillna(0)
        cells[['modis', 'viirs', 'unknown']] = cells[['modis', 'viirs', 'unknown']].astype(int)
        cells['country_id'] = grid[cells.cell.astype(int).to_numpy()]
        countries = []
        for code, name in enumerate(COUNTRIES):
            ids = np.flatnonzero(grid == code)
            if not len(ids): raise ValueError('No comparable cells for '+name)
            lat, lon = -90+(ids//NX+.5)*RES, -180+(ids % NX+.5)*RES
            records = []
            for month_id, label in zip(range(first, last+1), labels):
                subset = cells.loc[(cells.country_id == code) & (cells.month_id == month_id)]
                m = int(subset.modis.sum()) if month_id in modis_months else None
                v = int(subset.viirs.sum()) if coverage[label] else None
                points = [[int(r.cell), int(r.modis) if m is not None else None,
                           int(r.viirs) if v is not None else None, int(r.unknown)] for r in subset.itertuples()]
                records.append({'month': label, 'modis': m, 'viirs': v, 'unknown': int(subset.unknown.sum()),
                                'viirs_type_filter': 'NRT: type unavailable' if label >= '2026-08' else 'SP: type 0',
                                'viirs_file_coverage': coverage[label], 'cells': points})
            calibration = fit_scale(records)
            for r in records:
                factor = calibration['factor']
                r['adjusted'] = float(r['viirs']*factor) if factor is not None and r['viirs'] is not None else None
            harmonize_records(records, calibration)
            add_historical_comparisons(records)
            countries.append({'name': name, 'grid_cells': len(ids), 'bounds': [[float(lat.min()-.125), float(lon.min()-.125)],
                               [float(lat.max()+.125), float(lon.max()+.125)]], 'months': records, 'calibration': calibration})
    metadata = {'schema_version': 2, 'first_month': labels[0], 'last_month': labels[-1], 'months': labels,
        'resolution_deg': RES, 'harmonized_metric': 'MODIS-scale detected grid-cell-day index',
        'reference_first_year': 2003, 'reference_last_year': 2023, 'minimum_baseline_years': 5,
        'baseline_rule': 'Same calendar month, supplied MODIS years 2003-2023 strictly before the selected year; minimum 5 years. Descriptive 10th-90th percentile range, not a forecast interval.',
        'stitch_rule': 'Use MODIS where supplied; otherwise use frozen training-only country factor times VIIRS. Never add overlapping sensors.',
        'latest_complete_month': labels[-1], 'excluded_partial_month': month_label(last+1),
        'points_first_date': str(raw.acq_date.min()),
        'points_last_date': str(min(pd.Timestamp(raw.acq_date.max()),pd.Timestamp(labels[-1]+'-01')+pd.offsets.MonthEnd(0)).date()),
        'metric': 'Detected grid-cell days (sum of distinct days with detections in each cell)',
        'zero_meaning': 'No retained detections; not proof of no fire or clear-sky observation',
        'package_sha256': hashlib.sha256(package.read_bytes()).hexdigest(), 'verified_files': checked,
        'raw_viirs_rows': len(raw), 'window_viirs_rows': int(data.month_id.between(first, last).sum()),
        'included_viirs_rows': int(data.calendar_included.sum()),
        'limitations': [
            'Monthly aggregate alignment prototype, not event-level MODIS/VIIRS harmonization.',
            'Interior 0.25-degree cells only: centres and corners within coarse delivered boundaries; coastal/border cells excluded.',
            'Same supplied static-source cell mask applied to both instruments; no fine-pixel persistence filter.',
            'MODIS confidence >=30 and type 0 were applied upstream; VIIRS nominal/high and type 0 when available.',
            'MODIS 2026 absent; NRT VIIRS lacks type from August 2026. Adjustment after that date is provisional.',
            'Source completeness and clear-sky observation opportunities cannot be verified. Zero is not confirmed absence.',
            'Raw MODIS locations/times and FRP are unavailable. No long-term climate trend is inferred.',
            'Pre-2003 MODIS has changing satellite coverage; excluded from the seasonal reference.',
            'The reference uses 2003-2023; 2024-2025 are reserved for overlap assessment, not the historical baseline.',
            'The latest partial month is excluded; the displayed latest full month is not live monitoring.',
            'Calendar-scale adjustment is validated on only five held-out months; seasonal and cell-level equivalence is unproven.',
            'The adjustment is a country-total scaling, not an estimate of unique fires or burned area.'
        ]}
    payload = {'metadata': metadata, 'countries': countries}
    out.mkdir(parents=True, exist_ok=True)
    atomic_json(out/'history_latest.json', payload)
    records = []
    for country in countries:
        for month in country['months']:
            records.append({'country': country['name'], **{k: ('; '.join(v) if isinstance(v,list) else v) for k, v in month.items() if k != 'cells'}})
    pd.DataFrame(records).to_csv(out/'history_monthly.csv', index=False)
    points = data.loc[data.month_id.between(first, last), list(raw.columns)+['calendar_included']]
    points.to_csv(out/'viirs_points.csv.gz', index=False, compression='gzip')
    print(f'Package checksums verified: {checked}; VIIRS input={len(raw):,}, included={data.calendar_included.sum():,}')
    print(f'Calendar: {labels[0]} .. {labels[-1]}; {len(countries)} countries; no downloads or extraction')
    for c in countries:
        p = c['calibration']
        print(c['name'], 'interior cells=', c['grid_cells'], 'calibration=', json.dumps(p))
    print('Generated artifacts MB:', round(sum(p.stat().st_size for p in out.iterdir() if p.is_file())/1e6, 3))
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, required=True)
    args = parser.parse_args()
    build(args.package)


def detections_csv(out, country, start, end):
    """Read-only export, restricted to the supplied countries and calendar window."""
    out = Path(out)
    metadata = json.loads((out/'history_latest.json').read_text(encoding='utf-8'))['metadata']
    if country not in COUNTRIES or not all(re.fullmatch(r'\d{4}-\d{2}', value or '') for value in [start, end]):
        raise ValueError('Choose a supported country and YYYY-MM range')
    if not metadata['first_month'] <= start <= end <= metadata['last_month']:
        raise ValueError('Range outside the supplied calendar')
    first = pd.Timestamp(start+'-01')
    last = pd.Timestamp(end+'-01')+pd.offsets.MonthEnd(0)
    points = pd.read_csv(out/'viirs_points.csv.gz', dtype={'acq_time': str, 'version': str})
    dates = pd.to_datetime(points.acq_date)
    return points.loc[points.country.eq(country) & dates.between(first, last)].to_csv(index=False)


if __name__ == '__main__': main()
