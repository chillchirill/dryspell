import {writeFile,mkdir} from 'node:fs/promises';
import type {EnvironmentSnapshot} from '@dryspell/contracts';
const results=await Promise.all([{label:'Carpathians',latitude:48.4,longitude:24.5},{label:'California',latitude:38.5,longitude:-122.5}].map(async place=>{
 const start=performance.now();const response=await fetch('http://127.0.0.1:4001/api/sandbox/environment/prepare',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({center:{latitude:place.latitude,longitude:place.longitude},sizeM:1000,startTime:new Date().toISOString(),durationSec:45000}),signal:AbortSignal.timeout(240000)});
 const body=await response.json();if(!response.ok)return{...place,status:response.status,elapsedMs:performance.now()-start,error:body};
 const env=body as EnvironmentSnapshot,l=env.landscape;
 if(l.cells.length!==1600||!l.cells.some(c=>c.burnable)||env.weather.samples.at(-1)!.timeSec<45000)throw new Error('Prepared area acceptance failed');
 return {...place,status:response.status,elapsedMs:performance.now()-start,id:env.id,landscapeId:l.id,bounds:l.bounds,cellCount:l.cells.length,cellSizeM:l.cellSizeM,classes:[...new Set(l.cells.map(c=>c.sourceClassCode))],minElevationM:Math.min(...l.cells.flatMap(c=>c.elevationM===null?[]:[c.elevationM])),maxElevationM:Math.max(...l.cells.flatMap(c=>c.elevationM===null?[]:[c.elevationM])),burnable:l.cells.filter(c=>c.burnable).length,checksum:l.checksum,forecastEndSec:env.weather.provenance[0].parameters?.forecastEndSec,sources:l.provenance.map(p=>({provider:p.provider,sourceUrl:p.sourceUrl,checksum:p.checksum}))};
}));
await mkdir('docs/evidence',{recursive:true});await writeFile('docs/evidence/sandbox-area-live.json',JSON.stringify({checkedAt:new Date().toISOString(),providerMode:'Actual ESA, Copernicus and Open-Meteo through compiled Express; no fixtures',results},null,2));console.log(JSON.stringify(results,null,2));if(results.some(r=>r.status!==200))process.exitCode=1;
