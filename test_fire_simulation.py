"""Offline integration checks against the pinned team's numerical engine."""
import copy
import hashlib
import json
import subprocess
import unittest
from unittest.mock import patch

import fire_simulation as simulation


class SimulationTests(unittest.TestCase):
    def request(self):
        return {'ignition':simulation.environment()['defaultIgnition'], 'sensors':[],
                'durationSec':1800, 'windSpeedMps':4, 'windFromDeg':270}

    def test_prepared_area_is_in_ireland_with_real_terrain_provenance(self):
        env=simulation.environment()
        self.assertEqual(env['width']*env['height'],40000)
        self.assertTrue(52 < env['bounds']['south'] < env['bounds']['north'] < 54)
        self.assertTrue(-7 < env['bounds']['west'] < env['bounds']['east'] < -6)
        self.assertIn('water',env['cover'])
        self.assertEqual({p['provider'] for p in env['provenance']},{'Copernicus DEM','ESA WorldCover'})

    def test_invalid_input_is_rejected_before_spawning_a_worker(self):
        with patch.object(simulation.subprocess,'run') as worker:
            for key,value in [('durationSec',86400),('durationSec',True),('windSpeedMps',float('nan')),
                              ('windFromDeg',360),('ignition',{'longitude':0,'latitude':0}),('sensors',[{}]*9)]:
                request=self.request();request[key]=value
                with self.assertRaises(ValueError):simulation.run(request)
            worker.assert_not_called()

    def test_engine_is_deterministic_and_temperature_profile_stays_temperature_only(self):
        request=self.request();request['sensors']=[dict(request['ignition'],profileId='temperature')]
        a=simulation.run(request);b=simulation.run(copy.deepcopy(request))
        self.assertEqual(a,b)
        self.assertEqual(len(a['frames']),61)
        self.assertTrue(a['scenario'])
        self.assertGreater(len(a['frames'][-1]['burnedCells']),0)
        self.assertEqual(set(a['frames'][0]['readings'][0]['values']),{'temperatureC'})
        original=json.dumps(a['frames'][-1]['burnedCells'])
        request['windFromDeg']=90
        self.assertNotEqual(json.dumps(simulation.run(request)['frames'][-1]['burnedCells']),original)

    def test_hash_adapter_matches_sha256_utf8_and_little_endian_seed(self):
        value='Glendalough 🌲'
        code="import {sha256Hex,sha256Uint32LE} from './vendor/irish_simulation/hash.mjs';const s="+json.dumps(value)+";console.log(JSON.stringify([sha256Hex(s),sha256Uint32LE(s)]));"
        result=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=simulation.ROOT,text=True))
        digest=hashlib.sha256(value.encode()).digest()
        self.assertEqual(result,[digest.hex(),int.from_bytes(digest[:4],'little')])


if __name__=='__main__':unittest.main()
