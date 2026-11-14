import { validSandboxDuration,type SandboxCommand,type SandboxEvent } from '@dryspell/contracts/sandbox';
import { SENSOR_PROFILES,type Scenario,type EnvironmentSnapshot,type SimulationFrame,type ValidatedObservation } from '@dryspell/contracts';
import { createSimulationSession,type SimulationSession } from '@dryspell/simulation';

export const SANDBOX_LIMITS={cells:40_000,sensors:30,historyWindowSec:21_600,tickSec:5,observations:144_000} as const;
const speeds=new Set([1,10,60]);

/** Scheduler is deliberately separate from the numerical clock, and injectable through fake timers. */
export class SandboxRuntime {
  private generation=-1;
  private session?:SimulationSession;
  private timer?:ReturnType<typeof setTimeout>;
  private task=0;
  private durationSec=0;
  private cursorSec=0;
  private frontierSec=0;
  private historyUntilSec=0;
  private historyStartSec=0;
  private receiptBuckets:{timeSec:number;ids:string[]}[]=[];
  private bucketHead=0;
  private frame?:SimulationFrame;
  private observations=new Map<string,ValidatedObservation>();
  constructor(private readonly emit:(event:SandboxEvent)=>void){}

  handle(command:SandboxCommand):void {
    if(!Number.isSafeInteger(command.generation)||command.generation<0)return;
    if(command.type==='load'){
      if(command.generation<=this.generation)return;
      this.stop();this.session?.dispose();this.session=undefined;this.generation=command.generation;
      this.cursorSec=0;this.frontierSec=0;this.resetHistory(0);this.frame=undefined;
      try{
        this.validate(command.scenario,command.environment);
        this.durationSec=Math.floor(command.scenario.config.durationSec/5)*5;
        this.frontierSec=this.quantize(command.scenario.authoritativeTimeSec,this.durationSec);
        this.send('progress','Preparing frozen terrain and weather');
        this.session=createSimulationSession(command.scenario,command.environment);
        this.frame=this.session.frameAt(0);this.record(this.frame);this.send('ready',undefined,true);
      }catch(error){this.fail(error);}
      return;
    }
    if(command.generation!==this.generation)return;
    if(command.type==='dispose'){this.stop();this.session?.dispose();this.session=undefined;this.resetHistory(0);this.frame=undefined;return;}
    if(!this.session){this.send('error','Load a valid scenario before playback');return;}
    try{
      if(command.type==='pause'){this.stop();this.send('paused');}
      else if(command.type==='run'){
        if(!speeds.has(command.speed))throw new Error('Playback speed must be 1, 10, or 60');
        this.stop();const token=this.task;this.send('progress','Running');
        if(this.coversHistory(this.cursorSec))this.scheduleTick(command.speed,token);
        else this.beginReconstruction(this.cursorSec,token,()=>{this.send('frame',undefined,true);this.scheduleTick(command.speed,token);});
      }else if(command.type==='seek'){
        if(!Number.isFinite(command.timeSec)||command.timeSec<0)throw new Error('Invalid playback time');
        this.stop();const target=this.quantize(command.timeSec,this.frontierSec),token=this.task;
        this.send('progress','Reconstructing deterministic playback');
        this.beginReconstruction(target,token,()=>{this.send('frame');this.send('paused',undefined,true);});
      }
    }catch(error){this.fail(error);}
  }

  private validate(s:Scenario,e:EnvironmentSnapshot):void {
    if(e.landscape.cells.length>SANDBOX_LIMITS.cells||s.sensors.length>SANDBOX_LIMITS.sensors)throw new Error('Sandbox limit: 40,000 terrain cells and 30 sensors');
    if(!validSandboxDuration(s.config.durationSec,s.startTime))throw new Error('Sandbox duration must use positive five-second ticks within the supported date range');
    if(s.config.outputIntervalSec!==5||!Number.isFinite(s.config.checkpointIntervalSec)||s.config.checkpointIntervalSec<5||s.config.checkpointIntervalSec%5!==0)throw new Error('Sandbox requires 5-second output and checkpoints on 5-second boundaries');
    if(!Number.isFinite(s.authoritativeTimeSec)||s.authoritativeTimeSec<0||!Number.isFinite(Date.parse(s.startTime)))throw new Error('Invalid scenario time');
    if(new Set(s.sensors.map(sensor=>sensor.id)).size!==s.sensors.length)throw new Error('Sensor IDs must be unique');
    for(const sensor of s.sensors){const profile=SENSOR_PROFILES[sensor.profileId];if(!profile||sensor.capabilities.length!==profile.capabilities.length||new Set(sensor.capabilities).size!==sensor.capabilities.length||sensor.capabilities.some(channel=>!profile.capabilities.includes(channel)))throw new Error('Sensor capabilities do not match its profile');}
    if(!e.weather.samples.length||e.weather.samples.some((sample,i)=>!Object.values(sample).every(Number.isFinite)||(i>0&&sample.timeSec<=e.weather.samples[i-1].timeSec)))throw new Error('Weather samples must be finite and ordered');
    if(Date.parse(e.weather.validAt)!==Date.parse(s.startTime))throw new Error('Weather time origin must match scenario start');
    if(e.weather.samples[0].timeSec>0||e.weather.samples.at(-1)!.timeSec<s.config.durationSec)throw new Error('Weather must cover the complete run without extrapolation');
  }
  private quantize(time:number,max:number){return Math.floor(Math.max(0,Math.min(time,max))/5)*5;}
  private stop(){this.task++;if(this.timer!==undefined)clearTimeout(this.timer);this.timer=undefined;}
  private resetHistory(startSec:number){this.observations.clear();this.receiptBuckets=[];this.bucketHead=0;this.historyStartSec=startSec;this.historyUntilSec=startSec-5;}
  private windowStart(timeSec:number){return Math.max(0,timeSec-SANDBOX_LIMITS.historyWindowSec);}
  private coversHistory(target:number){return this.historyStartSec<=this.windowStart(target)&&this.historyUntilSec>=target;}
  private record(frame:SimulationFrame):void {
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
  private scheduleTick(speed:number,token:number):void {
    if(this.cursorSec>=this.durationSec){this.send('paused','Run complete');return;}
    const target=Math.min(this.durationSec,this.cursorSec+5);
    this.timer=setTimeout(()=>this.computeTick(target,speed,token),5000/speed);
  }
  private computeTick(target:number,speed:number,token:number):void {
    if(token!==this.task||!this.session)return;
    try{
      const frame=this.session.prepareFrame(target,12);
      if(!frame){this.timer=setTimeout(()=>this.computeTick(target,speed,token),0);return;}
      this.frame=frame;this.cursorSec=target;this.record(frame);
      this.frontierSec=Math.max(this.frontierSec,this.cursorSec);this.send('frame');this.scheduleTick(speed,token);
    }catch(error){this.fail(error);}
  }
  private beginReconstruction(target:number,token:number,done:()=>void):void {
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
      while(this.historyUntilSec<target&&count<12&&performance.now()-start<8){const frame=this.session.prepareFrame(this.historyUntilSec+5,1);if(frame)this.record(frame);count++;}
      const frame=this.historyUntilSec>=target?this.session.prepareFrame(target,12):undefined;
      if(!frame){this.send('progress',`Reconstructing ${Math.max(0,this.session.timeSec)} / ${target} seconds`);this.timer=setTimeout(()=>this.reconstruct(target,token,done),0);return;}
      this.cursorSec=target;this.frame=frame;done();
    }catch(error){this.fail(error);}
  }
  private send(type:SandboxEvent['type'],message?:string,withHistory=false):void {
    const cutoff=this.frame?Date.parse(this.frame.timestamp):0,start=cutoff-SANDBOX_LIMITS.historyWindowSec*1000;
    const observations=withHistory?[...this.observations.values()].filter(reading=>{const receipt=Date.parse(reading.receivedAt);return receipt<=cutoff&&receipt>=start;}):undefined;
    this.emit({type,generation:this.generation,computedUntilSec:this.frontierSec,...(type==='ready'||type==='frame'||type==='paused'?{frame:this.frame,historyStartSec:this.windowStart(this.cursorSec)}:{}),...(message?{message}:{}),...(observations?{observations}:{})});
  }
  private fail(error:unknown){this.stop();this.send('error',error instanceof Error?error.message:String(error));}
}
