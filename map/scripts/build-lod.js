import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {ECOREGION_LODS,LOD_VERSION} from '../server/lod.js';

if(!process.env.MAP_DATABASE_URL)throw new Error('Set MAP_DATABASE_URL for the independent map database');
const client=new pg.Client({connectionString:process.env.MAP_DATABASE_URL});await client.connect();
try{
  await client.query("SELECT pg_advisory_lock(hashtext('dryspell-map-build-lod'))");
  await client.query(await readFile(new URL('../db/lod.sql',import.meta.url),'utf8'));
  for(const level of ECOREGION_LODS){
    const started=performance.now();await client.query('BEGIN');
    await client.query('DELETE FROM map.ecoregion_lod WHERE lod=$1',[level.id]);
    // Simplify once at build time, remove sub-pixel components, then index small pieces.
    // Never load the high-resolution source as a fallback when serving a low zoom.
    await client.query(`INSERT INTO map.ecoregion_lod(lod,eco_id,zone,geom)
      SELECT $1,e.eco_id,e.zone,part.geom FROM map.ecoregions e
      CROSS JOIN LATERAL ST_Dump(ST_CollectionExtract(ST_MakeValid(
        CASE WHEN $2::float8=0 THEN e.geom ELSE ST_Simplify(e.geom,$2::float8,false) END),3)) AS polygon
      CROSS JOIN LATERAL ST_Subdivide(polygon.geom,128) AS part(geom)
      WHERE ST_Area(polygon.geom)>=$3 AND NOT ST_IsEmpty(part.geom)`,[level.id,level.toleranceM,level.minPolygonAreaM2]);
    await client.query(`INSERT INTO map.lod_catalog(layer,lod,version,name,min_zoom,max_zoom,tolerance_m,polygon_count,point_count,geometry_bytes)
      SELECT 'ecoregions',$1,$2,$3,$4,$5,$6,count(*)::int,coalesce(sum(ST_NPoints(geom)),0),coalesce(sum(ST_MemSize(geom)),0)
      FROM map.ecoregion_lod WHERE lod=$1
      ON CONFLICT(layer,lod) DO UPDATE SET version=EXCLUDED.version,name=EXCLUDED.name,min_zoom=EXCLUDED.min_zoom,max_zoom=EXCLUDED.max_zoom,
        tolerance_m=EXCLUDED.tolerance_m,polygon_count=EXCLUDED.polygon_count,point_count=EXCLUDED.point_count,geometry_bytes=EXCLUDED.geometry_bytes,built_at=now()`,
      [level.id,LOD_VERSION,level.name,level.minZoom,level.maxZoom,level.toleranceM]);
    await client.query('COMMIT');
    // Static names come only from the configuration above.
    await client.query(`ANALYZE map.ecoregion_lod_${level.name}`);
    console.log(JSON.stringify({level:level.name,elapsedMs:Math.round(performance.now()-started)}));
  }
  console.log(JSON.stringify((await client.query('SELECT * FROM map.lod_catalog ORDER BY lod')).rows,null,2));
}catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
