"""Holdout, circular statistics, offline boundaries and terrain regression tests."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

import fire_spread as fs
import fire_terrain as ft


class EvaluationTests(unittest.TestCase):
    def test_filter_and_hit45_boundary(self):
        records = pd.DataFrame({'n_points': [20, 19, 20, 21], 'n_new': [10, 10, 9, 11],
                                'wind_bin': ['<3']*4, 'model_error_deg': [45, 44, 46, 180],
                                'persistence_error_deg': [45, np.nan, 1, 180]})
        result = fs.metrics_table(records)
        real = result.loc[(result.cohort=='real_fires') & (result.wind_bin_ms=='all')].iloc[0]
        self.assertEqual(real.clusters, 2)
        self.assertEqual(real.model_hit45_pct, 50)
        self.assertEqual(real.random_hit45_pct, 25)
        self.assertTrue(np.isnan(fs.error_stats([])['hit45_pct']))

    def test_wrap_missing_persistence_and_cancellation(self):
        data = pd.DataFrame({'bearing_deg': [350., 120., 0.], 'wind_speed_ms': [3., .5, 3.],
                             'persistence_bearing_deg': [10., np.nan, 180.]})
        predicted = fs.blend_direction(data, {'w_wind': .5, 'wind_power': 1})
        self.assertAlmostEqual(float(fs.angular_error(predicted[0], 0)), 0)
        self.assertAlmostEqual(predicted[1], 120)
        self.assertAlmostEqual(predicted[2], 0)

    def test_split_is_before_real_fire_filter(self):
        days = pd.date_range('2026-08-02', periods=102)
        data = pd.DataFrame({'day': days, 'n_points': [5]*10+[20]*92, 'n_new': [10]*102})
        mask, split = fs.temporal_split(data)
        self.assertEqual(split['train_last_day'], '2026-10-10')
        self.assertEqual(split['test_first_day'], '2026-10-11')
        self.assertEqual(int(mask.sum()), 70)
        self.assertEqual(int((mask & fs.real_fire_mask(data)).sum()), 60)

    def test_evaluate_never_passes_test_rows_to_fit(self):
        n = 72
        data = pd.DataFrame({'day': pd.date_range('2026-08-02', periods=n).strftime('%Y-%m-%d'),
            'cluster_id': np.zeros(n, int), 'lat': np.zeros(n), 'lon': np.zeros(n),
            'n_points': np.full(n, 20), 'n_new': np.full(n, 10), 'wind_speed_ms': np.full(n, 3.),
            'bearing_deg': np.full(n, 90.), 'observed_bearing_deg': np.r_[np.full(70, 70.), [0., 180.]],
            'persistence_bearing_deg': np.full(n, 45.)})
        parameters = {'w_wind': .4, 'w_pers': .6, 'wind_power': 1., 'w_upslope': 0.}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); out = root/'output/spread'; out.mkdir(parents=True)
            path = out/'backtest_clusters.csv'; data.to_csv(path,index=False)
            with patch.object(fs, 'ROOT', root), patch.object(fs, 'fit_direction_model', return_value=parameters) as fit, \
                 patch.object(fs.gw._session, 'request', side_effect=AssertionError('network forbidden')), \
                 contextlib.redirect_stdout(io.StringIO()):
                fs.evaluate(SimpleNamespace(terrain=False))
                first_training = fit.call_args.args[0].copy()
                data.loc[70:, 'observed_bearing_deg'] = [315., 12.]
                data.to_csv(path,index=False)
                fs.evaluate(SimpleNamespace(terrain=False))
                second_training = fit.call_args.args[0]
            pd.testing.assert_frame_equal(first_training, second_training)
            self.assertEqual(len(first_training), 70)
            predictions = pd.read_csv(out/'blend_predictions.csv')
            self.assertEqual((predictions.partition=='test').sum(), 2)
            model = json.loads((out/'blend_model.json').read_text())
            self.assertEqual(model['wind_persistence'], parameters)

    def test_fitter_recovers_known_direction_signal(self):
        rng = np.random.default_rng(7)
        n = 150
        data = pd.DataFrame({'bearing_deg': rng.uniform(0,360,n), 'wind_speed_ms': rng.uniform(.5,8,n),
                             'persistence_bearing_deg': rng.uniform(0,360,n)})
        data['observed_bearing_deg'] = fs.blend_direction(data, {'w_wind': .7, 'wind_power': 1.2})
        fit = fs.fit_direction_model(data)
        self.assertLess(fit['train_mean_angular_error_deg'], .01)
        self.assertAlmostEqual(fit['w_wind']+fit['w_pers'], 1.)
        self.assertGreaterEqual(fit['wind_power'], 0.)

    def test_available_and_common_denominators(self):
        data = pd.DataFrame({'n_points': [20]*2, 'n_new': [10]*2, 'wind_bin': ['<3']*2,
                             'bearing_deg': [0., 90.], 'persistence_bearing_deg': [0., np.nan],
                             'blended_bearing_deg': [0.,90.], 'observed_bearing_deg': [0.,0.]})
        table = fs.comparison_metrics(data, {'wind': 'bearing_deg', 'pers': 'persistence_bearing_deg', 'blend': 'blended_bearing_deg'})
        subset = table[(table.cohort=='real_fires') & (table.wind_bin_ms=='all')]
        self.assertEqual(subset[(subset.availability=='available') & (subset.model=='wind')].clusters.iloc[0], 2)
        self.assertTrue((subset[subset.availability=='common_persistence'].clusters==1).all())

    def test_cached_forecast_never_requests_network(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); cache=root/'data/gfs_uv'; cache.mkdir(parents=True)
            u=np.stack([np.full((361,720),s,np.float16) for s in [3,9,15,21,27,33]])
            np.savez(cache/'uv_cycle_20261113T12_003_033.npz',u=u,v=np.zeros_like(u))
            with patch.object(fs,'ROOT',root), patch.object(fs.gw._session,'request',side_effect=AssertionError('network forbidden')):
                fields, cycle=fs.cached_latest_wind_uv(pd.Timestamp('2026-11-13 17:00'))
            self.assertEqual(cycle,pd.Timestamp('2026-11-13 12:00'))
            np.testing.assert_allclose(fields['u'][:,0,0],[5,11,17,23,29])


class TerrainTests(unittest.TestCase):
    def test_plane_sign_spacing_aspect(self):
        row,col=np.indices((5,5)); dem=10*col+20*row
        north=1.; res=.01
        east,northward=ft.gradient_fields(dem,north,res)
        lat=north-2.5*res; lon=2.5*res
        slope,aspect,up,valid=ft.sample_gradients(east,northward,[lat],[lon],north,0,res)
        dy=ft.EARTH_M*np.radians(res)
        dx=dy*np.cos(np.radians(lat))
        expected=np.degrees(np.arctan2(10/dx,-20/dy))%360
        self.assertTrue(valid[0])
        self.assertAlmostEqual(up[0],expected,places=4)
        self.assertAlmostEqual(aspect[0],(expected+180)%360,places=4)
        self.assertAlmostEqual(slope[0],np.degrees(np.arctan(np.hypot(10/dx,20/dy))),places=5)

    def test_void_and_flat_terrain(self):
        dem=np.zeros((5,5)); dem[2,2]=-9999
        east,north=ft.gradient_fields(dem,1.)
        self.assertTrue(np.isnan(east[2,2]))
        self.assertTrue(np.isnan(north[2,2]))
        e,n=ft.gradient_fields(np.zeros((5,5)),1.)
        slope,aspect,up,valid=ft.sample_gradients(e,n,[1-2.5/120],[2.5/120],1.,0.)
        self.assertEqual(slope[0],0)
        self.assertTrue(np.isnan(aspect[0]))
        self.assertEqual(up[0],0)
        self.assertTrue(valid[0])

    def test_upslope_vector_and_missing_fallback(self):
        data=pd.DataFrame({'bearing_deg':[90.,90.], 'wind_speed_ms':[3.,3.],
            'persistence_bearing_deg':[np.nan,np.nan], 'terrain_available':[True,False],
            'slope_deg':[np.degrees(np.arctan(.1)),np.nan], 'upslope_bearing_deg':[0.,np.nan]})
        predicted=fs.blend_direction(data,{'w_wind':.5,'wind_power':1.,'w_upslope':1.})
        np.testing.assert_allclose(predicted,[45.,90.])

    def test_download_requires_approval(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); out=root/'output/spread'; out.mkdir(parents=True)
            (out/'backtest_clusters.csv').write_text('day,cluster_id\n')
            pd.DataFrame({'tile':['e020n40'],'download_bytes':[10]}).to_csv(out/'terrain_plan.csv',index=False)
            info={'download_bytes':10,'dem_bytes':20,
                'plan_sha256':hashlib.sha256((out/'terrain_plan.csv').read_bytes()).hexdigest(),
                'backtest_sha256':hashlib.sha256((out/'backtest_clusters.csv').read_bytes()).hexdigest()}
            (out/'terrain_plan.json').write_text(json.dumps(info))
            with patch.object(ft.requests,'get',side_effect=AssertionError('download attempted')), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(ValueError,'approval'):
                    ft.download(root,approved=False)
            self.assertFalse((root/'data/terrain').exists())


if __name__=='__main__':
    unittest.main()
