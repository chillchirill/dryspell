import pg from 'pg';
import sharp from 'sharp';
import {ecoregionLod} from './lod.js';

sharp.concurrency(1);
sharp.cache({memory:8,files:0,items:16});
let pool;
function database() {
  if(!process.env.MAP_DATABASE_URL) throw Object.assign(new Error('Ecoregions require the imported PostGIS dataset'),{statusCode:503});
  if(!pool){pool=new pg.Pool({connectionString:process.env.MAP_DATABASE_URL,max:2,connectionTimeoutMillis:4000,idleTimeoutMillis:10000,statement_timeout:5000});pool.on('error',error=>console.error('Ecoregion database connection:',error.message));}
  return pool;
}
export async function lookupEcoregion(lat,lng) {
  const {rows}=await database().query(`SELECT e.eco_id,e.name,e.biome,e.zone,s.provenance FROM map.ecoregions e
    JOIN map.ecoregion_sources s ON s.version=e.source_version
    WHERE ST_Covers(e.geom,ST_Transform(ST_SetSRID(ST_MakePoint($1,$2),4326),3857))
    ORDER BY ST_Area(e.geom) LIMIT 1`,[lng,lat]);
  if(!rows.length)return null;
  const r=rows[0]; return {name:r.name,zone:r.zone,biome:r.biome,ecoregionId:r.eco_id,source:r.provenance};
}
export const ECOREGION_COLORS={steppe:'#d6b76e','forest-steppe':'#9daf63',forest:'#4c8258',grassland:'#bdd180',other:'#b4b6a2'};
export async function renderEcoregionTile({z,x,y},{signal}={}) {
  signal?.throwIfAborted();
  if(!Number.isInteger(z)||z<3||z>19||!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=2**z||y>=2**z) throw Object.assign(new Error('Invalid ecoregion tile'),{statusCode:400});
  const size=40075016.68557849/2**z;
  const left=-20037508.342789244+x*size,top=20037508.342789244-y*size;
  const bounds=[left,top-size,left+size,top];
  const level=ecoregionLod(z);
  // PostgreSQL prunes to exactly one physical partition and uses that level's spatial index.
  // This query never refers to map.ecoregions or COALESCEs to detailed source geometry.
  const {rows}=await database().query(`WITH tile AS (SELECT ST_MakeEnvelope($1,$2,$3,$4,3857) AS geom)
    SELECT e.zone,ST_AsGeoJSON(ST_Intersection(e.geom,tile.geom),2)::json AS geometry
    FROM map.ecoregion_lod e,tile WHERE e.lod=$5 AND e.geom && tile.geom AND ST_Intersects(e.geom,tile.geom)`,[...bounds,level.id]);
  signal?.throwIfAborted();
  const ringPath=ring=>ring.map((p,i)=>`${i?'L':'M'}${((p[0]-left)/size*256).toFixed(2)},${((top-p[1])/size*256).toFixed(2)}`).join('')+'Z';
  function geometryPath(g) {
    if(!g)return '';
    if(g.type==='Polygon')return g.coordinates.map(ringPath).join('');
    if(g.type==='MultiPolygon')return g.coordinates.flatMap(p=>p.map(ringPath)).join('');
    if(g.type==='GeometryCollection')return g.geometries.map(geometryPath).join('');
    return '';
  }
  // Clipping creates artificial polygon edges at tile boundaries; never stroke those edges.
  const grouped=new Map();
  for(const row of rows){if(!grouped.has(row.zone))grouped.set(row.zone,[]);grouped.get(row.zone).push(geometryPath(row.geometry));}
  const paths=[...grouped].map(([zone,parts])=>`<path d="${parts.join('')}" fill="${ECOREGION_COLORS[zone]||ECOREGION_COLORS.other}" fill-rule="evenodd"/>`).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">${paths}</svg>`;
  return sharp(Buffer.from(svg)).png({compressionLevel:5}).toBuffer();
}
export async function lodCatalog(){return (await database().query('SELECT layer,lod,name,min_zoom,max_zoom,tolerance_m,polygon_count,point_count,geometry_bytes,built_at FROM map.lod_catalog ORDER BY lod')).rows;}
export async function pyramidCatalog(version){return (await database().query('SELECT layer,z,tile_count,total_bytes,built_at FROM map.pyramid_catalog WHERE version=$1 ORDER BY z',[version])).rows;}
export async function closeEcoregions(){const current=pool;pool=null;await current?.end();}
