import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {PNG} from 'pngjs';
import type {EnvironmentSnapshot} from '@dryspell/contracts';

// Live read-only integration probe: no mocks and no service/database changes.
const response=await fetch('http://127.0.0.1:4001/api/sandbox/environment');assert.equal(response.status,200);
const environment=await response.json() as EnvironmentSnapshot;
assert.equal(environment.landscape.cells.length,40000);assert(environment.landscape.cells.every(c=>Number.isInteger(c.sourceClassCode)));
const b=environment.landscape.bounds,longitude=(b.west+b.east)/2,latitude=(b.south+b.north)/2,z=12;
const x=Math.floor((longitude+180)/360*2**z),y=Math.floor((1-Math.asinh(Math.tan(latitude*Math.PI/180))/Math.PI)/2*2**z);
const tiles=[];
for(const layer of ['landcover','ecoregions']){
 const upstream=await fetch(`http://127.0.0.1:4177/api/tiles/${layer}/${z}/${x}/${y}.png`),proxy=await fetch(`http://127.0.0.1:4001/api/sandbox/map/tiles/${layer}/${z}/${x}/${y}.png`);
 assert.equal(upstream.status,200,`${layer} upstream`);assert.equal(proxy.status,200,`${layer} proxy`);assert.match(proxy.headers.get('content-type')??'',/image\/png/);
 const original=Buffer.from(await upstream.arrayBuffer()),rendered=Buffer.from(await proxy.arrayBuffer()),a=PNG.sync.read(original),c=PNG.sync.read(rendered);
 assert.equal(a.width,c.width);assert.equal(a.height,c.height);let changed=0,opaque=0;
 for(let i=0;i<a.data.length;i+=4){assert.equal(a.data[i+3],c.data[i+3],'Palette keeps alpha');if(a.data[i+3])opaque++;if(!a.data.subarray(i,i+3).equals(c.data.subarray(i,i+3)))changed++;if(a.data[i]===250&&a.data[i+1]===0&&a.data[i+2]===0&&layer==='landcover')assert.deepEqual([...c.data.subarray(i,i+3)],[139,148,155],'Built-up becomes gray');if(a.data[i]===240&&a.data[i+1]===150&&a.data[i+2]===255&&layer==='landcover')assert.deepEqual([...c.data.subarray(i,i+3)],[198,170,102],'Cropland becomes wheat');}
 if(layer==='landcover')assert(changed>0);else assert.deepEqual(rendered,original);
 tiles.push({layer,z,x,y,width:c.width,height:c.height,opaquePixels:opaque,changedPixels:changed,source:proxy.headers.get('x-map-source'),sha256:createHash('sha256').update(rendered).digest('hex')});
}
const after=await fetch('http://127.0.0.1:4001/api/sandbox/environment').then(r=>r.json()) as EnvironmentSnapshot;
assert.deepEqual(after,environment,'Tile acquisition/recoloring leaves numerical input unchanged');
const result={checkedAt:new Date().toISOString(),mode:'actual upstream4177 and sandbox4001 HTTP; no fixtures',environmentId:environment.id,landscapeChecksum:environment.landscape.checksum,sourceClasses:[...new Set(environment.landscape.cells.map(c=>c.sourceClassCode))].sort((a,b)=>a!-b!),tiles};
await writeFile('tests/sandbox/map-probe-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
