import {readFile,writeFile,mkdir,rename,stat,readdir,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import type {WeatherSnapshot,WeatherSample} from '@dryspell/contracts';
import {validSandboxDuration,type SandboxWeatherCatalog} from '@dryspell/contracts/sandbox';
import {windowsFetch} from '../../../packages/data-sources/src/windows-http';
import {archiveRoot,archiveUrl,ATTRIBUTION,VARIABLES,digest,historicalEnd,loadManifest,localPoint,parseHourly,complete} from './weather-archive';
export class WeatherRequestError extends Error {constructor(message:string,public status=400){super(message);}}
interface Entry {at:number;data:any}
const memory=new Map<string,Entry>(),pending=new Map<string,Promise<Entry>>();
function remember(key:string,entry:Entry){memory.delete(key);if(memory.size>=32)memory.delete(memory.keys().next().value!);memory.set(key,entry);}
let pruning:Promise<void>|undefined;
async function pruneCache(dir:string){if(pruning)return pruning;pruning=(async()=>{const names=(await readdir(dir)).filter(n=>/^[a-f0-9]{64}\.json\.gz$/.test(n));const files=await Promise.all(names.map(async name=>{const info=await stat(resolve(dir,name));return {name,size:info.size,mtime:info.mtimeMs};}));files.sort((a,b)=>b.mtime-a.mtime);let bytes=0;for(let i=0;i<files.length;i++){bytes+=files[i].size;if(i>=128||bytes>64*1024*1024)await unlink(resolve(dir,files[i].name));}})().finally(()=>{pruning=undefined;});return pruning;}
async function acquire(url:string,historical:boolean,refresh:boolean):Promise<Entry>{
 const key=archiveRoot()+url,ttl=historical?30*86400000:900000,now=Date.now(),known=memory.get(key);if(!refresh&&known&&now-known.at<ttl){remember(key,known);return known;}
 const active=pending.get(key);if(active)return active;
 const job=(async()=>{const dir=resolve(archiveRoot(),'cache'),path=resolve(dir,digest(url)+'.json.gz');
 if(!refresh){try{if((await stat(path)).size<8*1024*1024){const cached=JSON.parse(gunzipSync(await readFile(path)).toString());if(cached.url===url&&cached.checksum===digest(JSON.stringify(cached.entry))&&now-cached.entry.at<ttl){remember(key,cached.entry);return cached.entry as Entry;}}}catch{/* A corrupt or absent cache is reacquired, never used as weather. */}}
 let entry:Entry|undefined;for(let attempt=0;attempt<3;attempt++){try{const response=await(process.platform==='win32'?windowsFetch:fetch)(url,{signal:AbortSignal.timeout(25000)});if(!response.ok){const detail=(await response.text()).slice(0,180);throw new Error(`Open-Meteo returned HTTP ${response.status}: ${detail}`);}entry={at:Date.now(),data:await response.json()};break;}catch(e){if(attempt===2)throw e;await new Promise(r=>setTimeout(r,300*(attempt+1)));}}
 if(!entry)throw new Error('Weather unavailable.');remember(key,entry);
 try{await mkdir(dir,{recursive:true});const temp=path+'.tmp';await writeFile(temp,gzipSync(JSON.stringify({url,entry,checksum:digest(JSON.stringify(entry))})));await rename(temp,path);await pruneCache(dir);}catch{/* Read-only storage still permits the explicitly live request. */}
 return entry;
 })().finally(()=>pending.delete(key));pending.set(key,job);return job;
}
export async function weatherCatalog():Promise<SandboxWeatherCatalog>{const m=await loadManifest();return {availableFrom:'1940-01-01T00:00:00.000Z',latestHistoricalStart:new Date(historicalEnd()).toISOString(),stepSec:3600,localArchive:m?{id:m.id,status:m.status==='ready'&&m.points.length===m.expectedPointCount?'ready':'loading',bounds:m.bounds,startTime:m.startTime,endTime:m.endTime,spacingDeg:m.spacingDeg,pointCount:m.points.length,provider:m.provider,attribution:m.attribution}:null};}
export async function weather(latitude:number,longitude:number,startTime:string,durationSec=21600,refresh=false):Promise<WeatherSnapshot>{
 const start=Date.parse(startTime);if(!Number.isFinite(start)||!/(Z|\+00:00)$/.test(startTime))throw new WeatherRequestError('A valid UTC weather start is required.');
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>85||Math.abs(longitude)>180)throw new WeatherRequestError('Valid latitude and longitude required.');
 if(!validSandboxDuration(durationSec,startTime))throw new WeatherRequestError('Invalid experiment duration.');
 const historical=start<Date.now()-3600000;if(start>Date.now()+3600000)throw new WeatherRequestError('Future starts beyond one hour are unsupported. Select current weather or an available historical date.');
 if(historical&&(start<Date.parse('1940-01-01T00:00:00Z')||start>historicalEnd()))throw new WeatherRequestError(`ERA5 historical starts are available from 1940-01-01 through ${new Date(historicalEnd()).toISOString()}. The recent archive gap is not substituted with current weather.`,422);
 let rows:{epoch:number;s:WeatherSample}[],retrievedAt:string,sourceUrl:string,extra:Record<string,unknown>={},resolutionM:number|undefined;
 if(historical){
  const maxEnd=Math.min(start+durationSec*1000,Math.floor(start/86400000)*86400000+31*86400000-3600000,historicalEnd());
  const local=await localPoint(latitude,longitude,start,start+durationSec*1000);
  if(local){rows=local.rows;retrievedAt=local.point.retrievedAt;sourceUrl=local.point.sourceUrl;resolutionM=27830;extra={storage:'local-archive',archiveId:local.manifest.id,archivePointChecksum:local.point.sha256,spatialMethod:'nearest downloaded 0.5-degree sample; provider nearest ERA5 cell',sampleSpacingDeg:local.manifest.spacingDeg,nativeResolutionDeg:.25,requestedCoordinate:{latitude,longitude},sampleCoordinate:{latitude:local.point.latitude,longitude:local.point.longitude},sourceCoordinate:{latitude:local.point.sourceLatitude,longitude:local.point.sourceLongitude},sourceElevationM:local.point.elevationM};}
  else{sourceUrl=archiveUrl([latitude],[longitude],new Date(start).toISOString().slice(0,10),new Date(maxEnd).toISOString().slice(0,10));const entry=await acquire(sourceUrl,true,refresh);rows=parseHourly(entry.data);retrievedAt=new Date(entry.at).toISOString();resolutionM=27830;extra={storage:'remote-persistent-cache',spatialMethod:'nearest ERA5 model cell; elevation downscaling disabled',nativeResolutionDeg:.25,requestedCoordinate:{latitude,longitude},sourceCoordinate:{latitude:entry.data.latitude,longitude:entry.data.longitude},sourceElevationM:entry.data.elevation};}
 }else{
  const forecastHours=Math.min(384,Math.max(9,Math.ceil(durationSec/3600)+3));const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:String(latitude),longitude:String(longitude),hourly:VARIABLES,wind_speed_unit:'ms',temperature_unit:'celsius',precipitation_unit:'mm',timezone:'GMT',past_hours:'2',forecast_hours:String(forecastHours)}).toString();sourceUrl=url.toString();const entry=await acquire(sourceUrl,false,refresh);rows=parseHourly(entry.data);retrievedAt=new Date(entry.at).toISOString();extra={storage:'remote-persistent-cache',sourceCoordinate:{latitude:entry.data.latitude,longitude:entry.data.longitude}};
 }
 const raw=rows.map(r=>({...r.s,timeSec:r.epoch-start/1000}));const first=raw.findIndex(complete);let last=raw.length-1;while(last>=0&&!complete(raw[last]))last--;let samples=raw.slice(Math.max(0,first),last+1);
 if(first<0||samples.length<1||samples.some((s,i)=>!complete(s)||(i>0&&Math.abs(s.timeSec-samples[i-1].timeSec-3600)>.001))||samples[0].timeSec>0||samples.at(-1)!.timeSec<0)throw new Error('Weather lacks complete initial coverage or contains missing values. Retry weather.');
 if(!historical&&samples.at(-1)!.timeSec<Math.min(durationSec,3600))throw new Error('Current weather lacks complete initial-hour coverage.');
 let preceding=0;for(let i=0;i<samples.length;i++)if(samples[i].timeSec<=0)preceding=i;if(historical&&preceding>0)samples=samples.slice(preceding);
 const forecastEndSec=samples.at(-1)!.timeSec,extended=forecastEndSec<durationSec;if(extended)samples.push({...samples.at(-1)!,timeSec:durationSec});
 const parameters={latitude,longitude,weatherMode:historical?'historical':'current',dataKind:historical?'retrospective-reanalysis':'forecast',windUnit:'m/s',windDirectionConvention:'meteorological direction from',precipitationInterval:'preceding hour',issueTimeMeaning:'retrieval availability; provider issue time unavailable',forecastEndSec,coverageEndSec:forecastEndSec,maxHistoricalFetchDays:historical?31:undefined,...extra,...(extended?{extensionPolicy:'hold-last-conditions',extensionEndSec:durationSec,extensionMeaning:historical?'Scenario assumption after acquired historical coverage; not observed or reconstructed historical weather':'Scenario assumption after provider coverage; not a weather forecast'}:{})};
 const checksum=digest(JSON.stringify({startTime:new Date(start).toISOString(),samples,parameters}));return {id:'openmeteo-'+checksum.slice(0,20),validAt:new Date(start).toISOString(),issuedAt:retrievedAt,samples,stale:false,provenance:[{provider:'Open-Meteo',sourceUrl,version:historical?'era5-hourly':'forecast-hourly',retrievedAt,validAt:new Date(start).toISOString(),resolutionM,license:'CC BY 4.0; hosted non-commercial API',attribution:historical?ATTRIBUTION:'Weather data by Open-Meteo.com',checksum,sample:false,parameters}]};
}
