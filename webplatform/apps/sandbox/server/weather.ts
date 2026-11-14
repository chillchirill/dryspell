import {createHash} from 'node:crypto';
import type {WeatherSnapshot,WeatherSample} from '@dryspell/contracts';
import {windowsFetch} from '../../../packages/data-sources/src/windows-http';
import {validSandboxDuration} from '@dryspell/contracts/sandbox';
const cache=new Map<string,{at:number;data:any}>();
export async function weather(latitude:number,longitude:number,startTime:string,durationSec=21600):Promise<WeatherSnapshot>{
 const start=Date.parse(startTime);if(!Number.isFinite(start)||Math.abs(start-Date.now())>3600000)throw new Error('New weather requires a start within one hour of now. Saved runs retain their weather.');
 if(!validSandboxDuration(durationSec,startTime))throw new Error('Invalid experiment duration.');
 const forecastHours=Math.min(384,Math.max(9,Math.ceil(durationSec/3600)+3));
 const key=`${latitude.toFixed(3)},${longitude.toFixed(3)}:${forecastHours}`;let entry=cache.get(key);
 const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:String(latitude),longitude:String(longitude),hourly:'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation',wind_speed_unit:'ms',temperature_unit:'celsius',precipitation_unit:'mm',timezone:'GMT',past_hours:'2',forecast_hours:String(forecastHours)}).toString();
 if(!entry||Date.now()-entry.at>900000){const response=await (process.platform==='win32'?windowsFetch:fetch)(url.toString(),{signal:AbortSignal.timeout(25000)});if(!response.ok)throw new Error(`Open-Meteo returned HTTP ${response.status}`);entry={at:Date.now(),data:await response.json()};if(cache.size>=32)cache.delete(cache.keys().next().value!);cache.set(key,entry);}
 const h=entry.data.hourly;if(!h?.time?.length)throw new Error('Open-Meteo returned no weather');
 const raw:WeatherSample[]=h.time.map((time:string,i:number)=>({timeSec:(Date.parse(time+'Z')-start)/1000,temperatureC:h.temperature_2m?.[i],humidityPct:h.relative_humidity_2m?.[i],windSpeedMps:h.wind_speed_10m?.[i],windFromDeg:h.wind_direction_10m?.[i],precipitationMm:h.precipitation?.[i]}));
 const complete=(s:WeatherSample)=>Object.values(s).every(v=>typeof v==='number'&&Number.isFinite(v))&&s.humidityPct>=0&&s.humidityPct<=100&&s.windSpeedMps>=0&&s.precipitationMm>=0;
 const first=raw.findIndex(complete);let last=raw.length-1;while(last>=0&&!complete(raw[last]))last--;
 const samples=raw.slice(Math.max(0,first),last+1);
 if(first<0||samples.length<2||samples.some((s,i)=>!complete(s)||(i>0&&s.timeSec<=samples[i-1].timeSec))||samples[0].timeSec>0||samples.at(-1)!.timeSec<Math.min(durationSec,3600))throw new Error('Weather lacks complete initial coverage or contains missing values. Retry weather.');
 const forecastEndSec=samples.at(-1)!.timeSec,extended=forecastEndSec<durationSec;
 if(extended)samples.push({...samples.at(-1)!,timeSec:durationSec});
 const parameters={latitude,longitude,windUnit:'m/s',precipitationInterval:'preceding hour',issueTimeMeaning:'retrieval availability; provider issue time unavailable',forecastEndSec,...(extended?{extensionPolicy:'hold-last-conditions',extensionEndSec:durationSec,extensionMeaning:'Scenario assumption after provider coverage; not a weather forecast'}:{})};
 const checksum=createHash('sha256').update(JSON.stringify({startTime,samples,parameters})).digest('hex');return {id:'openmeteo-'+checksum.slice(0,20),validAt:new Date(start).toISOString(),issuedAt:new Date(entry.at).toISOString(),samples,stale:false,provenance:[{provider:'Open-Meteo',sourceUrl:url.toString(),version:'forecast-hourly',retrievedAt:new Date(entry.at).toISOString(),validAt:new Date(start).toISOString(),license:'CC BY 4.0; hosted non-commercial API',attribution:'Weather data by Open-Meteo.com',checksum,sample:false,parameters}]};
}
