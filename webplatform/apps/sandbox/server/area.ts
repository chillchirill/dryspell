import {z} from 'zod';
import type {EnvironmentSnapshot,LandscapeSnapshot} from '@dryspell/contracts';
import {validSandboxDuration} from '@dryspell/contracts/sandbox';
import {prepareLandscape} from '../../../packages/data-sources/src/prepare';
import {weather} from './weather';
const requestSchema=z.object({center:z.object({longitude:z.number().finite().min(-180).max(180),latitude:z.number().finite().min(-85).max(85)}),sizeM:z.number().finite().min(1000).max(20000).default(5000),startTime:z.string().datetime(),durationSec:z.number().refine(n=>validSandboxDuration(n))}).superRefine((r,ctx)=>{if(!validSandboxDuration(r.durationSec,r.startTime))ctx.addIssue({code:'custom',message:'Use a valid UTC start and a positive duration within the supported date range.'});});
const landscapes=new Map<string,LandscapeSnapshot>(),pending=new Map<string,Promise<LandscapeSnapshot>>();
export class AreaRequestError extends Error {constructor(message:string,public status=400){super(message);}}
export async function prepareArea(input:unknown):Promise<EnvironmentSnapshot>{
 const result=requestSchema.safeParse(input);if(!result.success)throw new AreaRequestError(result.error.issues.map(i=>i.message).join(' '));
 const request=result.data,key=JSON.stringify([request.center.longitude,request.center.latitude,request.sizeM]);
 let landscape=landscapes.get(key);
 if(!landscape){
  let job=pending.get(key);
  if(!job){
   if(pending.size>=2)throw new AreaRequestError('Two areas are already being prepared. Retry shortly.',429);
   if(process.platform==='win32')process.env.DRYSPELL_WINDOWS_HTTP='1';
   const cellSizeM=Math.max(25,request.sizeM/200);
   job=prepareLandscape({...request,cellSizeM}).then(l=>{if(landscapes.size>=8)landscapes.delete(landscapes.keys().next().value!);landscapes.set(key,l);return l;}).finally(()=>pending.delete(key));pending.set(key,job);
  }
  landscape=await job;
 }
 if(!landscape.cells.some(c=>c.burnable))throw new AreaRequestError('No burnable land with available elevation was found in this area. Choose another land area.',422);
 const conditions=await weather(request.center.latitude,request.center.longitude,request.startTime,request.durationSec);
 const warnings=['WorldCover 2021 and Copernicus DSM are historical analytical inputs. Surface fuel rates are illustrative, not locally calibrated. Cropland uses a herbaceous fuel assumption.'];
 if(conditions.provenance.some(p=>p.parameters?.extensionPolicy==='hold-last-conditions'))warnings.push('After acquired weather coverage, final conditions are held as an explicit scenario assumption, not reconstructed historical weather or a forecast.');
 return {id:`${landscape.id}:${conditions.id}`,name:`Area ${request.center.latitude.toFixed(3)}, ${request.center.longitude.toFixed(3)}`,createdAt:new Date().toISOString(),sample:false,status:landscape.cells.some(c=>c.cover==='unknown'||c.elevationM===null)?'partial':'ready',landscape,weather:conditions,warnings};
}
