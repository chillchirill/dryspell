r"""Build/serve the partner's map with cached probability and spread forecasts.

  .venv\Scripts\python.exe fire_dashboard.py build --refresh-spread
  .venv\Scripts\python.exe fire_dashboard.py serve --port 8000

No training, weather/FIRMS downloads, credentials, commits or deployment.
The read-only server binds to 127.0.0.1 and exposes only the map and JSON APIs:
  GET /api/forecast             columnar probability data + UTC day windows
  GET /api/spread?source=active GeoJSON, source=active|scenario|ireland|europe
  GET /api/status               available snapshots
Output HTML embeds all four spread snapshots, so it can also open as a file.
Re-run build --refresh-spread after the partner updates forecast_latest.csv.
"""
from __future__ import annotations
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
from types import SimpleNamespace
from urllib.parse import urlsplit, parse_qs

import numpy as np
import pandas as pd
from fire_spread_web import atomic_json, utc

ROOT=Path(__file__).resolve().parent
COLORS={'Low':'#facc15','Moderate':'#fb923c','High':'#ef4444','Very high':'#be123c'}


def embedded_constant(html,name):
    match=re.search(r'^const '+re.escape(name)+r'\s*=\s*',html,re.MULTILINE)
    if match:
        try: return json.JSONDecoder().raw_decode(html[match.end():])[0]
        except json.JSONDecodeError: pass
    return None


def safe_json(value):
    return json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':')).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026')


def forecast_payload(frame,previous_html=''):
    if frame.empty or frame.valid_from_utc.nunique()!=1 or frame.valid_to_utc.nunique()!=1:
        raise ValueError('Expected one nonempty forecast snapshot')
    tau=pd.Timestamp(frame.valid_from_utc.iloc[0])
    if tau.tzinfo is not None: tau=tau.tz_convert('UTC').tz_localize(None)
    columns=['probability']+sorted([c for c in frame if re.fullmatch(r'prob_day\d+',c)],key=lambda c:int(c[8:]))
    leads=[0]+[int(c[8:])-1 for c in columns[1:]]
    if leads!=list(range(len(leads))): raise ValueError('Forecast days must be consecutive')
    country_codes,countries=pd.factorize(frame.country.fillna('Unassigned'))
    def values(column,scale=1):
        a=pd.to_numeric(frame[column],errors='coerce').to_numpy(float)*scale
        return [int(round(x)) if np.isfinite(x) else None for x in a]
    probabilities=frame[columns].to_numpy(float)
    if not np.isfinite(probabilities).all() or np.any((probabilities<0)|(probabilities>1)):
        raise ValueError('Invalid cached probabilities')
    data={'lat':frame.lat.tolist(),'lon':frame.lon.tolist(),'cty':country_codes.tolist(),
          'countries':countries.tolist(),'det':values('detections_last_24h'),
          'fresh':frame.new_ignition.astype(str).str.lower().eq('true').astype(int).tolist(),
          'rain7':values('rain_7d_mm',10),'dsr':values('days_since_rain'),
          'probability_scale':1000000,'p':[values(c,1000000) for c in columns]}
    for target,column,scale in [('tmax','tmax_C',10),('rh','rhmin_pct',1),('wind','wind_max_ms',10)]:
        data[target]=[values(column,scale)]+[[None]*len(frame) for _ in columns[1:]]
    old_meta=embedded_constant(previous_html,'META') or {}
    old_data=embedded_constant(previous_html,'D')
    days=[{'from':utc(tau+pd.Timedelta(days=k)),'to':utc(tau+pd.Timedelta(days=k+1))} for k in leads]
    # Preserve richer per-day weather from a matching partner-generated map.
    if old_data and old_meta.get('days')==days and old_data.get('lat')==data['lat'] and old_data.get('lon')==data['lon']:
        for k in ['tmax','rh','wind']: data[k]=old_data[k]
    rows=old_meta.get('rows',[])
    rows=[row for row in rows if row[0] not in ['Snapshot','Spread coverage']]
    rows += [['Snapshot',utc(tau)],['Spread coverage','First 24 hours; cached GFS and FIRMS']]
    return {'schema_version':1,'data':data,'metadata':{'days':days,'rows':rows},'grid_resolution_deg':.25},tau


def ireland_points(frame,borders_path=None):
    """Regional what-if scenarios, independent of the global new-ignition ranking."""
    selected=frame.country.eq('Ireland').to_numpy(copy=True)
    if frame.country.eq('United Kingdom').any():
        from matplotlib.path import Path as PolygonPath
        path=borders_path or ROOT/'data/ne_110m_admin_0_countries.geojson'
        if not path.exists():
            raise FileNotFoundError('Missing cached boundaries for Northern Ireland; downloads disabled')
        boundaries=json.loads(path.read_text(encoding='utf-8'))
        northern=[]
        for feature in boundaries['features']:
            if feature['properties'].get('ADMIN')!='United Kingdom':continue
            geometry=feature['geometry']
            polygons=geometry['coordinates'] if geometry['type']=='MultiPolygon' else [geometry['coordinates']]
            # Select the disconnected Northern Ireland polygon by a point inside it.
            northern.extend(poly for poly in polygons if PolygonPath(poly[0]).contains_point((-6.7,54.6)))
        if not northern:raise ValueError('Northern Ireland polygon not found in cached boundaries')
        coords=frame[['lon','lat']].to_numpy()
        for poly in northern:
            inside=PolygonPath(poly[0]).contains_points(coords)
            for hole in poly[1:]:inside &= ~PolygonPath(hole).contains_points(coords)
            selected |= frame.country.eq('United Kingdom').to_numpy() & inside
    points=frame.loc[selected].sort_values(
        ['probability','lat','lon'],ascending=[False,True,True]).copy()
    if not np.isfinite(points[['lat','lon','probability','rhmin_pct','days_since_rain']]).all().all():
        raise ValueError('Non-finite Ireland scenario inputs')
    points['cluster_id']=np.arange(len(points))
    points['n_points'],points['frp_sum']=0,0.
    return points


def build_ireland(frame,tau):
    import fire_spread as fs
    from fire_spread_web import export_forecast
    points=ireland_points(frame)
    # This helper reads cached U/V only and raises if the required cache is missing.
    uv,cycle=fs.cached_latest_wind_uv(tau)
    payload=export_forecast(fs,points,uv,points.rhmin_pct.to_numpy(),points.days_since_rain.to_numpy(),
        'scenario',tau,cycle,.4,output_name='ireland',region='Island of Ireland (including Northern Ireland)')
    if len(points):
        print(f'Ireland: {len(points)} cached cells; probability {points.probability.min():.4%} .. '
              f'{points.probability.max():.4%}; conditional scenarios, not confirmed fires',flush=True)
        print('Ireland coverage by country: '+str(points.country.value_counts().to_dict()),flush=True)
    return payload


def country_scenario_points(frame,countries,exclude=()):
    """Select real forecast cells, preserving probabilities and avoiding regional duplicates."""
    points=frame.loc[frame.country.isin(countries)].copy()
    omitted=set(exclude)
    points=points.loc[[pair not in omitted for pair in zip(points.lon,points.lat)]]
    points=points.sort_values(['probability','lat','lon'],ascending=[False,True,True]).copy()
    if not np.isfinite(points[['lat','lon','probability','rhmin_pct','days_since_rain']]).all().all():
        raise ValueError('Non-finite regional scenario inputs')
    points['cluster_id']=np.arange(len(points))
    points['n_points'],points['frp_sum']=0,0.
    return points


def build_europe(frame,tau,ireland):
    import fire_spread as fs
    from fire_spread_web import export_forecast
    exclude=[tuple(f['geometry']['coordinates']) for f in ireland['features']]
    points=country_scenario_points(frame,['United Kingdom','Spain','France'],exclude)
    uv,cycle=fs.cached_latest_wind_uv(tau)
    payload=export_forecast(fs,points,uv,points.rhmin_pct.to_numpy(),points.days_since_rain.to_numpy(),
        'scenario',tau,cycle,.4,output_name='europe',region='United Kingdom, Spain, France (Ireland layer excluded)')
    print('Additional regional cells: '+str(points.country.value_counts().to_dict()),flush=True)
    return payload


def build(refresh=False):
    out=ROOT/'output/firms'; spread=ROOT/'output/spread'
    forecast=out/'forecast_latest.csv'
    if not forecast.exists(): raise FileNotFoundError('Missing cached forecast_latest.csv')
    frame=pd.read_csv(forecast)
    target=out/'forecast_map.html'
    old=target.read_text(encoding='utf-8') if target.exists() else ''
    payload,tau=forecast_payload(frame,old)
    if refresh:
        import fire_spread as fs
        common=dict(eps_km=2.,min_samples=5,match_km=10.,novelty_km=.75,min_new=3,midflame_factor=.4,as_of=str(tau))
        # Active last, so spread_latest.csv continues to describe observed fires.
        for mode in ['scenario','active']:
            fs.run_forecast(SimpleNamespace(mode=mode,**common))
    snapshots={}
    for source in ['active','scenario']:
        path=spread/f'spread_{source}.geojson'
        if not path.exists(): raise FileNotFoundError(f'Missing {path.name}; use build --refresh-spread')
        snapshot=json.loads(path.read_text(encoding='utf-8'))
        if snapshot['metadata']['issued_at_utc']!=utc(tau):
            raise ValueError(f'{source} spread and probability issue times differ; use build --refresh-spread')
        snapshots[source]=snapshot
    snapshots['ireland']=build_ireland(frame,tau)
    snapshots['europe']=build_europe(frame,tau,snapshots['ireland'])
    recent_path=spread/'recent_detections.json'
    recent=json.loads(recent_path.read_text()) if recent_path.exists() else {}
    points=recent.get('points',[]) if recent.get('issued_at_utc')==utc(tau) else []
    borders=embedded_constant(old,'B')
    if borders is None:
        geo=ROOT/'data/ne_110m_admin_0_countries.geojson'
        if not geo.exists(): raise FileNotFoundError('Missing cached country borders')
        borders=[]
        for feature in json.loads(geo.read_text())['features']:
            geometry=feature['geometry']; coords=geometry['coordinates']
            polys=[coords] if geometry['type']=='Polygon' else coords
            for polygon in polys: borders.append([[lat,lon] for lon,lat,*rest in polygon[0]])
    html=(ROOT/'map_template.html').read_text(encoding='utf-8')
    for token,value in {'__DATA__':payload['data'],'__PTS__':points,'__BORDERS__':borders,
                         '__META__':payload['metadata'],'__COLORS__':COLORS,'__RES__':.25}.items():
        html=html.replace(token,safe_json(value))
    html=html.replace('<script type="application/json" id="spread-payload">{}</script>',
                      '<script type="application/json" id="spread-payload">'+safe_json(snapshots)+'</script>')
    temp=target.with_suffix('.html.part'); temp.write_text(html,encoding='utf-8'); temp.replace(target)
    atomic_json(out/'forecast_web.json',payload)
    print(f'Built {target}; probability cells={len(frame)}, forecast days={len(payload["data"]["p"])}, '
          f'active={len(snapshots["active"]["features"])}, scenario={len(snapshots["scenario"]["features"])}, '
          f'ireland={len(snapshots["ireland"]["features"])}, europe={len(snapshots["europe"]["features"])}',flush=True)
    return target


class DashboardHandler(BaseHTTPRequestHandler):
    def handle(self):
        try:
            super().handle()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            # Browsers may close pending connections during reload or navigation.
            pass

    def do_GET(self):
        parts=urlsplit(self.path)
        if parts.path in ['/','/forecast_map.html']:
            path=ROOT/'output/firms/forecast_map.html'; content_type='text/html; charset=utf-8'
        elif parts.path=='/api/forecast':
            path=ROOT/'output/firms/forecast_web.json'; content_type='application/json'
        elif parts.path=='/api/spread':
            source=parse_qs(parts.query).get('source',['active'])[0]
            if source not in ['active','scenario','ireland','europe']:
                return self.json_response({'error':'source must be active, scenario, ireland or europe'},400)
            path=ROOT/'output/spread'/f'spread_{source}.geojson'; content_type='application/geo+json'
        elif parts.path=='/api/status':
            info={}
            for source in ['active','scenario','ireland','europe']:
                path=ROOT/'output/spread'/f'spread_{source}.geojson'
                info[source]=json.loads(path.read_text())['metadata'] if path.exists() else None
            return self.json_response(info)
        else:
            return self.json_response({'error':'not found'},404)
        if not path.exists(): return self.json_response({'error':'snapshot unavailable; build cached dashboard first'},503)
        self.send_response(200); self.send_header('Content-Type',content_type)
        self.send_header('Cache-Control','no-store'); self.send_header('X-Content-Type-Options','nosniff')
        data=path.read_bytes(); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)

    def json_response(self,value,status=200):
        data=json.dumps(value,allow_nan=False).encode()
        self.send_response(status); self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(data))); self.send_header('Cache-Control','no-store')
        self.end_headers(); self.wfile.write(data)

    def log_message(self,format,*args):
        # Do not log request URLs, headers or possible credentials in query strings.
        pass


def main():
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('mode',choices=['build','serve'])
    parser.add_argument('--refresh-spread',action='store_true')
    parser.add_argument('--port',type=int,default=8000)
    args=parser.parse_args()
    if args.mode=='build': build(args.refresh_spread)
    else:
        if not (ROOT/'output/firms/forecast_map.html').exists(): raise FileNotFoundError('Build the dashboard first')
        server=ThreadingHTTPServer(('127.0.0.1',args.port),DashboardHandler)
        print(f'Dashboard: http://127.0.0.1:{server.server_port}/',flush=True)
        try: server.serve_forever()
        except KeyboardInterrupt: pass
        finally: server.server_close()


if __name__=='__main__':
    main()
