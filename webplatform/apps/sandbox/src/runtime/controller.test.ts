import { afterEach,describe,expect,it,vi } from 'vitest';
import type { SandboxEvent } from '@dryspell/contracts/sandbox';
import { fixture } from '../../../../packages/simulation/src/test-fixture';
import { simulateFrame } from '@dryspell/simulation';
import { SandboxRuntime,historyWindowFor } from './controller';

afterEach(()=>vi.useRealTimers());
function setup(frontier=0){
  vi.useFakeTimers();const {s,e}=fixture(5);s.config.durationSec=1800;s.authoritativeTimeSec=frontier;e.weather.samples.push({...e.weather.samples[0],timeSec:1800});
  const events:SandboxEvent[]=[],runtime=new SandboxRuntime(event=>events.push(event));
  runtime.handle({type:'load',generation:1,scenario:s,environment:e});
  return {s,e,events,runtime};
}
describe('sandbox fixed-step worker scheduler',()=>{
  it('uses speed only to schedule the same fixed 5-second frames and preserves capability outputs',()=>{
    const {runtime,events,s,e}=setup();expect(events.at(-1)?.type).toBe('ready');
    runtime.handle({type:'run',generation:1,speed:60});vi.advanceTimersByTime(251);
    const frames=events.filter(event=>event.type==='frame').map(event=>event.frame!);expect(frames.map(f=>f.timeSec)).toEqual([5,10,15]);
    frames.forEach(frame=>expect(frame).toEqual(simulateFrame(s,e,frame.timeSec)));
    expect(Object.keys(frames[0].readings[1].values)).toEqual(['temperatureC']);
    runtime.handle({type:'pause',generation:1});const count=events.length;vi.advanceTimersByTime(10000);expect(events).toHaveLength(count);
    runtime.handle({type:'seek',generation:1,timeSec:0});runtime.handle({type:'run',generation:1,speed:1});vi.advanceTimersByTime(5000);
    expect(events.at(-1)?.frame).toEqual(frames[0]);expect(events.at(-1)?.computedUntilSec).toBe(15);
  });
  it('rewinds without changing frontier and resumes existing history before extending it',()=>{
    const {runtime,events}=setup();runtime.handle({type:'run',generation:1,speed:10});vi.advanceTimersByTime(3000);
    runtime.handle({type:'seek',generation:1,timeSec:13});expect(events.at(-1)?.frame?.timeSec).toBe(10);expect(events.at(-1)?.computedUntilSec).toBe(30);
    const pausedCount=events.length;vi.advanceTimersByTime(5000);expect(events).toHaveLength(pausedCount);
    runtime.handle({type:'run',generation:1,speed:10});vi.advanceTimersByTime(2500);expect(events.at(-1)?.frame?.timeSec).toBe(35);expect(events.at(-1)?.computedUntilSec).toBe(35);
  });
  it('restores bounded history by yielded reconstruction with receipt-time cutoff',()=>{
    const {runtime,events,s,e}=setup(300);
    s.sensors[0].simulationFaults=[{type:'delay',startTimeSec:0,endTimeSec:30,delaySec:20}];
    runtime.handle({type:'load',generation:2,scenario:s,environment:e});runtime.handle({type:'seek',generation:2,timeSec:300});
    expect(events.at(-1)?.type).toBe('progress');vi.runAllTimers();
    expect(events.at(-1)?.type).toBe('paused');expect(events.at(-1)?.frame).toEqual(simulateFrame(s,e,300));
    const history=events.at(-1)!.observations!;expect(history).toHaveLength(244);expect(new Set(history.map(x=>x.id)).size).toBe(history.length);
    runtime.handle({type:'seek',generation:2,timeSec:15});const past=events.at(-1)!.observations!;
    expect(past.some(reading=>reading.sensorId===s.sensors[0].id)).toBe(false);
    expect(past.every(reading=>Date.parse(reading.receivedAt)<=Date.parse(events.at(-1)!.frame!.timestamp))).toBe(true);
  });
  it('cancels pending seek/run work and ignores stale generations',()=>{
    const {runtime,events,s,e}=setup(1200);runtime.handle({type:'seek',generation:1,timeSec:1200});
    runtime.handle({type:'load',generation:2,scenario:s,environment:e});const count=events.length;
    runtime.handle({type:'run',generation:1,speed:60});runtime.handle({type:'load',generation:1,scenario:s,environment:e});vi.runAllTimers();expect(events).toHaveLength(count);
    runtime.handle({type:'seek',generation:2,timeSec:1200});runtime.handle({type:'pause',generation:2});const paused=events.length;vi.runAllTimers();expect(events).toHaveLength(paused);expect(events.at(-1)?.frame?.timeSec).toBe(0);
    runtime.handle({type:'dispose',generation:2});runtime.handle({type:'run',generation:2,speed:60});expect(events.at(-1)?.type).toBe('error');
  });
  it('rejects unsupported limits and speed explicitly',()=>{
    const {runtime,events,s,e}=setup();runtime.handle({type:'run',generation:1,speed:2});expect(events.at(-1)?.message).toContain('150, 300');
    s.config.durationSec=21601;runtime.handle({type:'load',generation:2,scenario:s,environment:e});expect(events.at(-1)?.type).toBe('error');expect(events.at(-1)?.message).toContain('five-second');
  });
  it('rejects undeclared channels, duplicate capabilities, weather misalignment and extrapolation',()=>{
    const {runtime,events,s,e}=setup();const bad=structuredClone(s);bad.sensors[1].capabilities=['smokePct'];
    runtime.handle({type:'load',generation:2,scenario:bad,environment:e});expect(events.at(-1)?.message).toContain('capabilities');
    bad.sensors[1].capabilities=['temperatureC'];bad.sensors[0].capabilities=['temperatureC','temperatureC','smokePct'];runtime.handle({type:'load',generation:3,scenario:bad,environment:e});expect(events.at(-1)?.message).toContain('capabilities');
    const wrongTime=structuredClone(e);wrongTime.weather.validAt='2026-01-02T00:00:00Z';runtime.handle({type:'load',generation:4,scenario:s,environment:wrongTime});expect(events.at(-1)?.message).toContain('time origin');
    e.weather.samples.pop();runtime.handle({type:'load',generation:5,scenario:s,environment:e});expect(events.at(-1)?.message).toContain('without extrapolation');
  });
  it('supports six-hour restoration without duplicate full-history transfers, retaining older thirty-minute runs',()=>{
    const {runtime,events,s,e}=setup();expect(events.at(-1)?.type).toBe('ready');
    s.config.durationSec=21600;s.authoritativeTimeSec=21600;e.weather.samples[1].timeSec=21600;
    runtime.handle({type:'load',generation:2,scenario:s,environment:e});runtime.handle({type:'seek',generation:2,timeSec:21600});vi.runAllTimers();
    const end=events.at(-1)!;expect(end.type).toBe('paused');expect(end.frame?.timeSec).toBe(21600);expect(end.computedUntilSec).toBe(21600);expect(end.observations).toHaveLength(4321*4);
    expect(events.filter(event=>event.generation===2&&event.observations&&event.observations.length>4)).toHaveLength(1);
    const final=end.frame;runtime.handle({type:'seek',generation:2,timeSec:21595});runtime.handle({type:'run',generation:2,speed:60});vi.runAllTimers();
    expect(events.at(-1)?.frame).toEqual(final);expect(events.filter(event=>event.type==='frame').every(event=>event.observations===undefined)).toBe(true);
  });
  it('restores 12.5-hour and 48-hour runs with a bounded receipt window and deterministic older rewind',()=>{
    const {runtime,events,s,e}=setup();s.sensors=s.sensors.slice(0,1);s.config.durationSec=48*3600;s.authoritativeTimeSec=s.config.durationSec;e.weather.samples[1].timeSec=s.config.durationSec;
    runtime.handle({type:'load',generation:2,scenario:s,environment:e});
    for(const target of [12.5*3600,48*3600,300,12.5*3600]){
      runtime.handle({type:'seek',generation:2,timeSec:target});vi.runAllTimers();const event=events.at(-1)!;
      expect(event.type).toBe('paused');expect(event.frame).toEqual(simulateFrame(s,e,target));expect(event.computedUntilSec).toBe(48*3600);
      const window=historyWindowFor(s.sensors);expect(event.historyStartSec).toBe(Math.max(0,target-window));expect(event.observations).toHaveLength(Math.min(target/5+1,window/5+1));
      expect(event.observations!.every(reading=>{const receipt=(Date.parse(reading.receivedAt)-Date.parse(s.startTime))/1000;return receipt>=event.historyStartSec!&&receipt<=target;})).toBe(true);
    }
  },20000);
  it('accepts an enormous declared duration without calculating or retaining that whole timeline',()=>{
    const {runtime,events,s,e}=setup();s.config.durationSec=1_000_000_000_000;s.authoritativeTimeSec=0;e.weather.samples[1].timeSec=s.config.durationSec;
    runtime.handle({type:'load',generation:2,scenario:s,environment:e});expect(events.at(-1)?.type).toBe('ready');
    runtime.handle({type:'run',generation:2,speed:60});vi.advanceTimersByTime(84);expect(events.at(-1)?.frame?.timeSec).toBe(5);expect(events.at(-1)?.historyStartSec).toBe(0);
    runtime.handle({type:'pause',generation:2});
  });
  it('accepts 31 and 500 sensors and reports an adaptive bounded history window',()=>{
    const {runtime,events,s,e}=setup();const seed=s.sensors[0];s.sensors=Array.from({length:31},(_,i)=>({...structuredClone(seed),id:`network-${i}`}));
    runtime.handle({type:'load',generation:2,scenario:s,environment:e});expect(events.at(-1)?.type).toBe('ready');expect(events.at(-1)?.frame?.readings).toHaveLength(31);expect(historyWindowFor(s.sensors)).toBe(23220);
    s.sensors=Array.from({length:500},(_,i)=>({...structuredClone(seed),id:`large-${i}`}));s.authoritativeTimeSec=1500;
    runtime.handle({type:'load',generation:3,scenario:s,environment:e});runtime.handle({type:'seek',generation:3,timeSec:1500});vi.runAllTimers();
    const event=events.at(-1)!;expect(event.type).toBe('paused');expect(historyWindowFor(s.sensors)).toBe(1435);expect(event.historyStartSec).toBe(65);expect(event.observations).toHaveLength(144000);
    s.sensors.push({...structuredClone(seed),id:'too-many'});runtime.handle({type:'load',generation:4,scenario:s,environment:e});expect(events.at(-1)?.message).toContain('500');
  },30000);
  it('retains recently received delayed samples even when their observation time precedes the history window',()=>{
    const {runtime,events,s,e}=setup();s.sensors=s.sensors.slice(0,1);s.sensors[0].simulationFaults=[{type:'delay',startTimeSec:0,endTimeSec:5,delaySec:350000}];
    s.config.durationSec=360000;s.authoritativeTimeSec=360000;e.weather.samples[1].timeSec=360000;
    runtime.handle({type:'load',generation:2,scenario:s,environment:e});runtime.handle({type:'seek',generation:2,timeSec:360000});vi.runAllTimers();
    const event=events.at(-1)!,late=event.observations!.find(reading=>reading.simulationTimeSec===0);
    expect(event.historyStartSec).toBe(5);expect(late?.receivedAt).toBe(new Date(Date.parse(s.startTime)+350000000).toISOString());expect(late?.quality).toContain('late');expect(event.observations).toHaveLength(72001);
  },30000);
  it('cancels a long seek after checkpoint eviction and can resume from the still-visible cursor',()=>{
    const {runtime,events,s,e}=setup();s.sensors=s.sensors.slice(0,1);s.config.checkpointIntervalSec=5;s.config.durationSec=172800;s.authoritativeTimeSec=172800;e.weather.samples[1].timeSec=172800;
    runtime.handle({type:'load',generation:2,scenario:s,environment:e});runtime.handle({type:'seek',generation:2,timeSec:172800});vi.runAllTimers();
    runtime.handle({type:'seek',generation:2,timeSec:50000});expect(events.at(-1)?.type).toBe('progress');
    runtime.handle({type:'pause',generation:2});const length=events.length;vi.advanceTimersByTime(1000);expect(events).toHaveLength(length);expect(events.at(-1)?.frame?.timeSec).toBe(172800);
    runtime.handle({type:'seek',generation:2,timeSec:0});vi.runAllTimers();runtime.handle({type:'run',generation:2,speed:60});vi.advanceTimersByTime(84);expect(events.at(-1)?.frame).toEqual(simulateFrame(s,e,5));
  },15000);
  for(const speed of [150,300])it(`paces ${speed}× without losing intermediate five-second readings`,()=>{
    const {runtime,events,s,e}=setup();runtime.handle({type:'run',generation:1,speed});vi.advanceTimersByTime(1000);runtime.handle({type:'pause',generation:1});
    expect(events.at(-1)?.frame?.timeSec).toBe(speed);const frames=events.filter(event=>event.type==='frame');expect(frames.length).toBeLessThanOrEqual(26);
    const delivered=frames.flatMap(event=>event.observationBatch??[]),expected=[];for(let time=5;time<=speed;time+=5)expected.push(...simulateFrame(s,e,time).readings);
    expect(delivered).toEqual(expected);expect(new Set(delivered.map(reading=>reading.id)).size).toBe(delivered.length);
    for(const event of frames)expect(event.frame).toEqual(simulateFrame(s,e,event.frame!.timeSec));
    const count=events.length;vi.advanceTimersByTime(500);expect(events).toHaveLength(count);
  });
  it('catches up cooperatively after a delayed wakeup and reports backpressure without skipping ticks',()=>{
    vi.useFakeTimers();const {s,e}=fixture(3);e.weather.samples.push({...e.weather.samples[0],timeSec:s.config.durationSec});let now=0;const events:SandboxEvent[]=[],runtime=new SandboxRuntime(event=>events.push(event),()=>now);
    runtime.handle({type:'load',generation:1,scenario:s,environment:e});runtime.handle({type:'run',generation:1,speed:300});now=1000;vi.advanceTimersByTime(17);
    expect(events.some(event=>(event.playbackLagSec??0)>0)).toBe(true);vi.advanceTimersByTime(10);runtime.handle({type:'pause',generation:1});
    expect(events.at(-1)?.frame).toEqual(simulateFrame(s,e,300));expect(events.flatMap(event=>event.observationBatch??[])).toHaveLength(60*s.sensors.length);
  });
  it('supports declared channel subsets and disabled empty devices at high speed',()=>{
    const {runtime,events,s,e}=setup();s.sensors[0].capabilities=['temperatureC','smokePct'];s.sensors[2].enabled=false;s.sensors[2].capabilities=[];
    runtime.handle({type:'load',generation:2,scenario:s,environment:e});expect(events.at(-1)?.type).toBe('ready');runtime.handle({type:'run',generation:2,speed:300});vi.advanceTimersByTime(100);runtime.handle({type:'pause',generation:2});
    const frame=events.at(-1)!.frame!;expect(frame.readings).toHaveLength(3);expect(Object.keys(frame.readings[0].values)).toEqual(['temperatureC','smokePct']);expect(frame.readings.some(reading=>reading.sensorId===s.sensors[2].id)).toBe(false);
    s.sensors[2].enabled=true;runtime.handle({type:'load',generation:3,scenario:s,environment:e});expect(events.at(-1)?.type).toBe('error');
  });
  it('keeps a bounded packed frame cache and uses it for repeat visited seeks',()=>{
    const {runtime,events}=setup();runtime.handle({type:'run',generation:1,speed:300});vi.advanceTimersByTime(4000);runtime.handle({type:'pause',generation:1});
    const frames=events.filter(event=>event.type==='frame'),selected=frames.at(-3)!.frame!;expect(runtime.diagnostics.cachedFrames).toBeLessThanOrEqual(64);expect(runtime.diagnostics.cachedFrameBytes).toBeLessThanOrEqual(16*1024*1024);
    runtime.handle({type:'seek',generation:1,timeSec:selected.timeSec});expect(events.at(-1)?.frame).toEqual(selected);expect(runtime.diagnostics.cachedSeeks).toBe(1);
    runtime.handle({type:'dispose',generation:1});expect(runtime.diagnostics.cachedFrames).toBe(0);
  });
  it('retains a one-sensor 29-hour recording and its checkpoints for fast in-session rewind',()=>{
    const {runtime,events,s,e}=setup();s.sensors=s.sensors.slice(0,1);s.config.durationSec=29*3600;s.authoritativeTimeSec=s.config.durationSec;e.weather.samples[1].timeSec=s.config.durationSec;
    runtime.handle({type:'load',generation:2,scenario:s,environment:e});runtime.handle({type:'seek',generation:2,timeSec:s.config.durationSec});vi.runAllTimers();
    expect(events.at(-1)?.historyStartSec).toBe(0);expect(runtime.diagnostics.retainedObservations).toBe(20881);expect(runtime.diagnostics.sensorCheckpoints).toBe(1741);
    runtime.handle({type:'seek',generation:2,timeSec:3605});expect(events.at(-1)?.type).toBe('paused');expect(events.at(-1)?.frame).toEqual(simulateFrame(s,e,3605));
  },15000);
});
