import * as tf from '@tensorflow/tfjs';
import { createReadStream } from 'node:fs';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export interface TrainingRow { eventId:string; geographicBlock:string; timeBlock:string; split:'train'|'validation'|'test'; region:string; fuel:string; features:number[]; label:0|1; previousFire:0|1; physicalProbability?:number; }
export interface SplitPolicy { geographicHoldout?:boolean; temporalHoldout?:boolean; }
export interface DatasetManifest { splitPolicy?:SplitPolicy; name:string; sourceUrl:string; sourceVersion:string; license:string; features:{name:string;unit:string}[]; target:string; resolutionM:number; horizonHours:number; domain:string; retrospective:boolean; coveragePolicy:string; sourceChecksums:Record<string,string>; }
export interface Normalizer {mean:number[];scale:number[];}
const sigmoid=(x:number)=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
const logit=(x:number)=>Math.log(Math.max(1e-6,Math.min(1-1e-6,x))/(1-Math.max(1e-6,Math.min(1-1e-6,x))));
export function fitNormalizer(rows:TrainingRow[]):Normalizer {if(!rows.length)throw new Error('No training rows');const n=rows[0].features.length,mean=Array.from({length:n},(_,j)=>rows.reduce((s,r)=>s+r.features[j],0)/rows.length),scale=mean.map((m,j)=>Math.sqrt(rows.reduce((s,r)=>s+(r.features[j]-m)**2,0)/rows.length)||1);return {mean,scale};}
export const normalize=(features:number[],n:Normalizer)=>features.map((x,j)=>(x-n.mean[j])/n.scale[j]);
export function createSplitValidator(features:number,policy:SplitPolicy={}){
  const groups=new Map<string,string>(),counts={train:0,validation:0,test:0};
  return {
    check(r:TrainingRow){
      if(!['train','validation','test'].includes(r.split))throw new Error('Invalid dataset split');
      if(r.features.length!==features||r.features.some(x=>!Number.isFinite(x))||![0,1].includes(r.label)||![0,1].includes(r.previousFire))throw new Error('Invalid features or coverage label');
      if(!r.eventId||!r.geographicBlock||!r.timeBlock)throw new Error('Event/geographic/time identities are required');
      const keys=[`event:${r.eventId}`,`geographic-time:${r.geographicBlock}:${r.timeBlock}`];
      if(policy.geographicHoldout!==false)keys.push(`geographic:${r.geographicBlock}`);
      if(policy.temporalHoldout)keys.push(`temporal:${r.timeBlock}`);
      for(const key of keys){const prior=groups.get(key);if(prior&&prior!==r.split)throw new Error(`Split leakage: ${key}`);groups.set(key,r.split);}counts[r.split]++;
    },
    finish(){for(const split of ['train','validation','test'] as const)if(!counts[split])throw new Error(`Missing ${split} partition`);return {...counts};}
  };
}
export function validateSplits(rows:TrainingRow[],features:number,policy:SplitPolicy={}){const validator=createSplitValidator(features,policy);rows.forEach(row=>validator.check(row));validator.finish();}
export function metrics(labels:number[],probabilities:number[]){if(labels.length!==probabilities.length||!labels.length)throw new Error('Invalid evaluation arrays');let tp=0,fp=0,fn=0,brier=0;labels.forEach((y,i)=>{const p=probabilities[i];if(p>=.5){if(y)tp++;else fp++;}else if(y)fn++;brier+=(p-y)**2;});const ranked=labels.map((label,i)=>({label,p:probabilities[i]})).sort((a,b)=>b.p-a.p);let positives=labels.reduce((s,y)=>s+y,0),seenPositive=0,seen=0,prAuc=0,lastRecall=0;for(let i=0;i<ranked.length;){let j=i;while(j<ranked.length&&ranked[j].p===ranked[i].p){seen++;seenPositive+=ranked[j].label;j++;}const recall=positives?seenPositive/positives:0;prAuc+=(recall-lastRecall)*(seenPositive/seen);lastRecall=recall;i=j;}const reliability=Array.from({length:10},(_,i)=>{const ids=probabilities.map((p,j)=>p>=i/10&&(p<(i+1)/10||i===9)?j:-1).filter(j=>j>=0);return {lower:i/10,upper:(i+1)/10,count:ids.length,meanPrediction:ids.length?ids.reduce((s,j)=>s+probabilities[j],0)/ids.length:null,observedFrequency:ids.length?ids.reduce((s,j)=>s+labels[j],0)/ids.length:null};});return {count:labels.length,positives,precision:tp/(tp+fp||1),recall:tp/(tp+fn||1),prAuc,brier:brier/labels.length,reliability};}
function calibration(labels:number[],p:number[]){let a=1,b=0;for(let step=0;step<300;step++){let da=0,db=0;for(let i=0;i<labels.length;i++){const x=logit(p[i]),error=sigmoid(a*x+b)-labels[i];da+=error*x;db+=error;}a-=.01*da/labels.length;b-=.01*db/labels.length;}return {a,b};}
function logisticFit(rows:TrainingRow[],n:Normalizer){const w=new Array(n.mean.length).fill(0);let bias=0;for(let step=0;step<200;step++){const gradient=new Array(w.length).fill(0);let gb=0;for(const r of rows){const x=normalize(r.features,n),error=sigmoid(bias+x.reduce((s,v,j)=>s+v*w[j],0))-r.label;gb+=error;for(let j=0;j<w.length;j++)gradient[j]+=error*x[j];}bias-=.04*gb/rows.length;for(let j=0;j<w.length;j++)w[j]-=.04*(gradient[j]/rows.length+.001*w[j]);}return {w,bias};}
export async function loadRows(path:string,limit=500000){const rows:TrainingRow[]=[];for await(const line of createInterface({input:createReadStream(path),crlfDelay:Infinity})){if(line.trim())rows.push(JSON.parse(line));if(rows.length>limit)throw new Error('Bounded training row limit exceeded; use streamed shards or sample whole events');}return rows;}
export async function trainBaseline(rows:TrainingRow[],manifest:DatasetManifest,outDir:string,seed=20261114,epochs=40){
  validateSplits(rows,manifest.features.length,manifest.splitPolicy);if(manifest.resolutionM!==1000||manifest.horizonHours!==24)throw new Error('This baseline is explicitly daily / 1 km');
  const train=rows.filter(r=>r.split==='train'),validation=rows.filter(r=>r.split==='validation'),test=rows.filter(r=>r.split==='test'),normalizer=fitNormalizer(train),n=manifest.features.length;
  await tf.setBackend('cpu');await tf.ready();const model=tf.sequential();model.add(tf.layers.dense({units:32,inputShape:[n],activation:'relu',kernelInitializer:tf.initializers.glorotUniform({seed}),kernelRegularizer:tf.regularizers.l2({l2:.001})}));model.add(tf.layers.dense({units:16,activation:'relu',kernelInitializer:tf.initializers.glorotUniform({seed:seed+1})}));model.add(tf.layers.dense({units:1,activation:'sigmoid',kernelInitializer:tf.initializers.glorotUniform({seed:seed+2})}));model.compile({optimizer:tf.train.adam(.001),loss:'binaryCrossentropy'});
  const tx=tf.tensor2d(train.map(r=>normalize(r.features,normalizer))),ty=tf.tensor2d(train.map(r=>[r.label])),vx=tf.tensor2d(validation.map(r=>normalize(r.features,normalizer))),vy=tf.tensor2d(validation.map(r=>[r.label]));
  const positives=train.reduce((s,r)=>s+r.label,0);const history=await model.fit(tx,ty,{epochs,batchSize:128,shuffle:false,validationData:[vx,vy],classWeight:{0:1,1:Math.min(20,(train.length-positives)/Math.max(1,positives))},callbacks:tf.callbacks.earlyStopping({monitor:'val_loss',patience:5})});
  const predict=async(rs:TrainingRow[])=>{const x=tf.tensor2d(rs.map(r=>normalize(r.features,normalizer))),p=model.predict(x) as tf.Tensor;const a=Array.from(await p.data());x.dispose();p.dispose();return a;};
  const valP=await predict(validation),cal=calibration(validation.map(r=>r.label),valP),raw=await predict(test),p=raw.map(x=>sigmoid(cal.a*logit(x)+cal.b));
  const logistic=logisticFit(train,normalizer),stat=test.map(r=>sigmoid(logistic.bias+normalize(r.features,normalizer).reduce((s,x,j)=>s+x*logistic.w[j],0)));
  const labels=test.map(r=>r.label),evaluation={neural:metrics(labels,p),persistence:metrics(labels,test.map(r=>r.previousFire)),logistic:metrics(labels,stat),physical:test.every(r=>r.physicalProbability!==undefined)?metrics(labels,test.map(r=>r.physicalProbability!)):null,byRegion:Object.fromEntries([...new Set(test.map(r=>r.region))].map(region=>{const indices=test.map((r,i)=>r.region===region?i:-1).filter(i=>i>=0);return [region,metrics(indices.map(i=>labels[i]),indices.map(i=>p[i]))];})),byFuel:Object.fromEntries([...new Set(test.map(r=>r.fuel))].map(fuel=>{const ids=test.map((r,i)=>r.fuel===fuel?i:-1).filter(i=>i>=0);return [fuel,metrics(ids.map(i=>labels[i]),ids.map(i=>p[i]))];}))};
  let blendAlpha:number|null=null;if(validation.every(r=>r.physicalProbability!==undefined)){let best=Infinity;for(let a=0;a<=1.001;a+=.05){const score=metrics(validation.map(r=>r.label),valP.map((x,i)=>a*sigmoid(cal.a*logit(x)+cal.b)+(1-a)*validation[i].physicalProbability!)).brier;if(score<best){best=score;blendAlpha=Math.round(a*100)/100;}}}
  await mkdir(outDir,{recursive:true});let artifacts:tf.io.ModelArtifacts|undefined;await model.save(tf.io.withSaveHandler(async a=>{artifacts=a;return {modelArtifactsInfo:{dateSaved:new Date(),modelTopologyType:'JSON',weightDataBytes:(a.weightData as ArrayBuffer).byteLength}};}));
  const a=artifacts!;await writeFile(join(outDir,'weights.bin'),Buffer.from(a.weightData as ArrayBuffer));await writeFile(join(outDir,'model.json'),JSON.stringify({modelTopology:a.modelTopology,weightsManifest:[{paths:['weights.bin'],weights:a.weightSpecs}]},null,2));
  const lineage={manifest,seed,normalizer,calibration:cal,blendAlpha,featureSchema:manifest.features,backend:tf.getBackend(),rows:{train:train.length,validation:validation.length,test:test.length},epochs:history.epoch.length,datasetChecksum:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),evaluation,promoted:false,reason:'Experimental until independent scientific review and all baseline/domain checks pass.'};await writeFile(join(outDir,'metadata.json'),JSON.stringify(lineage,null,2));
  await writeFile(join(outDir,'MODEL_CARD.md'),`# Dryspell daily baseline\n\nTarget: ${manifest.target}. Scale: 1 km / 24 h. Domain: ${manifest.domain}.\n\nDataset: ${manifest.name} (${manifest.sourceVersion}). ${manifest.retrospective?'Retrospective experiment.':'Operational cutoff enforced by dataset producer.'}\n\nHeld-out neural Brier: ${evaluation.neural.brier}; PR-AUC: ${evaluation.neural.prAuc}. See metadata.json for reliability and region/fuel evaluation.\n\nNot promoted. This artifact never modifies 25 m minute-level predictions. ${evaluation.physical===null?'Physical baseline comparison unavailable: matching-scale probabilities were not supplied.':''}\n`);
  tx.dispose();ty.dispose();vx.dispose();vy.dispose();model.dispose();return lineage;
}
export async function loadBaseline(directory:string){const metadata=JSON.parse(await readFile(join(directory,'metadata.json'),'utf8')),json=JSON.parse(await readFile(join(directory,'model.json'),'utf8')),weights=await readFile(join(directory,'weights.bin'));const model=await tf.loadLayersModel(tf.io.fromMemory({modelTopology:json.modelTopology,weightSpecs:json.weightsManifest[0].weights,weightData:weights.buffer.slice(weights.byteOffset,weights.byteOffset+weights.byteLength)}));return {model,metadata};}
export function modelFallback(metadata:Record<string,unknown>|undefined,region:string,resolutionM:number,horizonHours:number):string|null {if(!metadata)return 'Model artifact unavailable';const m=metadata.manifest as DatasetManifest|undefined;if(!metadata.promoted)return 'Model is experimental and not promoted';if(!m||m.domain!==region)return 'Outside validated geographic domain';if(m.resolutionM!==resolutionM||m.horizonHours!==horizonHours)return 'Model target scale/horizon mismatch';return null;}

export interface DailyPredictionRequest { directory?:string; region:string; resolutionM:number; horizonHours:number; features:number[][]; physicalProbabilities?:number[]; }
export interface DailyPredictionResult { activeModel:'daily-neural'|'physical'; probabilities:number[]|null; fallbackReason:string|null; }
/** Worker-safe runtime entry point: caller must supply the declared daily feature subset/units. */
export async function predictDailyBaseline(input:DailyPredictionRequest):Promise<DailyPredictionResult>{
  const fallback=(reason:string):DailyPredictionResult=>({activeModel:'physical',probabilities:input.physicalProbabilities??null,fallbackReason:reason});
  if(!input.directory)return fallback('Model artifact directory unavailable');
  let loaded:Awaited<ReturnType<typeof loadBaseline>>|undefined;
  try{
    const metadata=JSON.parse(await readFile(join(input.directory,'metadata.json'),'utf8'));
    const reason=modelFallback(metadata,input.region,input.resolutionM,input.horizonHours);if(reason)return fallback(reason);
    const n=metadata.featureSchema?.length;
    if(!n||!input.features.length||input.features.length>250000||input.features.some(row=>row.length!==n||row.some(v=>!Number.isFinite(v))))return fallback('Missing, invalid or oversized daily feature matrix');
    if(input.physicalProbabilities&&(input.physicalProbabilities.length!==input.features.length||input.physicalProbabilities.some(p=>!Number.isFinite(p)||p<0||p>1)))return fallback('Physical probabilities do not match daily target cells');
    loaded=await loadBaseline(input.directory);const x=tf.tensor2d(input.features.map(row=>normalize(row,metadata.normalizer))),tensor=loaded.model.predict(x) as tf.Tensor;
    const raw=Array.from(await tensor.data());x.dispose();tensor.dispose();const cal=metadata.calibration??{a:1,b:0};let p=raw.map(v=>sigmoid(cal.a*logit(v)+cal.b));
    if(input.physicalProbabilities&&Number.isFinite(metadata.blendAlpha)){const a=Math.max(0,Math.min(1,metadata.blendAlpha));p=p.map((v,i)=>a*v+(1-a)*input.physicalProbabilities![i]);}
    return {activeModel:'daily-neural',probabilities:p,fallbackReason:null};
  }catch(error){return fallback(`Model could not load: ${error instanceof Error?error.message:'unknown artifact error'}`);}
  finally{loaded?.model.dispose();}
}
