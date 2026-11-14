import {mkdir,writeFile} from 'node:fs/promises';
import type {WeatherSnapshot} from '@dryspell/contracts';
import {weatherAt} from '@dryspell/simulation';
const startTime=new Date().toISOString(),base='http://127.0.0.1:4001';
const results=await Promise.all([{name:'Cherkasy',latitude:49.44,longitude:32.06},{name:'California',latitude:38.5,longitude:-122.5}].map(async place=>{
 const query=new URLSearchParams({latitude:String(place.latitude),longitude:String(place.longitude),startTime,durationSec:'45000',refresh:'1'});
 const response=await fetch(`${base}/api/sandbox/weather?${query}`);if(!response.ok)throw new Error(`Weather HTTP ${response.status}`);const weather=await response.json() as WeatherSnapshot;
 const sample=weatherAt(weather,0);const p=weather.provenance[0];
 if(p.parameters?.latitude!==place.latitude||p.parameters?.longitude!==place.longitude||!Number.isFinite(sample.windFromDeg)||!Number.isFinite(sample.windSpeedMps))throw new Error('Incorrect regional weather provenance');
 return {...place,id:weather.id,issuedAt:weather.issuedAt,validAt:weather.validAt,sampleTimeSec:sample.timeSec,windFromDeg:sample.windFromDeg,windSpeedMps:sample.windSpeedMps,sourceUrl:p.sourceUrl};
}));
const demo=await fetch(`${base}/api/sandbox/weather/demo?${new URLSearchParams({startTime,durationSec:'45000'})}`).then(r=>r.json()) as WeatherSnapshot;
if(!demo.provenance[0].sample||demo.samples.at(-1)!.timeSec<45000)throw new Error('Incorrect demo boundary');
const tile=await fetch(`${base}/api/sandbox/map/tiles/landcover/12/1975/1333.png?palette=dryspell-natural-v2`);
const evidence={checkedAt:new Date().toISOString(),mode:'Actual compiled HTTP and live Open-Meteo; explicit bundled demo checked separately',results,demo:{id:demo.id,source:demo.provenance[0],endSec:demo.samples.at(-1)!.timeSec},map:{status:tile.status,palette:tile.headers.get('x-palette-version'),etag:tile.headers.get('etag')}};
await mkdir('docs/evidence',{recursive:true});await writeFile('docs/evidence/sandbox-wind-v3.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));if(!tile.ok)process.exitCode=1;
