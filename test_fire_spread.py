"""Numerical and cache/network-boundary regression checks; no live requests."""
import tempfile
import contextlib
import io
from types import SimpleNamespace
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

import fire_spread as fs
import gfs_weather as gw


class SpreadTests(unittest.TestCase):
    def setUp(self):
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)

    def test_cardinal_wind_to_and_calm(self):
        uv = {"u": np.tile([0., 1., 0., -1., 0.], (5, 1)),
              "v": np.tile([1., 0., -1., 0., 0.], (5, 1))}
        _, bearing, _ = fs.wind_summary(uv)
        np.testing.assert_allclose(bearing[:4], [0, 90, 180, 270])
        self.assertTrue(np.isnan(bearing[4]))
        self.assertEqual(float(fs.angular_error(359, 1)), 2)

    def test_spherical_index_matches_haversine(self):
        from sklearn.neighbors import BallTree
        rng = np.random.default_rng(42)
        reference = pd.DataFrame({'lat': rng.uniform(-90, 90, 1000), 'lon': rng.uniform(-180, 180, 1000)})
        query = pd.DataFrame({'lat': rng.uniform(-90, 90, 200), 'lon': rng.uniform(-180, 180, 200)})
        arc, index = BallTree(np.radians(reference), metric='haversine').query(np.radians(query), k=1)
        distance, actual = fs.nearest_on_sphere(reference, query)
        np.testing.assert_array_equal(actual, index[:, 0])
        np.testing.assert_allclose(distance, arc[:, 0] * fs.EARTH_KM, atol=1e-9)

    def test_bilinear_and_longitude_wrap(self):
        y, x = np.indices((361, 720))
        grid = 2 * y + 3 * x
        np.testing.assert_allclose(fs.sample_grid(grid, [89.75], [0.25]), [2.5])
        grid = np.zeros((361, 720))
        grid[:, -1], grid[:, 0] = 2, 4
        np.testing.assert_allclose(fs.sample_grid(grid, [0, 0], [-0.25, 359.75]), [3, 3])

    def test_spherical_centroid_and_dateline_clustering(self):
        points = pd.DataFrame({"lat": [0.] * 6, "lon": [179.999, -179.999] * 3, "frp": [1.] * 6})
        result = fs.clusters(points)
        self.assertEqual(len(result), 1)
        self.assertAlmostEqual(abs(result.lon.iloc[0]), 180)
        self.assertEqual(result.n_points.iloc[0], 6)
        self.assertEqual(result.frp_sum.iloc[0], 6)

    def test_ellipse_circle_shape_and_monotonic_dryness(self):
        calm = fs.ellipse_rates(np.array([0.]), np.array([20.]), np.array([10.]))
        self.assertAlmostEqual(calm['lb'][0], 1.)
        np.testing.assert_allclose(fs.ellipse_radius(calm, 90), calm['head'])
        wind = fs.ellipse_rates(np.array([5.]), np.array([20.]), np.array([10.]))
        np.testing.assert_allclose(wind['a'] / wind['b'], wind['lb'])
        np.testing.assert_allclose(fs.ellipse_radius(wind, 0), wind['head'])
        self.assertLess(fs.ellipse_radius(wind, 180)[0], fs.ellipse_radius(wind, 90)[0])
        wet = fs.ellipse_rates(np.array([5.]), np.array([90.]), np.array([0.]))
        self.assertLess(wet['head'][0], wind['head'][0])

    def test_incremental_head_distances(self):
        points = pd.DataFrame({'cluster_id': [0], 'lat': [0.], 'lon': [0.], 'n_points': [5], 'frp_sum': [2.]})
        uv = {'u': np.ones((5, 361, 720)), 'v': np.zeros((5, 361, 720))}
        result = fs.predict(points, uv, np.array([20.]), np.array([5.]), 'active')
        self.assertEqual(list(result.columns), fs.COLUMNS)
        row = result.iloc[0]
        self.assertAlmostEqual(row.bearing_deg, 90.)
        self.assertAlmostEqual(row.spread_km_24h, 4 * row.spread_km_6h)
        self.assertAlmostEqual(row.spread_km_12h, 2 * row.spread_km_6h)

    def test_progression_excludes_repeats_and_distant_points(self):
        old = pd.DataFrame({'lat': [0.] * 5, 'lon': [0.] * 5, 'frp': [1.] * 5})
        new = pd.DataFrame({'lat': [0.] * 7, 'lon': [0, .001, .02, .021, .022, 1, 1.01], 'frp': [1.] * 7})
        obs = fs.progression(old, new, fs.clusters(old))
        self.assertEqual(obs[0][2], 3)
        self.assertAlmostEqual(obs[0][0], 90.)
        self.assertGreater(obs[0][1], 2.)

    def test_persistence_and_paired_metrics(self):
        prev = pd.DataFrame({'cluster_id': [0], 'lat': [0.], 'lon': [0.]})
        now = pd.DataFrame({'cluster_id': [5, 6], 'lat': [0., 20.], 'lon': [.02, 20.]})
        result = fs.persistence_bearings(now, prev, {0: (90., 2., 3)}, 10.)
        self.assertEqual(result[0], 90.)
        self.assertTrue(np.isnan(result[1]))
        data = pd.DataFrame({'n_points': [20, 20], 'n_new': [10, 10], 'wind_bin': ['<3', '<3'], 'model_error_deg': [10., 150.],
                             'persistence_error_deg': [20., np.nan]})
        summary = fs.metrics_table(data).iloc[0]
        self.assertEqual(summary.model_median_deg, 80.)
        self.assertEqual(summary.model_paired_median_deg, 10.)
        self.assertEqual(summary.persistence_clusters, 1)

    def test_top50_no_probability_threshold(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'forecast.csv'
            n = 60
            pd.DataFrame({'lat': np.zeros(n), 'lon': np.arange(n), 'probability': np.arange(n) / 10000,
                          'new_ignition': [True] * 59 + [False], 'rhmin_pct': [20.] * n,
                          'days_since_rain': [10.] * n, 'valid_from_utc': ['2026-11-13 17:00'] * n}).to_csv(path, index=False)
            chosen, _ = fs.read_scenarios(path)
            self.assertEqual(len(chosen), 50)
            self.assertEqual(chosen.lon.iloc[0], 58)
            self.assertEqual(chosen.lon.iloc[-1], 9)


    def test_backtest_uses_next_day_wind_and_skips_missing(self):
        # Five daily clusters moving east, one missing U/V day and a partial last day.
        rows = []
        for i, day in enumerate(pd.date_range('2026-08-01', periods=5)):
            for j in range(5):
                rows.append({'lat': 0., 'lon': .02 * i + .0001 * j,
                             'frp': 1., 'time': day + pd.Timedelta(hours=12, minutes=j)})
        detections = pd.DataFrame(rows)
        args = SimpleNamespace(eps_km=2., min_samples=5, novelty_km=.75, match_km=10., min_new=3)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            cache = root / 'data/gfs_uv'
            cache.mkdir(parents=True)
            for date in ['20260802', '20260804']:
                (cache / f'uv_day_{date}.npz').touch()
            uv = {'u': np.ones((5, 1)), 'v': np.zeros((5, 1))}
            with patch.object(fs, 'ROOT', root), patch.object(fs, 'read_detections', return_value=detections), \
                 patch.object(gw, 'ensure_daily_uv', return_value=[pd.Timestamp('2026-08-03')]), \
                 patch.object(fs, 'load_daily_uv', return_value={}) as load, \
                 patch.object(fs, 'wind_at_points', return_value=uv), contextlib.redirect_stdout(io.StringIO()) as log:
                fs.backtest(args)
            self.assertEqual([c.args[0] for c in load.call_args_list],
                             [pd.Timestamp('2026-08-02'), pd.Timestamp('2026-08-04')])
            result = pd.read_csv(root / 'output/spread/backtest_clusters.csv')
            self.assertEqual(result.day.tolist(), ['2026-08-01', '2026-08-03'])
            np.testing.assert_allclose(result.model_error_deg, 0)
            self.assertTrue(np.isnan(result.persistence_bearing_deg.iloc[0]))
            self.assertEqual(result.persistence_bearing_deg.iloc[1], 90.)
            self.assertIn('Skipped days for missing GFS U/V: 1', log.getvalue())
            self.assertIn('incomplete target: 1', log.getvalue())


class UVTests(unittest.TestCase):
    def setUp(self):
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)

    def test_fetches_only_uv_ranges_preserving_step_order(self):
        index = [('TMP', '2 m above ground', '', 0, 9),
                 ('UGRD', '10 m above ground', '', 10, 19),
                 ('VGRD', '10 m above ground', '', 20, 29)]
        with patch.object(gw, '_read_idx', return_value=index), \
             patch.object(gw, '_fetch', side_effect=lambda url, start, end: bytes([start]) * 10) as fetch, \
             patch.object(gw, '_decode', side_effect=lambda msg: np.full((361, 720), msg[0], np.float32)):
            result = gw.wind_uv(pd.Timestamp('2026-08-05 12:00'), [18, 12])
        self.assertEqual(result['u'].shape, (2, 361, 720))
        self.assertEqual(result['download_bytes'], 40)
        self.assertTrue((result['u'] == 10).all())
        self.assertTrue((result['v'] == 20).all())
        self.assertEqual({call.args[1:] for call in fetch.call_args_list}, {(10, 19), (20, 29)})
        self.assertIn('f018', fetch.call_args_list[0].args[0])

    def test_cache_skip_and_missing_return(self):
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder)
            day = pd.Timestamp('2026-08-06')
            fields = {'u': np.zeros((5, 361, 720)), 'v': np.ones((5, 361, 720)), 'download_bytes': 10}
            with patch.object(gw, 'wind_uv', return_value=fields) as fetch:
                self.assertEqual(gw.ensure_daily_uv([day], cache), [])
                self.assertEqual(gw.ensure_daily_uv([day], cache), [])
                self.assertEqual(fetch.call_count, 1)
                self.assertEqual(fetch.call_args.args, (day - pd.Timedelta(hours=12), [12, 18, 24, 30, 36]))
            with np.load(cache / 'uv_day_20260806.npz') as z:
                self.assertEqual(z['u'].dtype, np.float16)
            with patch.object(gw, 'wind_uv', side_effect=gw.MissingGFS('missing')):
                self.assertEqual(gw.ensure_daily_uv([day + pd.Timedelta(days=1)], cache), [day + pd.Timedelta(days=1)])

    def test_latest_cycle_fallback_and_exact_time_interpolation(self):
        class Response:
            def __init__(self, status): self.status_code = status
        def fields(cycle, steps):
            u = np.stack([np.full((361, 720), step, dtype=np.float32) for step in steps])
            return {'u': u, 'v': u * 0, 'download_bytes': 1}
        with tempfile.TemporaryDirectory() as folder, \
             patch.object(gw._session, 'head', side_effect=[Response(404), Response(200)]), \
             patch.object(gw, 'wind_uv', side_effect=fields):
            uv, cycle = gw.latest_wind_uv(pd.Timestamp('2026-11-13 17:00'), Path(folder))
        self.assertEqual(cycle, pd.Timestamp('2026-11-13 06:00'))
        np.testing.assert_allclose(uv['u'][:, 0, 0], [11, 17, 23, 29, 35])

    def test_wrong_range_rejected(self):
        index = [('UGRD', '10 m above ground', '', 10, 19), ('VGRD', '10 m above ground', '', 20, 29)]
        with patch.object(gw, '_read_idx', return_value=index), patch.object(gw, '_fetch', return_value=b'x'):
            with self.assertRaises(gw.MissingGFS):
                gw.wind_uv(pd.Timestamp('2026-08-05 12:00'), [12])


if __name__ == '__main__':
    unittest.main()
