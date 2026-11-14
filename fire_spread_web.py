"""Animation-ready GeoJSON exports for the existing wildfire map.

Coordinate order is [longitude, latitude]. Frames contain six-hour local wind
vectors and illustrative head-fire positions; these are not burned perimeters.
Wind blows TO the reported bearing. Spread uses the train-only calibrated
wind/persistence blend when available, with wind-only fallback. Terrain is not
enabled because it did not improve held-out mean angular error.
"""
from pathlib import Path
import json
import hashlib
import numpy as np
import pandas as pd


def utc(value):
    t = pd.Timestamp(value)
    t = t.tz_localize('UTC') if t.tzinfo is None else t.tz_convert('UTC')
    return t.strftime('%Y-%m-%dT%H:%M:%SZ')


def destination(lat, lon, bearing_deg, distance_km):
    p, l, b = np.radians([lat, lon, bearing_deg])
    d = distance_km / 6371.0088
    p2 = np.arcsin(np.clip(np.sin(p)*np.cos(d)+np.cos(p)*np.sin(d)*np.cos(b), -1, 1))
    l2 = l + np.arctan2(np.sin(b)*np.sin(d)*np.cos(p), np.cos(d)-np.sin(p)*np.sin(p2))
    return [float((np.degrees(l2)+180)%360-180), float(np.degrees(p2))]


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix+'.part')
    temporary.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')), encoding='utf-8')
    temporary.replace(path)


def finite(value):
    return float(value) if np.isfinite(value) else None


def export_forecast(fs, points, uv, rh, dry, source, tau, cycle, midflame_factor, persistence=None,
                    *, output_name=None, region=None):
    n = len(points)
    persistence = np.full(n, np.nan) if persistence is None else np.asarray(persistence, float)
    model_path = fs.ROOT/'output/spread/blend_model.json'
    parameters = None
    model_meta = {'id':'wind_only', 'label':'Wind-only estimate'}
    if model_path.exists():
        fitted = json.loads(model_path.read_text())
        # Last training source day has a next-day label: all labels must predate issue.
        if pd.Timestamp(fitted['split']['train_last_day'])+pd.Timedelta(days=2) <= tau:
            parameters = fitted['wind_persistence']
            model_meta = {'id':'wind_persistence', 'label':'Wind + previous spread',
                          'training_last_source_day':fitted['split']['train_last_day'],
                          'sha256':hashlib.sha256(model_path.read_bytes()).hexdigest()}
    if not np.isfinite(persistence).any():
        model_meta = {'id':'wind_only','label':'Wind-only (no previous spread available)'}
    meta = {'schema_version':1, 'source':source, 'issued_at_utc':utc(tau),
            'valid_to_utc':utc(tau+pd.Timedelta(hours=24)), 'gfs_cycle_utc':utc(cycle),
            'horizons_hours':[6,12,18,24], 'model':model_meta,
            'bearing_convention':'degrees clockwise from north; wind blows TO',
            'distance_kind':'heuristic cumulative head-fire travel, not burned area',
            'feature_count':n}
    if region is not None:
        meta['region'] = region
        meta['selection'] = 'All cached forecast cells in the region; conditional on a fire occurring'
    features=[]
    if n:
        sampled=fs.wind_at_points(uv,points)
        speed, mean_bearing, intervals=fs.wind_summary(sampled)
        ws=np.hypot(intervals['u'],intervals['v'])
        wind_bearing=np.where(ws>=.1,np.degrees(np.arctan2(intervals['u'],intervals['v']))%360,np.nan)
        rates=fs.ellipse_rates(ws,np.asarray(rh)[None,:],np.asarray(dry)[None,:],midflame_factor)
        segment_km=6*fs.ellipse_radius(rates,0)
        spread_bearing=wind_bearing.copy()
        if parameters is not None:
            for step in range(4):
                records=pd.DataFrame({'bearing_deg':wind_bearing[step], 'wind_speed_ms':ws[step],
                                      'persistence_bearing_deg':persistence})
                spread_bearing[step]=fs.blend_direction(records,parameters)
                # In calm intervals persistence may still provide a direction.
                calm=~np.isfinite(wind_bearing[step]) & np.isfinite(persistence)
                spread_bearing[step,calm]=persistence[calm]
        for j,row in enumerate(points.itertuples(index=False)):
            origin=[float(row.lon),float(row.lat)]
            position=origin.copy(); cumulative=0.; frames=[]
            for step,hour in enumerate([6,12,18,24]):
                cumulative+=float(segment_km[step,j])
                direction=finite(spread_bearing[step,j])
                if position is not None and direction is not None:
                    position=destination(position[1],position[0],direction,float(segment_km[step,j]))
                else:
                    position=None
                frames.append({'hour':hour,'valid_at_utc':utc(tau+pd.Timedelta(hours=hour)),
                    'wind_u_ms':float(intervals['u'][step,j]),'wind_v_ms':float(intervals['v'][step,j]),
                    'wind_speed_ms':float(ws[step,j]),'wind_bearing_deg':finite(wind_bearing[step,j]),
                    'spread_bearing_deg':direction,'head_position':position.copy() if position is not None else None,
                    'segment_distance_km':float(segment_km[step,j]),'cumulative_head_distance_km':cumulative})
            properties={'cluster_id':int(row.cluster_id),'source':source,'n_points':int(row.n_points),
                'frp_sum':float(row.frp_sum),'wind_speed_ms':float(speed[j]),
                'wind_bearing_deg':finite(mean_bearing[j]),'persistence_bearing_deg':finite(persistence[j]),
                'persistence_available':bool(np.isfinite(persistence[j])),
                'direction_model':model_meta['id'] if np.isfinite(persistence[j]) else 'wind_only',
                'probability':finite(getattr(row,'probability',np.nan)), 'frames':frames}
            if hasattr(row, 'new_ignition'):
                properties['new_ignition'] = str(row.new_ignition).strip().lower() == 'true'
            if hasattr(row, 'country'):
                properties['country'] = str(row.country)
            features.append({'type':'Feature','id':f'{output_name or source}-{int(row.cluster_id)}',
                             'geometry':{'type':'Point','coordinates':origin},'properties':properties})
    payload={'type':'FeatureCollection','metadata':meta,'features':features}
    path=fs.ROOT/'output/spread'/f'spread_{output_name or source}.geojson'
    atomic_json(path,payload)
    print(f'Web export: {path.name}; {n} features; +6/+12/+18/+24h; {model_meta["label"]}',flush=True)
    return payload
