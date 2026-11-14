import { createHash } from 'node:crypto';
import type { PredictionInput, PredictionResult, FireHypothesis, FirePosterior, ValidatedObservation, Coordinate } from '@dryspell/contracts';
import { cellCenter, cellIndexAt, computeArrivalTimes, weatherAt, windVector, distanceM } from '@dryspell/simulation';

export const INFERENCE_VERSION='sensor-ensemble-1.1.0';
export async function predictDailyBaseline(input:import('./ml').DailyPredictionRequest){return (await import('./ml')).predictDailyBaseline(input);}
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function seeded(seed:number){let state=seed|0;return ()=>{state|=0;state=(state+0x6D2B79F5)|0;let t=Math.imul(state^(state>>>15),1|state);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296;};}
export function observationEvidence(o:ValidatedObservation,ambient:number){
  const anomaly=o.values.temperatureC===undefined?undefined:o.values.temperatureC-ambient;
  const smoke=o.values.smokePct===undefined?(o.smoke===true?.65:undefined):o.values.smokePct/100;
  const strength=Math.max(anomaly===undefined?0:clamp(anomaly/55,0,1),smoke??0);
  return {strength,critical:o.values.temperatureC!==undefined&&o.values.temperatureC>=70,anomaly,smoke};
}
export function temporalEvidence(o:ValidatedObservation,ambient:number,previous?:NonNullable<FirePosterior['sensorMemory']>[string]){
  const evidence=observationEvidence(o,ambient),seconds=previous?(Date.parse(o.recordedAt)-Date.parse(previous.recordedAt))/1000:0;
  const riseCPerMinute=seconds>0&&seconds<=600&&evidence.anomaly!==undefined&&previous?.temperatureAnomaly!==undefined?(evidence.anomaly-previous.temperatureAnomaly)*60/seconds:undefined;
  const smokeRisePerMinute=seconds>0&&seconds<=600&&o.values.smokePct!==undefined&&previous?.smokePct!==undefined?(o.values.smokePct-previous.smokePct)*60/seconds:undefined;
  const abnormal=evidence.strength>.12,consecutiveAbnormal=abnormal?(seconds>0&&seconds<=600?(previous?.consecutiveAbnormal??0)+1:1):0;
  return {...evidence,riseCPerMinute,smokeRisePerMinute,consecutiveAbnormal,strength:clamp(evidence.strength+Math.max(0,riseCPerMinute??0)/100+Math.max(0,smokeRisePerMinute??0)/200,0,1)};
}
/** Systematic resampling with bounded burnable-cell/time rejuvenation; preserves no-fire mass. */
export function rejuvenatePosterior(hypotheses:FireHypothesis[],grid:PredictionInput['landscapeSnapshot'],noFireProbability:number,seed:number){
  const n=hypotheses.length,fireMass=1-noFireProbability;if(!n||fireMass<1e-10)return hypotheses;
  const rng=seeded(seed),weights=hypotheses.map(h=>h.weight/fireMass),out:FireHypothesis[]=[];let j=0,cumulative=weights[0],offset=rng()/n;
  for(let k=0;k<n;k++){const u=offset+k/n;while(j<n-1&&u>cumulative)cumulative+=weights[++j];const h=structuredClone(hypotheses[j]);
    if(k%4===0){const i=cellIndexAt(grid,h.location),x=i%grid.width,y=Math.floor(i/grid.width),xx=x+Math.floor(rng()*3)-1,yy=y+Math.floor(rng()*3)-1,index=yy*grid.width+xx;if(xx>=0&&xx<grid.width&&yy>=0&&yy<grid.height&&grid.cells[index].burnable&&grid.cells[index].cover!=='unknown')h.location=cellCenter(grid,index);h.ignitionTime=new Date(Date.parse(h.ignitionTime)-Math.floor(rng()*30)*1000).toISOString();}
    h.weight=fireMass/n;out.push(h);
  }return out;
}
function validObservations(input:PredictionInput){const cutoff=Date.parse(input.issuedAt),seen=new Set(input.previousPosterior?.processedObservationIds??[]);return input.observations.filter(o=>{if(seen.has(o.id)||Date.parse(o.recordedAt)>cutoff||(!input.config.retrospective&&Date.parse(o.receivedAt)>cutoff)||o.quality.some(q=>q==='fault'||q==='stale'||q==='missing'))return false;seen.add(o.id);return true;}).sort((a,b)=>Date.parse(a.recordedAt)-Date.parse(b.recordedAt)||a.id.localeCompare(b.id));}
function candidates(input:PredictionInput,observations:ValidatedObservation[]):FireHypothesis[]{
  if(input.previousPosterior?.hypotheses.length)return structuredClone(input.previousPosterior.hypotheses);
  const count=clamp(Math.floor(input.config.ensembleSize),8,64),rng=seeded(input.seed),grid=input.landscapeSnapshot;
  const burnable=grid.cells.map((c,i)=>c.burnable&&c.cover!=='unknown'?i:-1).filter(i=>i>=0);
  if(!burnable.length)return [];
  const anomalous=observations.filter(o=>observationEvidence(o,weatherAt(input.weatherSnapshot,(Date.parse(o.recordedAt)-Date.parse(input.weatherSnapshot.validAt))/1000).temperatureC).strength>.12);
  const out:FireHypothesis[]=[];
  for(let k=0;k<count;k++){let location:Coordinate,time=Date.parse(input.issuedAt)-600000;
    if(anomalous.length&&k<count*.8){const o=anomalous[k%anomalous.length],w=weatherAt(input.weatherSnapshot,Math.max(0,(Date.parse(o.recordedAt)-Date.parse(input.weatherSnapshot.validAt))/1000)),v=windVector(w.windSpeedMps,w.windFromDeg),speed=Math.max(.1,w.windSpeedMps);
      const thermal=o.values.temperatureC!==undefined&&o.values.temperatureC>w.temperatureC+8,radius=thermal?grid.cellSizeM*2:50+rng()*250,angle=rng()*Math.PI*2;
      const east=(thermal?Math.cos(angle):-v.east/speed)*radius+(rng()-.5)*grid.cellSizeM*2,north=(thermal?Math.sin(angle):-v.north/speed)*radius+(rng()-.5)*grid.cellSizeM*2;
      location={longitude:o.location.longitude+east/(111195*Math.max(.05,Math.cos(o.location.latitude*Math.PI/180))),latitude:o.location.latitude+north/111195};
      const i=cellIndexAt(grid,location);if(i<0||!grid.cells[i].burnable||grid.cells[i].cover==='unknown')location=cellCenter(grid,burnable[Math.floor(rng()*burnable.length)]);
      time=Date.parse(o.recordedAt)-(30+rng()*420)*1000;
    }else location=cellCenter(grid,burnable[Math.floor(rng()*burnable.length)]);
    out.push({location,ignitionTime:new Date(time).toISOString(),weight:.5/count});
  }return out;
}
/** Observation-only assimilation. No simulation scenario, ignition list or truth frame is accepted. */
export async function predictFireSpread(input:PredictionInput):Promise<PredictionResult>{
  if(!Number.isFinite(Date.parse(input.issuedAt)))throw new Error('Invalid prediction issue time');
  if(!Number.isFinite(Date.parse(input.weatherSnapshot.issuedAt)))throw new Error('Weather issue time is required');
  if(!input.config.retrospective&&Date.parse(input.weatherSnapshot.issuedAt)>Date.parse(input.issuedAt))throw new Error('Weather was issued after the prediction cutoff; select an available archived forecast or explicitly request retrospective reconstruction');
  if(!input.requestedTimes.length||input.requestedTimes.length>48)throw new Error('Request 1–48 prediction times');
  if(input.landscapeSnapshot.cells.length>250000)throw new Error('Prediction grid exceeds bounded worker limit');
  const started=performance.now(),observations=validObservations(input),grid=input.landscapeSnapshot;let hypotheses=candidates(input,observations);
  const requested=input.requestedTimes.map(x=>Date.parse(x));if(requested.some(x=>!Number.isFinite(x)||x>Date.parse(input.issuedAt)+input.config.horizonSec*1000))throw new Error('Prediction time outside requested horizon');
  const epoch=Math.min(Date.parse(input.weatherSnapshot.validAt),...hypotheses.map(h=>Date.parse(h.ignitionTime)),...requested);
  const maxSec=(Math.max(...requested,Date.parse(input.issuedAt))-epoch)/1000;
  const weather={...input.weatherSnapshot,samples:input.weatherSnapshot.samples.map(s=>({...s,timeSec:s.timeSec+(Date.parse(input.weatherSnapshot.validAt)-epoch)/1000}))};
  let arrivals=hypotheses.map(h=>computeArrivalTimes(grid,weather,[{location:h.location,timeSec:(Date.parse(h.ignitionTime)-epoch)/1000}],maxSec));
  let noFireLog=Math.log(input.previousPosterior?.noFireProbability??.5);
  const logs=hypotheses.map(h=>Math.log(Math.max(1e-12,h.weight))),lastBySensor=new Map<string,number>(),processed=new Set(input.previousPosterior?.processedObservationIds??[]);
  const sensorMemory=structuredClone(input.previousPosterior?.sensorMemory??{});
  let updateCount=0;
  for(const o of observations){if(processed.has(o.id))continue;processed.add(o.id);updateCount++;const time=(Date.parse(o.recordedAt)-epoch)/1000,previous=lastBySensor.get(o.sensorId)??(sensorMemory[o.sensorId]?(Date.parse(sensorMemory[o.sensorId].recordedAt)-epoch)/1000:undefined);lastBySensor.set(o.sensorId,time);
    const reliability=previous===undefined?.7:clamp((time-previous)/60,.02,.7);const nearby=observations.filter(other=>other.sensorId!==o.sensorId&&Math.abs(Date.parse(other.recordedAt)-Date.parse(o.recordedAt))<30000&&distanceM(other.location,o.location)<50).length;
    const ambient=weatherAt(weather,time),evidence=temporalEvidence(o,ambient.temperatureC,sensorMemory[o.sensorId]),idx=cellIndexAt(grid,o.location);
    const weight=reliability/Math.sqrt(1+nearby)*(evidence.consecutiveAbnormal>=2?1.25:1);
    if(!sensorMemory[o.sensorId]||Date.parse(o.recordedAt)>Date.parse(sensorMemory[o.sensorId].recordedAt))sensorMemory[o.sensorId]={recordedAt:o.recordedAt,temperatureAnomaly:evidence.anomaly,smokePct:o.values.smokePct,consecutiveAbnormal:evidence.consecutiveAbnormal};
    if(idx<0)continue;
    const robust=(residual:number)=>-Math.log1p(residual*residual/2);
    noFireLog+=weight*robust(evidence.strength/.18);
    hypotheses.forEach((h,k)=>{const arrival=arrivals[k][idx],age=time-arrival,d=distanceM(h.location,o.location);const thermal=Number.isFinite(arrival)?Math.exp(-Math.abs(age-35)/100):0;
      const v=windVector(ambient.windSpeedMps,ambient.windFromDeg),dx=(o.location.longitude-h.location.longitude)*111195*Math.cos(o.location.latitude*Math.PI/180),dy=(o.location.latitude-h.location.latitude)*111195;
      const along=(dx*v.east+dy*v.north)/Math.max(.1,ambient.windSpeedMps),transport=along/Math.max(.1,ambient.windSpeedMps),sinceIgnition=time-(Date.parse(h.ignitionTime)-epoch)/1000;
      const smoke=along>0&&sinceIgnition>=transport?Math.exp(-d/400)*Math.exp(-Math.abs(dx*v.north-dy*v.east)/Math.max(1,ambient.windSpeedMps)/80):thermal*.6;
      let likelihood=0;if(evidence.anomaly!==undefined)likelihood+=robust((clamp(evidence.anomaly/55,0,1)-thermal)/.25);if(evidence.smoke!==undefined)likelihood+=robust((evidence.smoke-smoke)/.25);
      if(o.values.humidityPct!==undefined&&evidence.anomaly===undefined)likelihood+=.1*robust(((ambient.humidityPct-o.values.humidityPct)/60-thermal*.4)/.5);
      logs[k]+=weight*clamp(likelihood,-5,0);
    });
  }
  // Satellite detections are coarse additional evidence, never exact perimeters or 100% labels.
  for(const sat of input.satelliteEvidence??[]){if(processed.has(`satellite:${sat.id}`))continue;if(Date.parse(sat.observedAt)>Date.parse(input.issuedAt)||(!input.config.retrospective&&Date.parse(sat.receivedAt)>Date.parse(input.issuedAt)))continue;processed.add(`satellite:${sat.id}`);updateCount++;hypotheses.forEach((h,k)=>{logs[k]-=.25*Math.log1p((distanceM(h.location,sat.location)/Math.max(375,sat.nominalResolutionM))**2);});noFireLog-=.5;}
  const maxLog=Math.max(noFireLog,...logs),mass=logs.map(x=>Math.exp(x-maxLog)),noFireMass=Math.exp(noFireLog-maxLog),sum=noFireMass+mass.reduce((a,b)=>a+b,0);
  let noFireProbability=noFireMass/sum;
  if(updateCount===0&&input.previousPosterior){noFireProbability=input.previousPosterior.noFireProbability;}else{hypotheses.forEach((h,k)=>h.weight=.98*mass[k]/sum+.02/(hypotheses.length+1));noFireProbability=.98*noFireProbability+.02/(hypotheses.length+1);}
  const fireMass=1-noFireProbability,conditionalEss=fireMass*fireMass/Math.max(1e-12,hypotheses.reduce((sum,h)=>sum+h.weight*h.weight,0));
  const resampled=updateCount>0&&hypotheses.length>0&&conditionalEss<hypotheses.length*.5;
  if(resampled){hypotheses=rejuvenatePosterior(hypotheses,grid,noFireProbability,input.seed+processed.size);arrivals=hypotheses.map(h=>computeArrivalTimes(grid,weather,[{location:h.location,timeSec:(Date.parse(h.ignitionTime)-epoch)/1000}],maxSec));}
  const posterior:FirePosterior={hypotheses,noFireProbability,processedObservationIds:[...processed],sensorMemory};
  const origin=new Array<number|null>(grid.cells.length).fill(0);for(let i=0;i<origin.length;i++)if(grid.cells[i].cover==='unknown')origin[i]=null;
  for(const h of hypotheses){const i=cellIndexAt(grid,h.location);if(i>=0&&origin[i]!==null)origin[i]=Math.min(.98,(origin[i]??0)+h.weight);}
  const grids=input.requestedTimes.map((time,ti)=>{const t=(requested[ti]-epoch)/1000,pBurningNow:(number|null)[]=[],pReachedByTime:(number|null)[]=[];
    grid.cells.forEach((cell,i)=>{if(cell.cover==='unknown'){pBurningNow.push(null);pReachedByTime.push(null);return;}let burning=0,reached=0;hypotheses.forEach((h,k)=>{const age=t-arrivals[k][i];if(age>=0){reached+=h.weight;if(age<=180)burning+=h.weight;}});pBurningNow.push(Math.min(.98,burning));pReachedByTime.push(Math.min(.98,reached));});return {time,pBurningNow,pReachedByTime,pIgnitionOrigin:[...origin]};});
  const arrivalTimeQuantiles=grid.cells.map((cell,i)=>{const list=hypotheses.map((h,k)=>({a:arrivals[k][i],w:h.weight})).filter(x=>Number.isFinite(x.a)).sort((a,b)=>a.a-b.a),total=list.reduce((s,x)=>s+x.w,0);const q=(p:number)=>{let w=0;for(const x of list){w+=x.w;if(w>=total*p)return x.a+(epoch-Date.parse(input.issuedAt))/1000;}return null;};return {cell:i,p10:q(.1),p50:q(.5),p90:q(.9),noArrivalProbability:1-total};});
  const warnings=['Uncalibrated experimental surface-fire ensemble; not an operational safety prediction.','Arrival quantiles are conditional on arrival and expressed in seconds relative to issue time.'];
  if(input.config.retrospective)warnings.push('Retrospective reconstruction: later-arriving observations or weather may be used. This is not an operational forecast evaluation.');
  if(!observations.length&&!input.previousPosterior)warnings.push('No usable observations: prior only.');
  if(input.modelVersion){const daily=await predictDailyBaseline({directory:process.env.DRYSPELL_MODEL_DIR,region:process.env.DRYSPELL_MODEL_DOMAIN??'unverified',resolutionM:grid.cellSizeM,horizonHours:input.config.horizonSec/3600,features:[]});warnings.push(`Requested ML model ${input.modelVersion}: ${daily.fallbackReason??'Daily feature matrix unavailable in detailed inference input'}; physical ensemble retained.`);}
  return {id:`prediction-${digest({input,posterior}).slice(0,20)}`,issuedAt:input.issuedAt,inputCutoff:input.issuedAt,environmentId:grid.id,modelVersion:INFERENCE_VERSION,calibrationStatus:'uncalibrated',posterior,grids,warnings,arrivalTimeQuantiles,diagnostics:{resampled:resampled?'yes':'no',conditionalEffectiveSampleSize:conditionalEss,observationsProcessed:observations.length,ensembleSize:hypotheses.length,elapsedMs:Math.round(performance.now()-started),effectiveSampleSize:1/(noFireProbability**2+hypotheses.reduce((s,h)=>s+h.weight*h.weight,0))}};
}
