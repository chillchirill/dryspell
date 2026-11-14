/** Real-clock, actual terrain benchmark. Does not start or modify application services. */
import {createSampleEnvironment} from '@dryspell/data-sources';
import {cellCenter,checksum,createSimulationSession} from '@dryspell/simulation';
import {fixture} from '../../../../packages/simulation/src/test-fixture';
import type {SandboxEvent} from '@dryspell/contracts/sandbox';
import type {ValidatedObservation} from '@dryspell/contracts';
import {SandboxRuntime} from './controller';

function inputs(count:number,durationSec=21600){
  const e=createSampleEnvironment(),{s}=fixture(),g=e.landscape,index=g.cells.findIndex((c,i)=>c.burnable&&c.cover==='grass'&&i%g.width>g.width*.4&&i%g.width<g.width*.6&&Math.floor(i/g.width)>g.height*.4&&Math.floor(i/g.width)<g.height*.6);
  s.environmentId=e.id;s.startTime=e.weather.validAt;s.config.durationSec=durationSec;s.authoritativeTimeSec=durationSec-1800;s.ignitions=[{id:'fire',location:cellCenter(g,index),timeSec:0}];
  const seed=s.sensors[0];s.sensors=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:`sensor-${i}`,deviceId:`device-${i}`,location:cellCenter(g,index+i)}));
  e.weather.samples=[0,durationSec].map(timeSec=>({timeSec,temperatureC:25,humidityPct:40,windSpeedMps:4,windFromDeg:270,precipitationMm:0}));return {s,e};
}
const reference=new Map<number,{frame:string;history:string}>();
const results=[];
for(const count of [1,30])for(const speed of [150,300]){
  const {s,e}=inputs(count);let latest:SandboxEvent|undefined,recording=false,maxLagSec=0,cloneMs=0,frameEvents=0;
  const deliveries:ValidatedObservation[]=[],times:number[]=[];let onEvent:((event:SandboxEvent)=>void)|undefined;
  const runtime=new SandboxRuntime(event=>{const t=performance.now(),delivered=structuredClone(event);cloneMs+=performance.now()-t;latest=delivered;if(recording){maxLagSec=Math.max(maxLagSec,delivered.playbackLagSec??0);if(delivered.type==='frame'){frameEvents++;times.push(delivered.frame!.timeSec);}deliveries.push(...(delivered.observationBatch??[]));}onEvent?.(delivered);});
  const awaitPaused=(action:()=>void)=>new Promise<void>((resolve,reject)=>{onEvent=event=>{if(event.type==='error')reject(new Error(event.message));if(event.type==='paused'){onEvent=undefined;resolve();}};action();});
  let began=performance.now();runtime.handle({type:'load',generation:1,scenario:s,environment:e});const initialMs=performance.now()-began;
  began=performance.now();await awaitPaused(()=>runtime.handle({type:'seek',generation:1,timeSec:s.authoritativeTimeSec}));const restoreMs=performance.now()-began;
  recording=true;cloneMs=0;began=performance.now();await awaitPaused(()=>runtime.handle({type:'run',generation:1,speed}));const wallMs=performance.now()-began;recording=false;
  if(latest?.frame?.timeSec!==21600||deliveries.length!==360*count||new Set(deliveries.map(reading=>reading.id)).size!==deliveries.length)throw new Error('Playback lost or duplicated observations');
  const frame=latest.frame.checksum,history=checksum(deliveries),previous=reference.get(count);if(previous&&(previous.frame!==frame||previous.history!==history))throw new Error('Playback speed changed outputs');reference.set(count,{frame,history});
  const target=times.at(-4)!,before=runtime.diagnostics.cachedSeeks;began=performance.now();await awaitPaused(()=>runtime.handle({type:'seek',generation:1,timeSec:target}));const cachedSeekMs=performance.now()-began;
  if(runtime.diagnostics.cachedSeeks!==before+1)throw new Error('Expected retained frame cache hit');
  const result={sensors:count,speed,initialMs,restoreMs,playedSimulationSec:1800,wallMs,achievedSpeed:1800/(wallMs/1000),frameEvents,maxLagSec,structuredCloneMs:cloneMs,cachedSeekMs,observationsDelivered:deliveries.length,finalChecksum:frame,deliveryChecksum:history,...runtime.diagnostics,rssBytes:process.memoryUsage().rss};results.push(result);console.log(JSON.stringify(result));runtime.handle({type:'dispose',generation:1});
}
{
  const {s,e}=inputs(1,29*3600);s.authoritativeTimeSec=s.config.durationSec;let latest:SandboxEvent|undefined,onEvent:((event:SandboxEvent)=>void)|undefined;
  const runtime=new SandboxRuntime(event=>{latest=structuredClone(event);onEvent?.(latest);});
  const seek=(timeSec:number)=>new Promise<void>((resolve,reject)=>{onEvent=event=>{if(event.type==='error')reject(new Error(event.message));if(event.type==='paused'){onEvent=undefined;resolve();}};runtime.handle({type:'seek',generation:1,timeSec});});
  runtime.handle({type:'load',generation:1,scenario:s,environment:e});let began=performance.now();await seek(s.config.durationSec);const restore29hMs=performance.now()-began;
  if(latest!.observations!.length!==20881||latest!.historyStartSec!==0||runtime.diagnostics.sensorCheckpoints!==1741)throw new Error('29-hour RAM record was not retained');
  began=performance.now();await seek(3605);const firstOldSeekMs=performance.now()-began,original=latest!.frame!;await seek(s.config.durationSec);began=performance.now();await seek(3605);const repeatedOldSeekMs=performance.now()-began;
  const expected=createSimulationSession(s,e);if(latest!.frame!.checksum!==expected.frameAt(3605).checksum||original.checksum!==latest!.frame!.checksum)throw new Error('Old RAM replay differs');expected.dispose();
  const result={sensors:1,recordedHours:29,restore29hMs,firstOldSeekMs,repeatedOldSeekMs,...runtime.diagnostics,rssBytes:process.memoryUsage().rss};results.push(result);console.log(JSON.stringify(result));runtime.handle({type:'dispose',generation:1});
}
console.log(JSON.stringify({runtime:'Node real-clock worker simulation with structured-clone delivery; no browser renderer; synthetic external weather on actual prepared 40000-cell terrain',results},null,2));
