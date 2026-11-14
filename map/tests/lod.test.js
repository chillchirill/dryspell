import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {ECOREGION_LODS,ecoregionLod} from '../server/lod.js';
import {WORLD_VERSION} from '../server/terrain.js';
import {createMapServer} from '../server/index.js';
import {closeEcoregions} from '../server/ecoregions.js';

test('zoom bands are exhaustive and far views cannot select detailed data',()=>{
  for(const level of ECOREGION_LODS)for(let z=level.minZoom;z<=level.maxZoom;z++)assert.equal(ecoregionLod(z).id,level.id);
  assert.equal(ecoregionLod(19).name,'local');assert.throws(()=>ecoregionLod(2));assert.throws(()=>ecoregionLod(6.5));
});
test('DB partitions isolate overview reads, cap geometry size and retain a much smaller world map',{skip:!process.env.MAP_DATABASE_URL},async()=>{
  const db=new pg.Client({connectionString:process.env.MAP_DATABASE_URL});await db.connect();
  try{
    const {rows}=await db.query('SELECT lod,count(*)::int parts,sum(ST_NPoints(geom))::int points,max(ST_NPoints(geom))::int max_points FROM map.ecoregion_lod GROUP BY lod ORDER BY lod');
    assert.equal(rows.length,4);assert.ok(rows[0].points<rows[3].points/10);
    for(const row of rows)assert.ok(row.max_points<=128);
    for(const level of ECOREGION_LODS){
      const plan=(await db.query('EXPLAIN(FORMAT JSON) SELECT zone FROM map.ecoregion_lod WHERE lod=$1 AND geom && ST_MakeEnvelope(3000000,5000000,4000000,6000000,3857)',[level.id])).rows[0]['QUERY PLAN'];
      const relations=[];function walk(value){if(!value||typeof value!=='object')return;if(value['Relation Name'])relations.push(value['Relation Name']);Object.values(value).forEach(walk);}walk(plan);
      assert.deepEqual([...new Set(relations)],[`ecoregion_lod_${level.name}`]);
    }
  }finally{await db.end();}
});
test('zoomed-out HTTP tiles are already in PostgreSQL and never invoke the renderer',{skip:!process.env.MAP_DATABASE_URL},async()=>{
  let calls=0;
  const app=await createMapServer({acquireTile:async()=>{calls++;throw new Error('Overview must already exist');}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  try{
    for(const z of [3,4,5]){
      const res=await fetch(`${base}/api/tiles/ecoregions/${z}/0/0.png`);assert.equal(res.status,200);assert.equal(res.headers.get('x-map-cache'),'database');assert.equal(res.headers.get('x-map-lod'),ecoregionLod(z).name);await res.arrayBuffer();
    }
    assert.equal(calls,0);
    const repeat=await fetch(`${base}/api/tiles/ecoregions/3/0/0.png`);assert.equal(repeat.headers.get('x-map-cache'),'memory');await repeat.arrayBuffer();
    const catalog=await(await fetch(base+'/api/lod')).json();assert.equal(catalog.version,WORLD_VERSION);assert.deepEqual(catalog.pyramid.map(r=>r.tile_count),[64,256,1024]);
  }finally{await app.close();await closeEcoregions();}
});
