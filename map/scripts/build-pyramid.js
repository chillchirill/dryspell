import {createHash} from 'node:crypto';
import pg from 'pg';
import {openStorage} from '../server/storage.js';
import {renderEcoregionTile,closeEcoregions} from '../server/ecoregions.js';
import {WORLD_VERSION} from '../server/terrain.js';
import {ecoregionLod,LOD_VERSION} from '../server/lod.js';
// Local imported geometry only. No OSM or ESA tile downloading/prefetching.
const maxZoom=Number(process.env.MAP_PREBUILD_MAX_ZOOM||5);
if(!Number.isInteger(maxZoom)||maxZoom<3||maxZoom>6)throw new Error('Prebuild zoom must be between 3 and 6');
if(!process.env.MAP_DATABASE_URL)throw new Error('MAP_DATABASE_URL is required');
const storage=await openStorage(process.env.MAP_DATABASE_URL),client=new pg.Client({connectionString:process.env.MAP_DATABASE_URL});await client.connect();
try{
  await client.query(`CREATE TABLE IF NOT EXISTS map.pyramid_catalog(
    version text NOT NULL,layer text NOT NULL,z integer NOT NULL,tile_count integer NOT NULL,total_bytes bigint NOT NULL,built_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(version,layer,z))`);
  for(let z=3;z<=maxZoom;z++){
    const start=performance.now(),n=2**z,total=n*n;let next=0,bytes=0,generated=0;
    async function worker(){while(next<total){
      const i=next++,tile={layer:'ecoregions',z,x:i%n,y:Math.floor(i/n)};
      let png=await storage.get(WORLD_VERSION,tile);
      if(!png){png=await renderEcoregionTile(tile);await storage.put(WORLD_VERSION,tile,png,{provider:'RESOLVE Ecoregions 2017',license:'CC BY 4.0',lod:ecoregionLod(z).name,lodVersion:LOD_VERSION,prebuilt:true,request:tile,checksum:createHash('sha256').update(png).digest('hex'),retrievedAt:new Date().toISOString()});generated++;}
      bytes+=png.length;
    }}
    await Promise.all([worker(),worker()]);
    await client.query(`INSERT INTO map.pyramid_catalog(version,layer,z,tile_count,total_bytes) VALUES($1,'ecoregions',$2,$3,$4)
      ON CONFLICT(version,layer,z) DO UPDATE SET tile_count=EXCLUDED.tile_count,total_bytes=EXCLUDED.total_bytes,built_at=now()`,[WORLD_VERSION,z,total,bytes]);
    console.log(JSON.stringify({zoom:z,tiles:total,generated,bytes,elapsedMs:Math.round(performance.now()-start)}));
  }
}finally{await storage.close();await client.end();await closeEcoregions();}
