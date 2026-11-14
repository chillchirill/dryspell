import pg from 'pg';
import {writeFile} from 'node:fs/promises';
import {ECOREGION_LODS} from '../server/lod.js';
import {lonLatToWorld} from '../server/terrain.js';
import {createMapServer} from '../server/index.js';
import {closeEcoregions} from '../server/ecoregions.js';
const db=new pg.Client({connectionString:process.env.MAP_DATABASE_URL});await db.connect();
const results=[];
try{
  for(const level of ECOREGION_LODS){
    const z=level.minZoom,oldColumn=z<=5?'geom_low':z<=8?'geom_mid':'geom';let oldMs=0,newMs=0;
    for(const [lng,lat]of [[32.06,49.44],[-65,-5],[115,30]]){
      const[wx,wy]=lonLatToWorld(lng,lat),x=Math.floor(wx*2**z),y=Math.floor(wy*2**z),s=40075016.68557849/2**z,left=-20037508.342789244+x*s,top=20037508.342789244-y*s,bounds=[left,top-s,left+s,top];
      let start=performance.now();
      await db.query(`WITH tile AS(SELECT ST_MakeEnvelope($1,$2,$3,$4,3857) geom)
        SELECT e.zone,ST_AsGeoJSON(ST_Intersection(COALESCE(e.${oldColumn},e.geom),tile.geom),2)
        FROM map.ecoregions e,tile WHERE e.geom && tile.geom AND ST_Intersects(COALESCE(e.${oldColumn},e.geom),tile.geom)`,bounds);
      oldMs+=performance.now()-start;start=performance.now();
      await db.query(`WITH tile AS(SELECT ST_MakeEnvelope($1,$2,$3,$4,3857) geom)
        SELECT e.zone,ST_AsGeoJSON(ST_Intersection(e.geom,tile.geom),2)
        FROM map.ecoregion_lod e,tile WHERE e.lod=$5 AND e.geom && tile.geom AND ST_Intersects(e.geom,tile.geom)`,[...bounds,level.id]);
      newMs+=performance.now()-start;
    }
    results.push({level:level.name,zoom:z,tiles:3,previousQueryMs:Math.round(oldMs),partitionedQueryMs:Math.round(newMs),speedup:Number((oldMs/newMs).toFixed(1))});
  }
  const levels=(await db.query('SELECT name,min_zoom,max_zoom,point_count,geometry_bytes,polygon_count FROM map.lod_catalog ORDER BY lod')).rows;
  let rendered=0;const app=await createMapServer({acquireTile:async()=>{rendered++;throw new Error('Overview should be prebuilt');}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  try{
    const origin=`http://127.0.0.1:${app.server.address().port}`,start=performance.now();
    const cacheSources=[];let bytes=0;
    for(let i=0;i<24;i++){
      const z=3+i%3,n=2**z,res=await fetch(`${origin}/api/tiles/ecoregions/${z}/${i%n}/${Math.floor(i/n)}.png`);
      if(!res.ok)throw new Error(`Tile HTTP ${res.status}`);cacheSources.push(res.headers.get('x-map-cache'));bytes+=(await res.arrayBuffer()).byteLength;
    }
    const report={timestamp:new Date().toISOString(),queries:results,levels,prebuiltHttp:{tiles:24,elapsedMs:Math.round(performance.now()-start),bytes,rendered,cacheSources:[...new Set(cacheSources)]}};
    await writeFile(new URL('../output/lod-benchmark.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await app.close();await closeEcoregions();}
}finally{await db.end();}
