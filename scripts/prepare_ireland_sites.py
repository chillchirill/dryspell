"""Plan seven bounded COG windows; acquire pixel blocks only with --download-approved.

The plan reads TIFF metadata only. No full remote TIFF is ever accepted.
"""
from pathlib import Path
import argparse
import csv
import hashlib
import io
import json
import math
import time
import gzip
from datetime import datetime, timezone
from urllib.request import Request, urlopen

import numpy as np
import tifffile

ROOT=Path(__file__).resolve().parents[1]
CACHE=ROOT/'output/simulation/cog_blocks'
PLAN=ROOT/'output/simulation/ireland_acquisition_plan.json'


class Budget:
    def __init__(self,limit): self.limit=limit;self.used=0


class RemoteTIFF(io.RawIOBase):
    """Bounded HTTP Range file. Cache survives retries; never accepts a full-file reply."""
    def __init__(self,url,budget):
        self.url=url;self.budget=budget;self.position=0;self.name=url
        with urlopen(Request(url,method='HEAD'),timeout=30) as response:
            self.size=int(response.headers['Content-Length'])
        self.folder=CACHE/hashlib.sha256(url.encode()).hexdigest()[:20]
        self.folder.mkdir(parents=True,exist_ok=True)

    def readable(self):return True
    def seekable(self):return True
    def tell(self):return self.position
    def seek(self,offset,whence=0):
        self.position=(0 if whence==0 else self.position if whence==1 else self.size)+offset
        if self.position<0:raise ValueError('Invalid TIFF seek')
        return self.position

    def range(self,start,count):
        if not 0<count<=8_000_000:raise ValueError('Unexpected TIFF block size')
        path=self.folder/f'{start}_{count}.bin'
        if path.exists() and path.stat().st_size==count:return path.read_bytes()
        if self.budget.used+count>self.budget.limit:raise ValueError('Approved byte budget exhausted; stopping')
        request=Request(self.url,headers={'Range':f'bytes={start}-{start+count-1}'})
        with urlopen(request,timeout=60) as response:
            expected=f'bytes {start}-{start+count-1}/{self.size}'
            if response.status!=206 or response.headers.get('Content-Range')!=expected:
                raise ValueError('Provider did not honour the exact bounded byte range; refusing full TIFF')
            data=response.read(count+1)
        if len(data)!=count:raise ValueError('Incomplete TIFF block')
        self.budget.used+=len(data);path.write_bytes(data)
        return data

    def read(self,count=-1):
        if count<0:raise ValueError('Unbounded TIFF read refused')
        end=min(self.size,self.position+count);chunks=[]
        while self.position<end:
            start=self.position//65536*65536;length=min(65536,self.size-start)
            block=self.range(start,length);take=min(end-self.position,start+length-self.position)
            chunks.append(block[self.position-start:self.position-start+take]);self.position+=take
        return b''.join(chunks)


def urls(lat,lon):
    north=math.floor(lat/3)*3;west=math.floor(lon/3)*3
    name=f'N{north:02d}W{abs(west):03d}'
    dem=f'Copernicus_DSM_COG_10_N{math.floor(lat):02d}_00_W{abs(math.floor(lon)):03d}_00_DEM'
    return {'cover':f'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{name}_Map.tif',
            'dem':f'https://copernicus-dem-30m.s3.amazonaws.com/{dem}/{dem}.tif'}


def pixels(page,bounds):
    scale=page.tags['ModelPixelScaleTag'].value;tie=page.tags['ModelTiepointTag'].value
    west,north=tie[3]-tie[0]*scale[0],tie[4]+tie[1]*scale[1]
    keys=page.tags['GeoKeyDirectoryTag'].value
    entries={keys[i]:keys[i+3] for i in range(4,len(keys),4) if keys[i+1]==0}
    if entries.get(2048)!=4326:raise ValueError('Expected geographic WGS84 raster')
    if entries.get(1025)==2:  # RasterPixelIsPoint: tiepoint is the first sample centre.
        west-=scale[0]/2;north+=scale[1]/2
    # Pixel centres, north-to-south rows. Output grids use 200x200 cells at ~25 m.
    x=np.floor((np.linspace(bounds['west'],bounds['east'],200,endpoint=False)+(bounds['east']-bounds['west'])/400-west)/scale[0]).astype(int)
    y=np.floor((north-(np.linspace(bounds['north'],bounds['south'],200,endpoint=False)-(bounds['north']-bounds['south'])/400))/scale[1]).astype(int)
    if x.min()<0 or y.min()<0 or x.max()>=page.imagewidth or y.max()>=page.imagelength:
        raise ValueError('A site crosses a source tile boundary; prepare a proper mosaic before proceeding')
    return x,y


def tile_ids(page,bounds):
    if not page.is_tiled or page.samplesperpixel!=1:raise ValueError('Unsupported source TIFF layout')
    x,y=pixels(page,bounds);across=math.ceil(page.imagewidth/page.tilewidth)
    return sorted({int(row*across+col) for row in y//page.tilelength for col in x//page.tilewidth})


def plan():
    budget=Budget(4_000_000);sources={};sites=[];handles={}
    rows=list(csv.DictReader((ROOT/'vendor/irish_simulation/planned_sites.csv').open()))
    try:
        for row in rows:
            lat,lon=float(row['latitude']),float(row['longitude']);dy=2500/111195.08;dx=dy/math.cos(math.radians(lat))
            bounds={'west':lon-dx,'east':lon+dx,'south':lat-dy,'north':lat+dy}
            site={'id':row['site_id'],'latitude':lat,'longitude':lon,'probability':float(row['probability']),
                  'country':row['country'],'bounds':bounds,'sources':{}}
            for kind,url in urls(lat,lon).items():
                if url not in handles:
                    remote=RemoteTIFF(url,budget);tiff=tifffile.TiffFile(remote);handles[url]=(remote,tiff)
                    sources[url]={'tiles':{},'kind':kind,'file_bytes':remote.size}
                page=handles[url][1].pages[0];indices=tile_ids(page,bounds)
                for i in indices:sources[url]['tiles'][str(i)]={'offset':int(page.dataoffsets[i]),'bytes':int(page.databytecounts[i])}
                site['sources'][kind]={'url':url,'tiles':indices}
            sites.append(site)
            print('Planned',site['id'],flush=True)
    finally:
        for remote,tiff in handles.values():tiff.close();remote.close()
    size=sum(t['bytes'] for source in sources.values() for t in source['tiles'].values())
    value={'sites':sites,'sources':sources,'pixel_bytes':size,'metadata_network_bytes':budget.used,
           'status':'planned only; no pixel blocks requested','created_epoch':time.time()}
    PLAN.parent.mkdir(parents=True,exist_ok=True);PLAN.write_text(json.dumps(value,indent=2))
    print(f'7 local windows: {size/1e6:.3f} MB of unique compressed pixel blocks; metadata fetched {budget.used/1e6:.3f} MB')
    print('Plan:',PLAN)
    return value


def acquire():
    """Only called after approval of the saved, bounded byte plan."""
    value=json.loads(PLAN.read_text())
    if len(value['sites'])!=7 or value['pixel_bytes']>25_000_000:raise ValueError('Plan is outside approved scope')
    budget=Budget(25_000_000);handles={};decoded={};outputs=[]
    out=ROOT/'vendor/irish_simulation/sites';out.mkdir(parents=True,exist_ok=True)
    reference=json.loads(gzip.decompress((ROOT/'vendor/irish_simulation/environment.json.gz').read_bytes()))
    now=datetime.now(timezone.utc).isoformat().replace('+00:00','Z')
    classes={10:'woodland',20:'scrub',30:'grass',40:'grass',50:'built',60:'unknown',70:'unknown',80:'water',90:'scrub',95:'woodland',100:'scrub'}
    try:
        for site in value['sites']:
            arrays={};provenance=[]
            expected_urls=urls(site['latitude'],site['longitude'])
            for kind,source in site['sources'].items():
                url=source['url']
                if url!=expected_urls[kind]:raise ValueError('Unexpected provider URL in acquisition plan')
                if url not in handles:
                    remote=RemoteTIFF(url,budget);handles[url]=(remote,tifffile.TiffFile(remote))
                remote,tiff=handles[url];page=tiff.pages[0];x,y=pixels(page,site['bounds'])
                selected=tile_ids(page,site['bounds'])
                if selected!=source['tiles']:raise ValueError('TIFF layout changed; regenerate the plan')
                array=np.full((200,200),np.nan)
                across=math.ceil(page.imagewidth/page.tilewidth)
                for i in selected:
                    block=value['sources'][url]['tiles'][str(i)]
                    if block['offset']!=page.dataoffsets[i] or block['bytes']!=page.databytecounts[i]:raise ValueError('Provider offsets changed')
                    key=(url,i)
                    if key not in decoded:
                        raw=remote.range(block['offset'],block['bytes']);data,_,_=page.decode(raw,i)
                        if data is None:raise ValueError('Empty source block')
                        decoded[key]=np.asarray(data)[0,:,:,0]
                    data=decoded[key];row,col=divmod(i,across)
                    iy=np.flatnonzero(y//page.tilelength==row);ix=np.flatnonzero(x//page.tilewidth==col)
                    array[np.ix_(iy,ix)]=data[np.ix_(y[iy]%page.tilelength,x[ix]%page.tilewidth)]
                if not np.isfinite(array).all():raise ValueError('Incomplete raster window')
                arrays[kind]=array[::-1]  # Engine: south-to-north rows.
                base=next(p for p in reference['landscape']['provenance'] if p['provider']==('ESA WorldCover' if kind=='cover' else 'Copernicus DEM'))
                provenance.append({**base,'sourceUrl':url,'retrievedAt':now,'sample':False,
                    'checksum':hashlib.sha256(array.tobytes()).hexdigest(),
                    'parameters':{'bounds':site['bounds'],'width':200,'height':200,'rowOrder':'south-to-north','resampling':'nearest'}})
            dem=arrays['dem'];cover=arrays['cover'];valid=(dem>-1000)&(dem<10000)
            gy,gx=np.gradient(dem,25.);cells=[]
            for i in range(40000):
                r,c=divmod(i,200);code=int(cover[r,c]);kind=classes.get(code,'unknown');known=bool(valid[r,c])
                cells.append({'sourceClassCode':code,'cover':kind,'elevationM':round(float(dem[r,c]),1) if known else None,
                    'slopeDeg':float(np.degrees(np.arctan(np.hypot(gx[r,c],gy[r,c])))) if known else None,
                    'aspectDeg':float(np.degrees(np.arctan2(-gx[r,c],-gy[r,c]))%360) if known else None,
                    'fuelModel':'cropland-herbaceous-assumption' if code==40 else {'grass':'GR1-inspired','woodland':'TL2-inspired','scrub':'SH2-inspired'}.get(kind,'non-burnable'),
                    'burnable':known and kind in ('grass','woodland','scrub'),
                    'spreadRateMps':{'grass':.16,'woodland':.055,'scrub':.1}.get(kind,0.),'moisture':.12})
            if not any(c['burnable'] for c in cells):raise ValueError('No known burnable terrain in '+site['id'])
            b=site['bounds'];checksum=hashlib.sha256(json.dumps(cells,separators=(',',':')).encode()).hexdigest()
            environment={'id':site['id']+'-'+checksum[:12],'name':'Ireland forecast area '+site['id'].split('-')[-1],
                'createdAt':now,'sample':True,'status':'partial' if any(c['cover']=='unknown' or c['elevationM'] is None for c in cells) else 'ready',
                'landscape':{'id':site['id']+'-landscape','bounds':b,'origin':{'longitude':b['west'],'latitude':b['south']},
                    'projection':f"+proj=aeqd +lat_0={site['latitude']} +lon_0={site['longitude']} +datum=WGS84 +units=m +no_defs",
                    'width':200,'height':200,'cellSizeM':25,'cells':cells,'provenance':provenance,'checksum':checksum},
                'weather':reference['weather'],'warnings':['Real local terrain and land cover; fuel and sensor responses are illustrative assumptions.',
                    'The probability belongs to a coarse forecast cell, not an exact ignition location.'],
                'forecastSite':{k:site[k] for k in ('id','latitude','longitude','probability','country')}}
            path=out/(site['id']+'.json.gz');payload=json.dumps(environment,allow_nan=False,separators=(',',':')).encode()
            path.write_bytes(gzip.compress(payload,mtime=0));outputs.append(path)
            print(f"Prepared {site['id']}: {sum(c['burnable'] for c in cells)} burnable cells; {path.stat().st_size/1e6:.3f} MB",flush=True)
    finally:
        for remote,tiff in handles.values():tiff.close();remote.close()
    receipt={'approved_limit_bytes':25_000_000,'planned_pixel_bytes':value['pixel_bytes'],
        'network_bytes_this_run':budget.used,'created_utc':now,
        'files':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in outputs},
        'sources':list(value['sources']),'method':'Bounded COG blocks; nearest pixel centres; RasterPixelIsPoint corrected; south-to-north output rows'}
    (out/'acquisition.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    print(f'Actual additional pixel/metadata bytes fetched: {budget.used/1e6:.3f} MB; prepared grids: {sum(p.stat().st_size for p in outputs)/1e6:.3f} MB')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--plan',action='store_true')
    group.add_argument('--download-approved',action='store_true')
    args=parser.parse_args()
    if args.plan:plan()
    else:acquire()
