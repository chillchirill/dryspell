import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {PNG} from 'pngjs';
import {lookupEcoregion,renderEcoregionTile,closeEcoregions} from '../server/ecoregions.js';
import {lonLatToWorld} from '../server/terrain.js';

test('imported global ecological regions are valid and preserve real regional distinctions',{skip:!process.env.MAP_DATABASE_URL},async()=>{
  const db=new pg.Client({connectionString:process.env.MAP_DATABASE_URL});await db.connect();
  try{
    const {rows}=await db.query('SELECT count(*)::int AS total,count(*) FILTER(WHERE NOT ST_IsValid(geom))::int AS invalid FROM map.ecoregions');
    assert.equal(rows[0].total,847);assert.equal(rows[0].invalid,0);
    const forestSteppe=await lookupEcoregion(49.44,32.06),steppe=await lookupEcoregion(46.456,33.9);
    assert.equal(forestSteppe.zone,'forest-steppe');assert.equal(steppe.zone,'steppe');
    assert.match(forestSteppe.name,/East European/);assert.match(steppe.name,/Pontic/);assert.equal(steppe.source.license,'CC BY 4.0');
    // Cross-region tiles include complex holes/islands that previously exposed invalid topology.
    for(const tile of [{z:3,x:4,y:3},{z:3,x:5,y:3},{z:3,x:1,y:3},{z:3,x:4,y:4},{z:6,x:37,y:21}]){
      const png=PNG.sync.read(await renderEcoregionTile(tile));assert.equal(png.width,256);assert.equal(png.height,256);
    }
    const [wx,wy]=lonLatToWorld(32.06,49.44);
    const local=PNG.sync.read(await renderEcoregionTile({z:14,x:Math.floor(wx*16384),y:Math.floor(wy*16384)}));
    assert.deepEqual([...local.data.subarray(0,4)],[157,175,99,255],'Tile clipping must not paint a false grid border');
  }finally{await db.end();await closeEcoregions();}
});
