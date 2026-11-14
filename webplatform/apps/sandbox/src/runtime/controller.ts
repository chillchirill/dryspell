import { SANDBOX_PLAYBACK_SPEEDS,validSandboxDuration,type SandboxCommand,type SandboxEvent } from '@dryspell/contracts/sandbox';
import { validSimulationChannels,type Scenario,type EnvironmentSnapshot,type SimulationFrame,type ValidatedObservation } from '@dryspell/contracts';
import { createSimulationSession,type SimulationSession,type ObservationTick } from '@dryspell/simulation';
import {FrameCache} from './frame-cache';

export const SANDBOX_LIMITS={cells:40_000,sensors:500,historyWindowSec:21_600,tickSec:5,observations:144_000} as const;
export function historyWindowFor(sensors:Scenario['sensors']):number {
  const maxDeliveries=sensors.filter(sensor=>sensor.enabled&&!sensor.archived).reduce((sum,sensor)=>sum+new Set([0,...(sensor.simulationFaults??[]).filter(fault=>fault.type==='delay').map(fault=>Math.ceil(Math.max(0,fault.delaySec??0)/5))]).size,0);
  return Math.max(0,Math.floor(SANDBOX_LIMITS.observations/Math.max(1,maxDeliveries))-1)*5;
}
const speeds=new Set<number>(SANDBOX_PLAYBACK_SPEEDS);
const PRESENTATION_INTERVAL_MS=40;

/** Scheduler is deliberately separate from the numerical clock, and injectable through fake timers. */
export class SandboxRuntime {
  private generation=-1;
  private session?:SimulationSession;
  private timer?:ReturnType<typeof setTimeout>;
  private task=0;
  private durationSec=0;
  private historyWindowSec=SANDBOX_LIMITS.historyWindowSec as number;
  private cursorSec=0;
  private frontierSec=0;
  private historyUntilSec=0;
  private historyStartSec=0;
  private receiptBuckets:{timeSec:number;ids:string[]}[]=[];
  private bucketHead=0;
  private frame?:SimulationFrame;
  private frameCache=new FrameCache();
  private cachedSeeks=0;
  private computedCursorSec=0;
  private latestTick?:ObservationTick;
  private observationBatch:ValidatedObservation[]=[];
  private pacing?:{speed:number;anchorSec:number;anchorMs:number;lastPresentationMs:number};
  private observations=new Map<string,ValidatedObservation>();
  constructor(private readonly emit:(event:SandboxEvent)=>void,private readonly clock=()=>performance.now()){}
  get diagnostics(){return {retainedObservations:this.observations.size,historyWindowSec:this.historyWindowSec,cachedFrames:this.frameCache.size,cachedFrameBytes:this.frameCache.bytes,cachedSeeks:this.cachedSeeks,sensorCheckpoints:this.session?.checkpointCount??0};}

  handle(command:SandboxCommand):void {
    if(!Number.isSafeInteger(command.generation)||command.generation<0)return;
    if(command.type==='load'){
      if(command.generation<=this.generation)return;
      this.stop();this.session?.dispose();this.session=undefined;this.generation=command.generation;
      this.cursorSec=0;this.computedCursorSec=0;this.frontierSec=0;this.resetHistory(0);this.frame=undefined;this.latestTick=undefined;this.frameCache.clear();this.cachedSeeks=0;
      try{
        this.validate(command.scenario,command.environment);
        this.durationSec=Math.floor(command.scenario.config.durationSec/5)*5;
        this.historyWindowSec=historyWindowFor(command.scenario.sensors);
        this.frontierSec=this.quantize(command.scenario.authoritativeTimeSec,this.durationSec);
        this.send('progress','Preparing frozen terrain and weather');
        this.session=createSimulationSession(command.scenario,command.environment);
        this.frame=this.session.frameAt(0);this.latestTick=this.frame;this.frameCache.set(this.frame);this.record(this.frame);this.send('ready',undefined,true);
      }catch(error){this.fail(error);}
      return;
    }
    if(command.generation!==this.generation)return;
    if(command.type==='dispose'){this.stop();this.session?.dispose();this.session=undefined;this.resetHistory(0);this.frame=undefined;this.latestTick=undefined;this.frameCache.clear();return;}
    if(!this.session){this.send('error','Load a valid scenario before playback');return;}
    try{
      if(command.type==='pause'){this.present(true);this.stop();this.send('paused');}
      else if(command.type==='run'){
        if(!speeds.has(command.speed))throw new Error(`Playback speed must be ${SANDBOX_PLAYBACK_SPEEDS.join(', ')}`);
        this.present(true);this.stop();const token=this.task;this.send('progress','Running');
        if(this.coversHistory(this.cursorSec))this.startPacing(command.speed,token);
        else this.beginReconstruction(this.cursorSec,token,()=>{this.send('frame',undefined,true);this.startPacing(command.speed,token);});
      }else if(command.type==='seek'){
        if(!Number.isFinite(command.timeSec)||command.timeSec<0)throw new Error('Invalid playback time');
        this.stop();const target=this.quantize(command.timeSec,this.frontierSec),token=this.task;
        this.send('progress','Reconstructing deterministic playback');
        this.beginReconstruction(target,token,()=>{this.send('frame');this.send('paused',undefined,true);});
      }
    }catch(error){this.fail(error);}
  }

  private validate(s:Scenario,e:EnvironmentSnapshot):void {
    if(e.landscape.cells.length>SANDBOX_LIMITS.cells||s.sensors.length>SANDBOX_LIMITS.sensors)throw new Error('Sandbox limit: 40,000 terrain cells and 500 sensors');
    if(!validSandboxDuration(s.config.durationSec,s.startTime))throw new Error('Sandbox duration must use positive five-second ticks within the supported date range');
    if(s.config.outputIntervalSec!==5||!Number.isFinite(s.config.checkpointIntervalSec)||s.config.checkpointIntervalSec<5||s.config.checkpointIntervalSec%5!==0)throw new Error('Sandbox requires 5-second output and checkpoints on 5-second boundaries');
    if(!Number.isFinite(s.authoritativeTimeSec)||s.authoritativeTimeSec<0||!Number.isFinite(Date.parse(s.startTime)))throw new Error('Invalid scenario time');
    if(new Set(s.sensors.map(sensor=>sensor.id)).size!==s.sensors.length)throw new Error('Sensor IDs must be unique');
    for(const sensor of s.sensors){if(!validSimulationChannels(sensor))throw new Error('Sensor capabilities do not match its profile');}
    if(!e.weather.samples.length||e.weather.samples.some((sample,i)=>!Object.values(sample).every(Number.isFinite)||(i>0&&sample.timeSec<=e.weather.samples[i-1].timeSec)))throw new Error('Weather samples must be finite and ordered');
    if(Date.parse(e.weather.validAt)!==Date.parse(s.startTime))throw new Error('Weather time origin must match scenario start');
    if(e.weather.samples[0].timeSec>0||e.weather.samples.at(-1)!.timeSec<s.config.durationSec)throw new Error('Weather must cover the complete run without extrapolation');
  }
  private quantize(time:number,max:number){return Math.floor(Math.max(0,Math.min(time,max))/5)*5;}
  private stop(){this.task++;if(this.timer!==undefined)clearTimeout(this.timer);this.timer=undefined;this.pacing=undefined;this.observationBatch=[];}
  private resetHistory(startSec:number){this.observations.clear();this.receiptBuckets=[];this.bucketHead=0;this.historyStartSec=startSec;this.historyUntilSec=startSec-5;}
  private windowStart(timeSec:number){return Math.max(0,timeSec-this.historyWindowSec);}
  private coversHistory(target:number){return this.historyStartSec<=this.windowStart(target)&&this.historyUntilSec>=target;}
  private record(frame:ObservationTick):void {
    if(frame.timeSec<=this.historyUntilSec)return;
    for(const reading of frame.readings)this.observations.set(reading.id,reading);
    this.receiptBuckets.push({timeSec:frame.timeSec,ids:frame.readings.map(reading=>reading.id)});
    const start=this.windowStart(frame.timeSec);
    while(this.bucketHead<this.receiptBuckets.length&&this.receiptBuckets[this.bucketHead].timeSec<start){for(const id of this.receiptBuckets[this.bucketHead].ids)this.observations.delete(id);this.bucketHead++;}
    if(this.bucketHead>1024){this.receiptBuckets=this.receiptBuckets.slice(this.bucketHead);this.bucketHead=0;}
    this.historyStartSec=Math.max(this.historyStartSec,start);
    if(this.observations.size>SANDBOX_LIMITS.observations)throw new Error('Sandbox observation history limit exceeded');
    this.historyUntilSec=frame.timeSec;
  }
  private startPacing(speed:number,token:number):void {
    if(this.cursorSec>=this.durationSec){this.send('paused','Run complete');return;}
    const now=this.clock();this.computedCursorSec=this.cursorSec;this.pacing={speed,anchorSec:this.cursorSec,anchorMs:now,lastPresentationMs:now};
    this.timer=setTimeout(()=>this.pump(token),Math.ceil(5000/speed));
  }
  private desiredTime(now:number):number {const pacing=this.pacing!;return this.quantize(pacing.anchorSec+Math.max(0,now-pacing.anchorMs)*pacing.speed/1000,this.durationSec);}
  private present(force=false):void {
    if(!this.pacing||!this.session||!this.latestTick||this.computedCursorSec===this.cursorSec)return;
    if(!force&&this.clock()-this.pacing.lastPresentationMs<PRESENTATION_INTERVAL_MS)return;
    this.frame=this.frameCache.get(this.computedCursorSec)??this.session.renderFrame(this.latestTick);this.frameCache.set(this.frame);this.cursorSec=this.computedCursorSec;
    const batch=this.observationBatch;this.observationBatch=[];this.pacing.lastPresentationMs=this.clock();this.send('frame',undefined,false,batch);
  }
  private pump(token:number):void {
    if(token!==this.task||!this.session)return;
    try{
      if(!this.pacing)return;
      const started=this.clock(),target=this.desiredTime(started);let calls=0;
      while(this.computedCursorSec<target&&calls<12&&this.clock()-started<8){
        const tick=this.session.prepareReadings(this.computedCursorSec+5,1);calls++;
        if(tick){this.latestTick=tick;this.computedCursorSec=tick.timeSec;this.record(tick);this.observationBatch.push(...tick.readings);this.frontierSec=Math.max(this.frontierSec,tick.timeSec);}
      }
      this.present(this.computedCursorSec>=this.durationSec);
      if(this.computedCursorSec>=this.durationSec){this.stop();this.send('paused','Run complete');return;}
      const now=this.clock(),behind=this.desiredTime(now)>this.computedCursorSec,p=this.pacing;
      const nextTick=p.anchorMs+(this.computedCursorSec+5-p.anchorSec)*1000/p.speed,nextDisplay=this.computedCursorSec>this.cursorSec?p.lastPresentationMs+PRESENTATION_INTERVAL_MS:Infinity;
      this.timer=setTimeout(()=>this.pump(token),behind?0:Math.max(1,Math.ceil(Math.min(nextTick,nextDisplay)-now)));
    }catch(error){this.fail(error);}
  }
  private beginReconstruction(target:number,token:number,done:()=>void):void {
    if(this.coversHistory(target)){const cached=this.frameCache.get(target);if(cached){this.cachedSeeks++;this.frame=cached;this.latestTick=cached;this.cursorSec=target;this.computedCursorSec=target;done();return;}}
    const start=this.windowStart(target);
    if(this.historyStartSec>start||this.historyUntilSec<start)this.resetHistory(start);
    this.reconstruct(target,token,done);
  }
  private reconstruct(target:number,token:number,done:()=>void):void {
    if(token!==this.task||!this.session)return;
    try{
      // A long jump integrates missing sensor state cooperatively, retaining only the
      // requested recent reading window, not every historical frame on the way there.
      const start=performance.now();let count=0;
      while(this.historyUntilSec<target&&count<12&&performance.now()-start<8){const readings=this.session.prepareReadings(this.historyUntilSec+5,1);if(readings)this.record(readings);count++;}
      const frame=this.historyUntilSec>=target?this.session.prepareFrame(target,12):undefined;
      if(!frame){this.send('progress',`Reconstructing ${Math.max(0,this.session.timeSec)} / ${target} seconds`);this.timer=setTimeout(()=>this.reconstruct(target,token,done),0);return;}
      this.cursorSec=target;this.computedCursorSec=target;this.latestTick=frame;this.frame=frame;this.frameCache.set(frame);done();
    }catch(error){this.fail(error);}
  }
  private send(type:SandboxEvent['type'],message?:string,withHistory=false,batch?:ValidatedObservation[]):void {
    const cutoff=this.frame?Date.parse(this.frame.timestamp):0,start=cutoff-this.historyWindowSec*1000;
    const observations=withHistory?[...this.observations.values()].filter(reading=>{const receipt=Date.parse(reading.receivedAt);return receipt<=cutoff&&receipt>=start;}):undefined;
    this.emit({type,generation:this.generation,computedUntilSec:this.frontierSec,...(type==='ready'||type==='frame'||type==='paused'?{frame:this.frame,historyStartSec:this.windowStart(this.cursorSec)}:{}),...(message?{message}:{}),...(observations?{observations}:{}),...(batch?.length?{observationBatch:batch}:{}),...(this.pacing?{playbackLagSec:Math.max(0,this.desiredTime(this.clock())-this.computedCursorSec)}:{})});
  }
  private fail(error:unknown){this.stop();this.send('error',error instanceof Error?error.message:String(error));}
}
