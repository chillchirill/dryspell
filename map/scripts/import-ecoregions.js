import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import simplify from 'simplify-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawPath = path.join(root,'data/ecoregions-2017.geojson');
const gzipPath = rawPath + '.gz';
const params = new URLSearchParams({where:'1=1',outFields:'ECO_ID,ECO_NAME,BIOME_NAME,BIOME_NUM,COLOR',returnGeometry:'true',outSR:'4326',maxAllowableOffset:'0.02',geometryPrecision:'5',f:'geojson'});
const sourceUrl = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/Resolve_Ecoregions/FeatureServer/0/query?' + params;
let raw, retrievedAt;
try { raw=await readFile(rawPath); retrievedAt=(await stat(rawPath)).mtime.toISOString(); }
catch {
  try {raw=gunzipSync(await readFile(gzipPath));retrievedAt=(JSON.parse(await readFile(path.join(root,'data/ecoregions-source.json'),'utf8'))).retrievedAt;}
  catch {
    const response=await fetch(sourceUrl,{signal:AbortSignal.timeout(90000)});
    if(!response.ok) throw new Error(`Ecoregions upstream HTTP ${response.status}`);
    raw=Buffer.from(await response.arrayBuffer()); retrievedAt=new Date().toISOString();
  }
}
const collection=JSON.parse(raw);
if(collection.type!=='FeatureCollection'||collection.features.length<800||collection.exceededTransferLimit) throw new Error('Incomplete global ecoregion source; refusing import');
function simplifyGeometry(geometry) {
  const polygon = rings => {
    const result=[];
    for(let i=0;i<rings.length;i++) {
      let ring=simplify(rings[i].map(([x,y])=>({x,y})),0.015,true).map(({x,y})=>[x,y]);
      if(ring.length<4) {if(i===0)ring=rings[i];else continue;}
      result.push(ring);
    }
    return result;
  };
  if(geometry.type==='Polygon') {const p=polygon(geometry.coordinates);return p?{type:'Polygon',coordinates:p}:null;}
  if(geometry.type==='MultiPolygon')return {type:'MultiPolygon',coordinates:geometry.coordinates.map(polygon).filter(Boolean)};
  return null;
}
const provenance={dataset:'RESOLVE Ecoregions 2017',version:'2017',url:sourceUrl,
  documentationUrl:'https://developers.google.com/earth-engine/datasets/catalog/RESOLVE_ECOREGIONS_2017',
  license:'CC BY 4.0',retrievedAt,sha256:createHash('sha256').update(raw).digest('hex'),
  boundaryGeneralizationDegrees:0.02,displaySimplificationMetres:1000,
  preprocessingSimplificationDegrees:0.015,
  description:'Regional ecological context, not current land cover. Display boundaries generalized; point lookup near boundaries is approximate.'};
await writeFile(gzipPath,gzipSync(raw,{level:9}));
await writeFile(path.join(root,'data/ecoregions-source.json'),JSON.stringify(provenance,null,2)+'\n');
if(!process.env.MAP_DATABASE_URL) throw new Error('MAP_DATABASE_URL is required to import into the independent map PostGIS database');
const client=new pg.Client({connectionString:process.env.MAP_DATABASE_URL});
client.on('error',error=>console.error('Ecoregion import database connection:',error.message));
await client.connect();
try {
  await client.query(await readFile(path.join(root,'db/ecoregions.sql'),'utf8'));
  await client.query('BEGIN');
  await client.query('INSERT INTO map.ecoregion_sources(version,provenance) VALUES($1,$2) ON CONFLICT(version) DO UPDATE SET provenance=EXCLUDED.provenance',['resolve-2017-v1',provenance]);
  let count=0;
  for (const feature of collection.features) {
    const p=feature.properties;
    const geometry=feature.geometry?simplifyGeometry(feature.geometry):null;
    if(!geometry) continue;
    const zone=/forest[ -]*steppe/i.test(p.ECO_NAME)?'forest-steppe':/steppe/i.test(p.ECO_NAME)?'steppe':/forest/i.test(p.BIOME_NAME)?'forest':/grassland/i.test(p.BIOME_NAME)?'grassland':'other';
    await client.query(`INSERT INTO map.ecoregions(eco_id,name,biome,zone,geom,source_version)
      SELECT $1,$2,$3,$4,ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(ST_Transform(
        ST_Intersection(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($5),4326)),ST_MakeEnvelope(-180,-85,180,85,4326)),3857),1000)),3)),$6
      ON CONFLICT(eco_id) DO UPDATE SET name=EXCLUDED.name,biome=EXCLUDED.biome,zone=EXCLUDED.zone,geom=EXCLUDED.geom,source_version=EXCLUDED.source_version`,
      [p.ECO_ID,p.ECO_NAME,p.BIOME_NAME,zone,JSON.stringify(geometry),'resolve-2017-v1']);
    count++;
    if(count%200===0)console.log(`Imported ${count} ecoregions`);
  }
  await client.query(`UPDATE map.ecoregions SET
    geom_low=ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(geom,25000)),3)),
    geom_mid=ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(geom,5000)),3))`);
  await client.query('COMMIT');
  const {rows}=await client.query('SELECT zone,count(*)::int FROM map.ecoregions GROUP BY zone ORDER BY zone');
  console.log(JSON.stringify({imported:count,source:provenance.dataset,checksum:provenance.sha256,zones:rows}));
} catch(error) {await client.query('ROLLBACK');throw error;}
finally {await client.end();}
await import('./build-lod.js');
