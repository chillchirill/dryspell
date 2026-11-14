import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {EnvironmentSnapshot,WeatherSnapshot} from '@dryspell/contracts';
import {validSandboxDuration} from '@dryspell/contracts/sandbox';
/** Explicit user-selected, re-anchored reference conditions; never a live-provider fallback. */
export async function demoWeather(startTime:string,durationSec:number):Promise<WeatherSnapshot>{
 if(!Number.isFinite(Date.parse(startTime))||!validSandboxDuration(durationSec,startTime))throw new Error('Invalid reference-weather timeline');
 const reference=(JSON.parse(await readFile('data/sample/environment.json','utf8')) as EnvironmentSnapshot).weather;
 const samples=structuredClone(reference.samples);if(samples.at(-1)!.timeSec<durationSec)samples.push({...samples.at(-1)!,timeSec:durationSec});
 const validAt=new Date(startTime).toISOString(),now=new Date().toISOString();
 const hash=createHash('sha256').update(JSON.stringify({validAt,samples,source:reference.id})).digest('hex');
 return {id:'demo-weather-'+hash.slice(0,20),validAt,issuedAt:now,samples,stale:false,provenance:[{provider:'Dryspell saved dry-weather demonstration',sourceUrl:'local:data/sample/environment.json',version:'reference-v1',retrievedAt:now,validAt,license:'CC0-1.0',attribution:'Explicit synthetic dry-weather demonstration; not current conditions',checksum:hash,sample:true,parameters:{referenceTime:reference.validAt,referenceId:reference.id,weatherMode:'demo',...(durationSec>21600?{extensionPolicy:'hold-last-conditions',forecastEndSec:21600,extensionEndSec:durationSec}:{})}}]};
}
