/** Real loopback HTTP and downloaded-data acceptance; no provider interception. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import type {WeatherSnapshot} from '@dryspell/contracts';
import type {SandboxWeatherCatalog} from '@dryspell/contracts/sandbox';
const origin='http://127.0.0.1:4001';
async function request<T>(path:string){const started=performance.now(),response=await fetch(origin+path,{signal:AbortSignal.timeout(90000)});assert.equal(response.status,200,await response.clone().text());return {value:await response.json() as T,elapsedMs:Math.round(performance.now()-started)};}
const catalogue=await request<SandboxWeatherCatalog>('/api/sandbox/weather/catalog');
assert.equal(catalogue.value.localArchive?.status,'ready');
const root=resolve('data/weather/ireland-era5'),manifestBytes=await readFile(resolve(root,'manifest.json')),manifest=JSON.parse(manifestBytes.toString());
assert.equal(manifest.points.length,manifest.expectedPointCount);assert.equal(manifest.points.length,130);
let compressedBytes=0,hourlyPointRows=0;
for(const point of manifest.points){const bytes=await readFile(resolve(root,point.file));assert.equal(createHash('sha256').update(bytes).digest('hex'),point.sha256);const data=JSON.parse(gunzipSync(bytes).toString());for(const channel of ['temperatureC','humidityPct','windSpeedMps','windFromDeg','precipitationMm']){assert.equal(data[channel].length,point.count);assert.ok(data[channel].every((value:unknown)=>typeof value==='number'&&Number.isFinite(value)));}assert.equal(data.stepSec,3600);assert.equal(data.startEpochSec,Date.parse(manifest.startTime)/1000);assert.equal(point.count,(Date.parse(manifest.endTime)-Date.parse(manifest.startTime))/3600000+1);compressedBytes+=bytes.length;hourlyPointRows+=point.count;}
const start='2026-07-01T12:00:00.000Z';
const path=(latitude:number,longitude:number,startTime:string,durationSec=21600)=>'/api/sandbox/weather?'+new URLSearchParams({latitude:String(latitude),longitude:String(longitude),startTime,durationSec:String(durationSec)});
const local=await request<WeatherSnapshot>(path(53.025,-6.3515,start)),localAgain=await request<WeatherSnapshot>(path(53.025,-6.3515,start));
const localSource=local.value.provenance[0],params=localSource.parameters!;
assert.equal(params.storage,'local-archive');assert.equal(params.weatherMode,'historical');assert.equal(local.value.id,localAgain.value.id);
const point=manifest.points.find((p:any)=>p.sha256===params.archivePointChecksum);assert.ok(point);
const pointData=JSON.parse(gunzipSync(await readFile(resolve(root,point.file))).toString()),index=(Date.parse(start)/1000-pointData.startEpochSec)/3600;
const zero=local.value.samples.find(sample=>sample.timeSec===0)!;assert.ok(zero);
for(const name of ['temperatureC','humidityPct','windSpeedMps','windFromDeg','precipitationMm'] as const)assert.equal(zero[name],pointData[name][index]);
const longLocal=await request<WeatherSnapshot>(path(53.025,-6.3515,start,1000*3600));assert.equal(longLocal.value.provenance[0].parameters?.storage,'local-archive');assert.equal(longLocal.value.provenance[0].parameters?.extensionPolicy,undefined);assert.ok(longLocal.value.samples.at(-1)!.timeSec>=1000*3600);
const remote=await request<WeatherSnapshot>(path(49.4444,32.0598,start));assert.equal(remote.value.provenance[0].parameters?.weatherMode,'historical');assert.notEqual(remote.value.provenance[0].parameters?.storage,'local-archive');
const currentStart=new Date().toISOString(),current=await request<WeatherSnapshot>(path(53.025,-6.3515,currentStart));assert.equal(current.value.provenance[0].parameters?.weatherMode,'current');assert.equal(current.value.validAt,currentStart);
const summary=(result:{value:WeatherSnapshot;elapsedMs:number})=>({elapsedMs:result.elapsedMs,id:result.value.id,validAt:result.value.validAt,sampleCount:result.value.samples.length,firstSample:result.value.samples.find(s=>s.timeSec>=0),provenance:result.value.provenance});
const evidence={checkedAt:new Date().toISOString(),origin,interceptions:false,catalogue:catalogue.value,download:{pointCount:manifest.points.length,hourlyPointRows,compressedBytes,start:manifest.startTime,end:manifest.endTime,allCompressedPointChecksumsAndFiveHourlyColumnsVerified:true,manifestSha256:createHash('sha256').update(manifestBytes).digest('hex')},local:summary(local),localRepeat:summary(localAgain),longLocal:summary(longLocal),remoteHistorical:summary(remote),current:summary(current)};
await mkdir('docs/evidence',{recursive:true});await writeFile('docs/evidence/sandbox-v4-weather.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({download:evidence.download,localMs:local.elapsedMs,repeatMs:localAgain.elapsedMs,remoteHistoricalMs:remote.elapsedMs,currentMs:current.elapsedMs,checks:'passed'},null,2));
