import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
export async function parseDailyRequest(body:unknown){
  let featureCount=13;
  if(process.env.DRYSPELL_MODEL_DIR){try{const metadata=JSON.parse(await readFile(path.join(process.env.DRYSPELL_MODEL_DIR,'metadata.json'),'utf8'));const count=metadata.featureSchema?.length;if(Number.isInteger(count)&&count>=1&&count<=128)featureCount=count;}catch{/* Missing artifacts are an explicit worker fallback, not a fake model. */}}
  return z.object({region:z.string().min(1).max(120),resolutionM:z.number().finite().positive().max(100000),horizonHours:z.number().finite().positive().max(168),features:z.array(z.array(z.number().finite()).length(featureCount)).min(1).max(4096),physicalProbabilities:z.array(z.number().min(0).max(1)).max(4096).optional()}).strict().refine(v=>!v.physicalProbabilities||v.physicalProbabilities.length===v.features.length,'Physical probabilities must match daily target cells').parse(body);
}
export async function runDailyPrediction(payload:Awaited<ReturnType<typeof parseDailyRequest>>,id:string){
  const {predictDailyBaseline}=await import('@dryspell/inference');
  const issuedAt=new Date().toISOString();
  const result=await predictDailyBaseline({...payload,directory:process.env.DRYSPELL_MODEL_DIR});
  return{id,issuedAt,inputCutoff:issuedAt,kind:'daily-prediction',target:'satellite-observable active fire',resolutionM:payload.resolutionM,horizonHours:payload.horizonHours,region:payload.region,cellCount:payload.features.length,featureCount:payload.features[0].length,modelVersion:result.activeModel==='daily-neural'?'configured-promoted-daily-model':'physical-fallback',...result};
}
