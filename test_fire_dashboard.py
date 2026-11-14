"""Offline export and read-only API checks."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.request import urlopen
from urllib.error import HTTPError

import numpy as np
import pandas as pd

import fire_spread as fs
import fire_spread_web as web
import fire_dashboard as dashboard


class ExportTests(unittest.TestCase):
    def test_destination_and_antimeridian(self):
        lon,lat=web.destination(0,0,0,111.1950802335)
        self.assertAlmostEqual(lat,1.,places=6);self.assertAlmostEqual(lon,0.)
        lon,lat=web.destination(0,179.99,90,3.)
        self.assertLess(lon,-179.9);self.assertAlmostEqual(lat,0.)

    def test_wind_spread_are_distinct_and_json_has_timed_frames(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);out=root/'output/spread';out.mkdir(parents=True)
            (out/'blend_model.json').write_text(json.dumps({'split':{'train_last_day':'2026-08-01'},
                'wind_persistence':{'w_wind':0.,'wind_power':1.}}))
            points=pd.DataFrame({'cluster_id':[0],'lat':[0.],'lon':[0.],'n_points':[20],'frp_sum':[5.]})
            uv={'u':np.ones((5,361,720),np.float32)*3,'v':np.zeros((5,361,720),np.float32)}
            with patch.object(fs,'ROOT',root),contextlib.redirect_stdout(io.StringIO()):
                payload=web.export_forecast(fs,points,uv,[20.],[10.],'active',pd.Timestamp('2026-11-13 17:00'),
                    pd.Timestamp('2026-11-13 12:00'),.4,np.array([0.]))
            feature=payload['features'][0];frames=feature['properties']['frames']
            self.assertEqual([f['hour'] for f in frames],[6,12,18,24])
            self.assertEqual(frames[0]['valid_at_utc'],'2026-11-13T23:00:00Z')
            self.assertEqual(frames[-1]['valid_at_utc'],'2026-11-14T17:00:00Z')
            self.assertEqual(frames[0]['wind_bearing_deg'],90.)
            self.assertEqual(frames[0]['spread_bearing_deg'],0.)
            self.assertGreater(frames[-1]['head_position'][1],0.)
            self.assertAlmostEqual(frames[-1]['head_position'][0],0.)
            self.assertTrue(all(a['cumulative_head_distance_km']<b['cumulative_head_distance_km'] for a,b in zip(frames,frames[1:])))
            json.dumps(payload,allow_nan=False)

    def test_calm_does_not_invent_northward_movement(self):
        with tempfile.TemporaryDirectory() as folder:
            points=pd.DataFrame({'cluster_id':[0],'lat':[0.],'lon':[0.],'n_points':[5],'frp_sum':[1.]})
            uv={'u':np.zeros((5,361,720)),'v':np.zeros((5,361,720))}
            with patch.object(fs,'ROOT',Path(folder)),contextlib.redirect_stdout(io.StringIO()):
                payload=web.export_forecast(fs,points,uv,[20.],[10.],'active',pd.Timestamp('2026-11-13'),pd.Timestamp('2026-11-12 12:00'),.4)
            self.assertIsNone(payload['features'][0]['properties']['frames'][0]['wind_bearing_deg'])
            self.assertIsNone(payload['features'][0]['properties']['frames'][0]['head_position'])

    def test_safe_embedded_json(self):
        value={'name':'</script><script>alert(1)</script> & test'}
        encoded=dashboard.safe_json(value)
        self.assertNotIn('<',encoded)
        self.assertEqual(json.loads(encoded),value)

    def test_csv_future_day_does_not_invent_weather(self):
        frame=pd.DataFrame({'lat':[0.],'lon':[0.],'country':['A'],'probability':[.1],'prob_day2':[.2],
            'new_ignition':[True],'detections_last_24h':[0],'rain_7d_mm':[0.],'days_since_rain':[10],
            'tmax_C':[30.],'rhmin_pct':[20.],'wind_max_ms':[3.],
            'valid_from_utc':['2026-11-13 17:00:00'],'valid_to_utc':['2026-11-14 17:00:00']})
        payload,tau=dashboard.forecast_payload(frame)
        self.assertEqual(payload['data']['p'],[[100000],[200000]])
        self.assertEqual(payload['data']['probability_scale'],1000000)
        self.assertEqual(payload['data']['wind'],[[30],[None]])
        self.assertEqual(payload['metadata']['days'][1]['from'],'2026-11-14T17:00:00Z')

    def test_ireland_scenarios_preserve_low_probabilities_and_do_not_require_new_ignition(self):
        frame=pd.DataFrame({'country':['Ireland','Ireland','Brazil'],
            'lat':[53.,54.,0.],'lon':[-7.,-8.,-40.],'probability':[.0104,.0167,.8],
            'new_ignition':[False,False,True],'rhmin_pct':[70.,80.,20.],'days_since_rain':[1.,2.,10.]})
        points=dashboard.ireland_points(frame)
        self.assertEqual(points.probability.tolist(),[.0167,.0104])
        self.assertFalse(points.new_ignition.any())
        self.assertTrue((points.n_points==0).all())
        self.assertTrue(dashboard.ireland_points(frame.loc[frame.country.eq('Brazil')]).empty)

    def test_island_selection_includes_northern_ireland_and_excludes_great_britain(self):
        frame=pd.DataFrame({'country':['Ireland','United Kingdom','United Kingdom'],
            'lat':[53.,54.6,55.],'lon':[-7.,-6.7,-3.],'probability':[.01,.47,.9],
            'new_ignition':[False]*3,'rhmin_pct':[70.]*3,'days_since_rain':[1.]*3})
        boundaries={'features':[{'properties':{'ADMIN':'United Kingdom'},'geometry':{
            'type':'MultiPolygon','coordinates':[
                [[[-8.,54.],[-5.5,54.],[-5.5,55.5],[-8.,55.5],[-8.,54.]]],
                [[[-5.,50.],[2.,50.],[2.,59.],[-5.,59.],[-5.,50.]]]]}}]}
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'borders.json';path.write_text(json.dumps(boundaries))
            points=dashboard.ireland_points(frame,path)
            self.assertEqual(points.probability.tolist(),[.47,.01])
            self.assertEqual(points.country.tolist(),['United Kingdom','Ireland'])
            with self.assertRaises(FileNotFoundError):dashboard.ireland_points(frame,Path(folder)/'missing.json')

    def test_additional_countries_keep_probabilities_and_exclude_existing_ireland_cells(self):
        frame=pd.DataFrame({'country':['United Kingdom','United Kingdom','Spain','France','Brazil'],
            'lat':[54.6,52.,40.,48.,0.],'lon':[-6.7,-1.,-3.,2.,-40.],
            'probability':[.47,.01,.03,.02,.9],'new_ignition':[False]*5,
            'rhmin_pct':[70.]*5,'days_since_rain':[1.]*5})
        points=dashboard.country_scenario_points(frame,['United Kingdom','Spain','France'],[(-6.7,54.6)])
        self.assertEqual(points.country.tolist(),['Spain','France','United Kingdom'])
        self.assertEqual(points.probability.tolist(),[.03,.02,.01])
        self.assertFalse(points.new_ignition.any())
        self.assertTrue((points.n_points==0).all())
        self.assertTrue(dashboard.country_scenario_points(frame,['Portugal']).empty)


class APITests(unittest.TestCase):
    def test_only_public_snapshots_are_served(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'output/spread').mkdir(parents=True);(root/'output/firms').mkdir(parents=True)
            data={'type':'FeatureCollection','metadata':{'source':'active'},'features':[]}
            (root/'output/spread/spread_active.geojson').write_text(json.dumps(data))
            (root/'output/spread/spread_ireland.geojson').write_text(json.dumps(data))
            (root/'output/spread/spread_europe.geojson').write_text(json.dumps(data))
            (root/'output/firms/forecast_map.html').write_text('<!doctype html><title>Forecast</title>')
            (root/'output/firms/forecast_web.json').write_text('{"data":{}}')
            with patch.object(dashboard,'ROOT',root):
                server=dashboard.ThreadingHTTPServer(('127.0.0.1',0),dashboard.DashboardHandler)
                worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
                base=f'http://127.0.0.1:{server.server_port}'
                try:
                    with urlopen(base+'/api/spread?source=active') as r:
                        self.assertEqual(json.load(r),data)
                        self.assertEqual(r.headers['Content-Type'],'application/geo+json')
                    with urlopen(base+'/api/spread?source=ireland') as r:
                        self.assertEqual(json.load(r),data)
                    with urlopen(base+'/api/spread?source=europe') as r:
                        self.assertEqual(json.load(r),data)
                    for path,code in [('/.env',404),('/fire_forecast.py',404),('/api/spread?source=../../.env',400),('/api/spread?source=scenario',503)]:
                        with self.assertRaises(HTTPError) as error:urlopen(base+path)
                        self.assertEqual(error.exception.code,code)
                finally:
                    server.shutdown();server.server_close();worker.join()


if __name__=='__main__':unittest.main()
