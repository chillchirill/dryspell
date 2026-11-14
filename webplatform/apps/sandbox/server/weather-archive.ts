import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {gunzipSync} from 'node:zlib';
import type {Bounds,WeatherSample} from '@dryspell/contracts';
export const VARIABLES='temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation';
export const ATTRIBUTION='ERA5 reanalysis (Copernicus Climate Change Service / ECMWF), distributed by Open-Meteo.com; CC BY 4.0';
export const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export interface ArchivePoint {latitude:number;longitude:number;sourceLatitude:number;sourceLongitude:number;elevationM:number;file:string;sha256:string;bytes:number;count:number;retrievedAt:string;sourceUrl:string}
export interface ArchiveManifest {version:1;id:string;status:'loading'|'ready';bounds:Bounds;startTime:string;endTime:string;spacingDeg:number;stepSec:number;expectedPointCount:number;provider:string;model:string;nativeResolutionDeg:number;attribution:string;license:string;points:ArchivePoint[];updatedAt:string}
export interface PointData {startEpochSec:number;stepSec:number;temperatureC:number[];humidityPct:number[];windSpeedMps:number[];windFromDeg:number[];precipitationMm:number[]}
export const archiveRoot=()=>resolve(process.env.DRYSPELL_WEATHER_DIR||'data/weather');
export function historicalEnd(now=Date.now()):number {const d=new Date(now);d.setUTCHours(0,0,0,0);return +d-5*86400000-3600000;}
export function archiveUrl(latitudes:number[],longitudes:number[],startDate:string,endDate:string):string {const u=new URL('https://archive-api.open-meteo.com/v1/archive');u.search=new URLSearchParams({latitude:latitudes.join(','),longitude:longitudes.join(','),start_date:startDate,end_date:endDate,hourly:VARIABLES,models:'era5',elevation:latitudes.map(()=>'nan').join(','),cell_selection:'nearest',wind_speed_unit:'ms',temperature_unit:'celsius',precipitation_unit:'mm',timezone:'GMT',timeformat:'unixtime'}).toString();return u.toString();}
export function parseHourly(data:any):{epoch:number;s:WeatherSample}[] {
 const h=data?.hourly,units=data?.hourly_units;
 if(units&&((units.wind_speed_10m!==undefined&&units.wind_speed_10m!=='m/s')||(units.precipitation!==undefined&&units.precipitation!=='mm')||(units.temperature_2m!==undefined&&units.temperature_2m!=='°C')||(units.relative_humidity_2m!==undefined&&units.relative_humidity_2m!=='%')))throw new Error('Weather provider returned unexpected units.');
 if(!Array.isArray(h?.time))throw new Error('Weather lacks initial coverage.');
 return h.time.map((t:string|number,i:number)=>({epoch:typeof t==='number'?t:Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(t)?t:t+'Z')/1000,s:{timeSec:0,temperatureC:h.temperature_2m?.[i],humidityPct:h.relative_humidity_2m?.[i],windSpeedMps:h.wind_speed_10m?.[i],windFromDeg:h.wind_direction_10m?.[i],precipitationMm:h.precipitation?.[i]}}));
}
export function complete(s:WeatherSample):boolean {return Object.values(s).every(v=>typeof v==='number'&&Number.isFinite(v))&&s.humidityPct>=0&&s.humidityPct<=100&&s.windSpeedMps>=0&&s.windFromDeg>=0&&s.windFromDeg<=360&&s.precipitationMm>=0;}
let manifestCache:{path:string;mtime:number;manifest:ArchiveManifest}|undefined;
const points=new Map<string,PointData>();
export async function loadManifest():Promise<ArchiveManifest|null>{const path=resolve(archiveRoot(),'ireland-era5/manifest.json');try{const info=await stat(path);if(manifestCache?.path===path&&manifestCache.mtime===info.mtimeMs)return manifestCache.manifest;const manifest=JSON.parse(await readFile(path,'utf8')) as ArchiveManifest;if(manifest.version!==1||!Array.isArray(manifest.points)||manifest.stepSec!==3600)throw new Error('Unsupported local weather manifest.');manifestCache={path,mtime:info.mtimeMs,manifest};return manifest;}catch(e:any){if(e.code==='ENOENT')return null;throw e;}}
export async function localPoint(latitude:number,longitude:number,start:number,end:number):Promise<{rows:{epoch:number;s:WeatherSample}[];manifest:ArchiveManifest;point:ArchivePoint}|null>{
 const manifest=await loadManifest();if(!manifest||manifest.status!=='ready'||manifest.points.length!==manifest.expectedPointCount||latitude<manifest.bounds.south||latitude>manifest.bounds.north||longitude<manifest.bounds.west||longitude>manifest.bounds.east||start<Date.parse(manifest.startTime)||start>Date.parse(manifest.endTime))return null;
 const point=manifest.points.reduce((best,p)=>{const distance=(q:ArchivePoint)=>(q.latitude-latitude)**2+((q.longitude-longitude)*Math.cos(latitude*Math.PI/180))**2;return distance(p)<distance(best)?p:best;});
 const key=archiveRoot()+point.sha256;let data=points.get(key);if(!data){if(basename(point.file)!==point.file)throw new Error('Invalid archive point path.');const bytes=await readFile(resolve(archiveRoot(),'ireland-era5',point.file));if(digest(bytes)!==point.sha256)throw new Error('Local weather archive checksum mismatch.');data=JSON.parse(gunzipSync(bytes).toString()) as PointData;const columns=[data.temperatureC,data.humidityPct,data.windSpeedMps,data.windFromDeg,data.precipitationMm];if(data.stepSec!==3600||data.startEpochSec!==Date.parse(manifest.startTime)/1000||point.count!==(Date.parse(manifest.endTime)-Date.parse(manifest.startTime))/3600000+1||columns.some(c=>!Array.isArray(c)||c.length!==point.count||c.some(v=>typeof v!=='number'||!Number.isFinite(v))))throw new Error('Invalid local weather archive columns.');if(points.size>=12)points.delete(points.keys().next().value!);points.set(key,data);}
 points.delete(key);points.set(key,data);const first=Math.max(0,Math.floor((start/1000-data.startEpochSec)/3600)),last=Math.min(point.count-1,Math.ceil((end/1000-data.startEpochSec)/3600));const rows=[];for(let i=first;i<=last;i++)rows.push({epoch:data.startEpochSec+i*3600,s:{timeSec:0,temperatureC:data.temperatureC[i],humidityPct:data.humidityPct[i],windSpeedMps:data.windSpeedMps[i],windFromDeg:data.windFromDeg[i],precipitationMm:data.precipitationMm[i]}});return {rows,manifest,point};
}


