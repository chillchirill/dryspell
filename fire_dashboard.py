r"""Build/serve the partner's map with cached probability and spread forecasts.

  python fire_dashboard.py start                    # everything in one go: prepare, build, serve
  python fire_dashboard.py build --refresh-spread   # rebuild only (cached inputs, no downloads)
  python fire_dashboard.py serve --port 8000        # serve an already built map

`build` and `serve` do no training, weather/FIRMS downloads, credentials, commits or deployment.
`start` may download one small file: the GFS wind forecast for the arrows (about 4 MB), if it is not cached.
The local server binds to 127.0.0.1 and serves the map, cached JSON and offline simulation:
  GET /api/forecast             columnar probability data + UTC day windows
  GET /api/spread?source=active GeoJSON, source=active|scenario|ireland|europe
  GET /api/status               available snapshots
Output HTML embeds all four spread snapshots, so it can also open as a file.
Re-run build --refresh-spread after the partner updates forecast_latest.csv.
"""
from __future__ import annotations
import argparse
import gzip
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import subprocess
import sys
import threading
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


def compact(value,digits=5):
    """Round floats for the copy embedded in the page; files and the API keep full precision."""
    if isinstance(value,float): return round(value,digits)
    if isinstance(value,list): return [compact(v,digits) for v in value]
    if isinstance(value,dict): return {k:compact(v,digits) for k,v in value.items()}
    return value


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


def build_cached_seasons():
    """Render the partner's seasons view from monthly tables, with no acquisition helpers."""
    cache=ROOT/'data/climate_months.npz'
    target=ROOT/'output/firms/climate_map.html'
    if not cache.exists():
        return target.exists()
    paths=[ROOT/'data/static_0.25.npz',ROOT/'data/static_sources_0.25.npy',
           ROOT/'data/ne_110m_admin_0_countries.geojson',ROOT/'climate_template.html']
    if any(not p.exists() for p in paths):
        raise FileNotFoundError('Missing cached seasons reference files; no data downloaded')
    if target.exists() and target.stat().st_mtime_ns >= max(p.stat().st_mtime_ns for p in [cache,*paths]):
        return True
    with np.load(cache,allow_pickle=False) as source:
        months={int(k[1:]):source[k] for k in source.files if re.fullmatch(r'm\d+',k)}
        first,last=str(source['first']),str(source['last'])
    keys=sorted(months)
    if len(keys)<12 or any(b-a!=1 for a,b in zip(keys[-24:],keys[-24:][1:])):
        raise ValueError('Seasons require at least 12 consecutive cached complete months')
    for values in months.values():
        if values.shape!=(720*1440,) or not np.isfinite(values).all() or ((values<0)|(values>1)).any():
            raise ValueError('Invalid cached monthly detection-day fractions')
    # The existing local country cache stores its names as an object array.
    with np.load(paths[0],allow_pickle=True) as source:
        country=source['country'].ravel();names=list(source['names'])
    static=np.load(paths[1],allow_pickle=False)
    recent,before=keys[-12:],keys[-24:-12] if len(keys)>=24 else []
    b=np.zeros((12,720*1440),np.float32);a=np.zeros_like(b)
    for key in recent:b[key%12]=months[key]
    for key in before:a[key%12]=months[key]
    ids=np.arange(720*1440);lat=-90+(ids//1440+.5)*.25;lon=-180+(ids%1440+.5)*.25
    maximum=np.maximum(a.max(0),b.max(0))
    valid=((country>=0)|(maximum>0))&~static&(lat>-60)&(lat<80)
    cells=ids[valid];keep=cells[maximum[cells]>=.01]
    countries=np.where(country[keep]>=0,np.asarray(names,dtype=object)[np.maximum(country[keep],0)],'Ocean / unassigned')
    codes,unique=pd.factorize(countries)
    mat=lambda values:[np.round(values[m,keep]*1000).astype(int).tolist() for m in range(12)]
    data={'lat':np.round(lat[keep],3).tolist(),'lon':np.round(lon[keep],3).tolist(),
          'cty':codes.tolist(),'countries':[str(x) for x in unique],'B':mat(b),'A':mat(a) if before else None}
    month_names=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    label=lambda ks:f'{month_names[ks[0]%12]} {ks[0]//12} - {month_names[ks[-1]%12]} {ks[-1]//12}'
    totals={name:[round(float(values[m,cells].sum()),1) for m in range(12)] for name,values in [('B',b),('A',a)]}
    meta={'recent':label(recent),'before':label(before) if before else None,
          'totals':{'B':totals['B'],'A':totals['A'] if before else None},
          'now_month':int(pd.Timestamp.now(tz='UTC').month)-1,
          'rows':[['Fire data',f'NASA FIRMS VIIRS, {first} to {last}'],['Months used',f'{len(keys)} complete months'],
                  ['Grid','0.25 degree cells'],['Method','VIIRS only; not the harmonized MODIS + VIIRS calendar']]}
    borders=[]
    for feature in json.loads(paths[2].read_text(encoding='utf-8'))['features']:
        g=feature['geometry'];polygons=g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
        borders.extend([[[round(y,2),round(x,2)] for x,y,*_ in polygon[0]] for polygon in polygons])
    html=paths[3].read_text(encoding='utf-8')
    for token,value in {'__DATA__':data,'__BORDERS__':borders,'__META__':meta,'__RES__':.25}.items():
        html=html.replace(token,safe_json(value))
    target.parent.mkdir(parents=True,exist_ok=True)
    temp=target.with_suffix('.html.part');temp.write_text(html,encoding='utf-8');temp.replace(target)
    pd.DataFrame({'month':month_names,'burning_squares_recent':totals['B'],
                  'burning_squares_before':totals['A'] if before else np.nan}).to_csv(target.parent/'climate_by_month.csv',index=False)
    print(f'Built cached VIIRS seasons: {len(keep):,} cells; {label(recent)}; no downloads',flush=True)
    return True


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
        if not path.exists():
            raise FileNotFoundError(f'Missing {path.name}. Run:  python fire_dashboard.py start  '
                                    '(or build --refresh-spread when the wind cache exists)')
        snapshot=json.loads(path.read_text(encoding='utf-8'))
        if snapshot['metadata']['issued_at_utc']!=utc(tau):
            raise ValueError(f'{source} spread and probability issue times differ; use build --refresh-spread')
        snapshots[source]=snapshot
    snapshots['ireland']=build_ireland(frame,tau)
    snapshots['europe']=build_europe(frame,tau,snapshots['ireland'])
    recent_path=spread/'recent_detections.json'
    recent=json.loads(recent_path.read_text()) if recent_path.exists() else {}
    points=recent.get('points',[]) if recent.get('issued_at_utc')==utc(tau) else []
    # float32 values print with 17 digits: keep what the map can show (about 10 m, 0.1 MW)
    points=[[round(float(a),4),round(float(b),4),round(float(c),1)] for a,b,c in points]
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
    if not build_cached_seasons():
        html=html.replace('<a class="btn" href="climate_map.html">Seasons and years</a>',
                          '<span class="hint">VIIRS seasons cache unavailable. Use the MODIS + VIIRS calendar.</span>')
    telemetry_js=(ROOT/'scripts/fire_telemetry.js').read_text(encoding='utf-8')
    sensors_js=(ROOT/'scripts/fire_sensors_ui.js').read_text(encoding='utf-8')
    html=html.replace('/*__SENSOR_CODE__*/',telemetry_js+'\n'+sensors_js)
    simulation_js=(ROOT/'scripts/fire_simulation_ui.js').read_text(encoding='utf-8')
    html=html.replace('<script id="simulation-code"></script>', '<script id="simulation-code">'+simulation_js+'</script>')
    for token,value in {'__DATA__':payload['data'],'__PTS__':points,'__BORDERS__':borders,
                         '__META__':payload['metadata'],'__COLORS__':COLORS,'__RES__':.25}.items():
        html=html.replace(token,safe_json(value))
    html=html.replace('<script type="application/json" id="spread-payload">{}</script>',
                      '<script type="application/json" id="spread-payload">'+safe_json(compact(snapshots))+'</script>')
    history_path=ROOT/'output/history/history_latest.json'
    if history_path.exists():
        history=json.loads(history_path.read_text(encoding='utf-8'))
        if history.get('metadata',{}).get('schema_version') != 2:
            raise ValueError('Rebuild the supplied history cache: .venv\\Scripts\\python.exe fire_history.py --package <existing handoff ZIP>')
        html=html.replace('<script type="application/json" id="history-payload">{}</script>',
                          '<script type="application/json" id="history-payload">'+safe_json(history)+'</script>')
        history_js=(ROOT/'scripts/fire_history_ui.js').read_text(encoding='utf-8')
        html=html.replace('<script id="history-code"></script>','<script id="history-code">'+history_js+'</script>')
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
        elif parts.path=='/climate_map.html':
            path=ROOT/'output/firms/climate_map.html'; content_type='text/html; charset=utf-8'
        elif parts.path=='/api/forecast':
            path=ROOT/'output/firms/forecast_web.json'; content_type='application/json'
        elif parts.path=='/api/simulation/environment':
            from fire_simulation import environment
            try:
                return self.json_response(environment(parse_qs(parts.query).get('site',['glendalough'])[0]))
            except ValueError as error:
                return self.json_response({'error':str(error)},400)
            except FileNotFoundError:
                return self.json_response({'error':'Prepared Ireland simulation is unavailable'},503)
        elif parts.path=='/api/simulation/sites':
            from fire_simulation import sites
            return self.json_response(sites())
        elif parts.path=='/api/simulation/wind':
            from fire_simulation import forecast_wind
            query=parse_qs(parts.query)
            try:
                return self.json_response(forecast_wind(float(query.get('lat',[''])[0]),
                    float(query.get('lon',[''])[0]),int(query.get('duration',['3600'])[0])))
            except ValueError as error:
                return self.json_response({'error':str(error)},400)
            except FileNotFoundError:
                return self.json_response({'error':'Matching cached GFS wind is unavailable; no data downloaded'},503)
        elif parts.path=='/api/history':
            path=ROOT/'output/history/history_latest.json'; content_type='application/json'
        elif parts.path=='/api/history/detections':
            from fire_history import detections_csv
            query=parse_qs(parts.query)
            try:
                csv=detections_csv(ROOT/'output/history',query.get('country',[''])[0],
                                   query.get('start',[''])[0],query.get('end',[''])[0])
            except ValueError as error:
                return self.json_response({'error':str(error)},400)
            except FileNotFoundError:
                return self.json_response({'error':'History package not built'},503)
            data=csv.encode('utf-8')
            self.send_response(200);self.send_header('Content-Type','text/csv; charset=utf-8')
            self.send_header('Content-Disposition','attachment; filename="viirs_points.csv"')
            self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)))
            self.end_headers();self.wfile.write(data);return
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
        self.send_file(path,content_type)

    _compressed={}

    @classmethod
    def compressed(cls,path,tag=None,data=None):
        """Gzip a file once per version; later requests reuse the result."""
        if tag is None:
            stat=path.stat(); tag=f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
        cached=cls._compressed.get(str(path))
        if not cached or cached[0]!=tag:
            cached=(tag,gzip.compress(path.read_bytes() if data is None else data,5)); cls._compressed[str(path)]=cached
        return cached[1]

    def send_file(self,path,content_type):
        """Send a file gzip-compressed when the browser accepts it; an unchanged file answers 304."""
        stat=path.stat(); tag=f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
        if self.headers.get('If-None-Match')==tag:
            self.send_response(304); self.send_header('ETag',tag); self.end_headers(); return
        data=path.read_bytes()
        self.send_response(200); self.send_header('Content-Type',content_type)
        # no-cache = always ask the server, so a rebuilt map is never shown stale
        self.send_header('Cache-Control','no-cache'); self.send_header('ETag',tag)
        self.send_header('X-Content-Type-Options','nosniff')
        if 'gzip' in self.headers.get('Accept-Encoding','') and len(data)>4096:
            data=self.compressed(path,tag,data); self.send_header('Content-Encoding','gzip'); self.send_header('Vary','Accept-Encoding')
        self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        if urlsplit(self.path).path != '/api/simulation/run':
            return self.json_response({'error':'not found'},404)
        origin=self.headers.get('Origin')
        if (origin and origin != 'http://'+self.headers.get('Host','')) or self.headers.get('Sec-Fetch-Site')=='cross-site':
            return self.json_response({'error':'Use the simulation from this dashboard'},403)
        if self.headers.get('Content-Type','').split(';')[0]!='application/json':
            return self.json_response({'error':'Expected application/json'},415)
        try:
            length=int(self.headers.get('Content-Length','0'))
        except ValueError:
            return self.json_response({'error':'Invalid request size'},400)
        if not 0 < length <= 16384:
            return self.json_response({'error':'Request must be at most 16 KB'},413)
        from fire_simulation import run
        try:
            value=json.loads(self.rfile.read(length))
            return self.json_response(run(value))
        except (ValueError, UnicodeDecodeError) as error:
            return self.json_response({'error':str(error)},400)
        except BlockingIOError as error:
            return self.json_response({'error':str(error)},429)
        except FileNotFoundError:
            return self.json_response({'error':'Simulation engine or Node is unavailable'},503)
        except subprocess.TimeoutExpired:
            return self.json_response({'error':'Calculation timed out; choose a shorter run'},504)

    def json_response(self,value,status=200):
        data=json.dumps(value,allow_nan=False).encode()
        self.send_response(status); self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(data))); self.send_header('Cache-Control','no-store')
        self.end_headers(); self.wfile.write(data)

    def log_message(self,format,*args):
        # Do not log request URLs, headers or possible credentials in query strings.
        pass


def serve(port):
    if not (ROOT/'output/firms/forecast_map.html').exists():
        raise SystemExit('The map is not built yet. Run:  python fire_dashboard.py start')
    server=ThreadingHTTPServer(('127.0.0.1',port),DashboardHandler)
    # compress the big page before the first visitor arrives
    threading.Thread(target=DashboardHandler.compressed,args=(ROOT/'output/firms/forecast_map.html',),daemon=True).start()
    print(f'Dashboard: http://127.0.0.1:{server.server_port}/   (Ctrl+C to stop)',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


def start(port):
    """Prepare everything the map needs, build it and serve it."""
    forecast=ROOT/'output/firms/forecast_latest.csv'
    if not forecast.exists():
        raise SystemExit('No forecast yet. Run first:  python fire_forecast.py predict')
    tau=pd.Timestamp(pd.read_csv(forecast,usecols=['valid_from_utc'],nrows=1).valid_from_utc.iloc[0])
    if tau.tzinfo is not None: tau=tau.tz_convert('UTC').tz_localize(None)
    import fire_spread as fs
    try:
        fs.cached_latest_wind_uv(tau)
    except FileNotFoundError:
        import gfs_weather as gw
        print('Wind forecast for the arrows is not cached: downloading it from NOAA GFS (about 4 MB)...',flush=True)
        gw.latest_wind_uv(tau,ROOT/'data/gfs_uv')
    # optional extras: skipped quietly when their inputs are not on this computer
    package=ROOT/'output/harmonization_handoff.zip'
    if not (ROOT/'output/history/history_latest.json').exists() and package.exists():
        print('Building the fire history calendar...',flush=True)
        subprocess.run([sys.executable,str(ROOT/'fire_history.py'),'--package',str(package)],cwd=ROOT,check=False)
    build_cached_seasons()
    build(True)
    serve(port)


def main():
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('mode',choices=['start','build','serve'])
    parser.add_argument('--refresh-spread',action='store_true')
    parser.add_argument('--port',type=int,default=8000)
    args=parser.parse_args()
    if args.mode=='start': start(args.port)
    elif args.mode=='build':
        try: build(args.refresh_spread)
        except FileNotFoundError as error:
            raise SystemExit(f'{error}\nTip: "python fire_dashboard.py start" prepares the missing inputs and builds the map.')
    else: serve(args.port)


if __name__=='__main__':
    main()
