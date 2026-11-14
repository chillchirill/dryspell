"""Meaningful aggregation, missing-data, split and export checks; no network."""
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import numpy as np
import pandas as pd
import fire_history as history


class HistoryTests(unittest.TestCase):
    def test_satellites_are_union_of_cell_days_and_quality_is_respected(self):
        frame=pd.DataFrame({'country':['Ireland']*6,'latitude':[53.1]*6,'longitude':[-7.1]*6,
            'acq_date':['2025-01-01']*3+['2025-01-02','2025-01-03','2025-01-04'],
            'satellite':['N20','N21','N20','N20','N20','N20'],
            'confidence':['n','h','n','h','l','n'],'type':[0,0,0,np.nan,0,2]})
        grid=np.full(history.NX*history.NY,-1,np.int8)
        grid[history.cell_ids([53.1],[-7.1])]=0
        data,counts=history.reduce_viirs(frame,grid,24300,24300)
        self.assertEqual(len(counts),1)
        self.assertEqual(int(counts.viirs.iloc[0]),2)
        self.assertEqual(int(counts.unknown.iloc[0]),1)
        self.assertEqual(int(data.calendar_included.sum()),4)

    def test_month_epoch_and_file_coverage(self):
        self.assertEqual(history.month_number('2025-01-01'),300+2000*12)
        self.assertEqual(history.month_label(300+2000*12),'2025-01')
        complete=pd.DataFrame({'file':[f'api_VIIRS_NOAA{s}_SP_world_2025-01-01_31d.csv' for s in [20,21]]})
        self.assertTrue(history.file_coverage(complete,'2025-01'))
        self.assertFalse(history.file_coverage(complete.iloc[:1],'2025-01'))
        self.assertFalse(history.file_coverage(complete,'2025-02'))

    def test_calibration_does_not_fit_held_out_months(self):
        records=[{'month':history.month_label(24298+i),'modis':i+2,'viirs':2*(i+2),'unknown':0} for i in range(14)]
        first=history.fit_scale(records)
        self.assertAlmostEqual(first['factor'],.5)
        self.assertEqual(first['train_last'],'2025-07')
        self.assertEqual(first['test_first'],'2025-08')
        for row in records[9:]:row['modis']*=100
        changed=history.fit_scale(records)
        self.assertEqual(first['factor'],changed['factor'])
        self.assertNotEqual(first['test_mae_adjusted'],changed['test_mae_adjusted'])

    def test_interior_cells_and_shared_mask(self):
        polygon={'features':[{'properties':{'NAME':'Ireland'},'geometry':{'type':'Polygon',
            'coordinates':[[[-7.,53.],[-6.,53.],[-6.,54.],[-7.,54.],[-7.,53.]]]}}]}
        mask=np.zeros(history.NX*history.NY,bool)
        interior=int(history.cell_ids([53.4],[-6.6])[0])
        self.assertEqual(history.common_grid(polygon,mask)[interior],0)
        mask[interior]=True
        self.assertEqual(history.common_grid(polygon,mask)[interior],-1)

    def test_checksum_verification_rejects_changed_package(self):
        content=b'original';manifest=hashlib.sha256(content).hexdigest()+'  data/sample.txt\n'
        for value,passes in [(content,True),(b'changed',False)]:
            buffer=io.BytesIO()
            with zipfile.ZipFile(buffer,'w') as z:
                z.writestr(history.PREFIX+'SHA256SUMS.txt',manifest)
                z.writestr(history.PREFIX+'data/sample.txt',value)
            buffer.seek(0)
            with zipfile.ZipFile(buffer) as z:
                if passes:self.assertEqual(history.verify_package(z),1)
                else:
                    with self.assertRaises(ValueError):history.verify_package(z)

    def test_export_is_country_and_date_bounded(self):
        with tempfile.TemporaryDirectory() as folder:
            out=Path(folder)
            (out/'history_latest.json').write_text(json.dumps({'metadata':{'first_month':'2024-11','last_month':'2026-10'}}))
            pd.DataFrame({'country':['Ireland','Ireland','Spain'],'acq_date':['2025-01-01','2025-02-01','2025-01-01'],
                'acq_time':['0045']*3,'version':['2']*3,'calendar_included':[True,False,True]}).to_csv(out/'viirs_points.csv.gz',index=False,compression='gzip')
            csv=history.detections_csv(out,'Ireland','2025-01','2025-01')
            self.assertIn('0045',csv)
            self.assertEqual(len(pd.read_csv(io.StringIO(csv))),1)
            for country,start,end in [('Unknown','2025-01','2025-02'),('Ireland','2020-01','2025-02'),('Ireland','2025-02','2025-01')]:
                with self.assertRaises(ValueError):history.detections_csv(out,country,start,end)


if __name__=='__main__':unittest.main()
