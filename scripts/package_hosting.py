"""Package only public runtime snapshots, never raw training data, models or secrets."""
from pathlib import Path
import hashlib
import json
import zipfile
import pandas as pd

ROOT=Path(__file__).resolve().parents[1]
FILES=[
    'output/firms/forecast_map.html','output/firms/climate_map.html',
    'output/firms/forecast_web.json','output/firms/forecast_latest.csv',
    'output/history/history_latest.json','output/history/history_monthly.csv','output/history/viirs_points.csv.gz',
    *[f'output/spread/spread_{kind}.geojson' for kind in ['active','scenario','ireland','europe']],
]


def package():
    tau=pd.Timestamp(pd.read_csv(ROOT/'output/firms/forecast_latest.csv',usecols=['valid_from_utc'],nrows=1).iloc[0,0])
    if tau.tzinfo is not None:tau=tau.tz_convert('UTC').tz_localize(None)
    wind=None
    for back in range(0,49,6):
        cycle=tau.floor('6h')-pd.Timedelta(hours=back);offset=(tau-cycle)/pd.Timedelta(hours=1)
        first=int(offset//3)*3;last=first+24
        if last<offset+24:last+=6
        name=f'data/gfs_uv/uv_cycle_{cycle:%Y%m%dT%H}_{first:03d}_{last:03d}.npz'
        if (ROOT/name).exists():wind=name;break
    if not wind:raise FileNotFoundError('Matching wind cache missing; no download permitted')
    files=[*FILES,wind]
    missing=[name for name in files if not (ROOT/name).is_file()]
    if missing:raise FileNotFoundError('Missing runtime snapshots: '+', '.join(missing))
    folder=ROOT/'deploy';folder.mkdir(exist_ok=True)
    target=folder/'snapshot.zip';temporary=target.with_suffix('.zip.part')
    manifest={'schema_version':1,'forecast_issued_at':tau.isoformat()+'Z','files':{}}
    with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for name in files:
            content=(ROOT/name).read_bytes()
            manifest['files'][name]={'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()}
            entry=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(entry,content)
    temporary.replace(target)
    manifest['archive_sha256']=hashlib.sha256(target.read_bytes()).hexdigest()
    (folder/'snapshot.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print(f'Hosting snapshot: {len(files)} files, {target.stat().st_size/1e6:.3f} MB compressed; no raw training archives or secrets')


if __name__=='__main__':package()
