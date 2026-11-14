import { afterEach,describe,expect,it,vi } from 'vitest';
import type { SandboxEvent } from '@dryspell/contracts/sandbox';
import { fixture } from '../../../../packages/simulation/src/test-fixture';
import { simulateFrame } from '@dryspell/simulation';
import { SandboxRuntime } from './controller';

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
    const {runtime,events,s,e}=setup();runtime.handle({type:'run',generation:1,speed:2});expect(events.at(-1)?.message).toContain('1, 10, or 60');
    s.config.durationSec=21601;runtime.handle({type:'load',generation:2,scenario:s,environment:e});expect(events.at(-1)?.type).toBe('error');expect(events.at(-1)?.message).toContain('five-second');
  });
  it('rejects unsupported profile subsets, duplicate capabilities, weather misalignment and extrapolation',()=>{
    const {runtime,events,s,e}=setup();const bad=structuredClone(s);bad.sensors[0].capabilities=['temperatureC'];
    runtime.handle({type:'load',generation:2,scenario:bad,environment:e});expect(events.at(-1)?.message).toContain('capabilities');
    bad.sensors[0].capabilities=['temperatureC','temperatureC','smokePct'];runtime.handle({type:'load',generation:3,scenario:bad,environment:e});expect(events.at(-1)?.message).toContain('capabilities');
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
      expect(event.historyStartSec).toBe(Math.max(0,target-21600));expect(event.observations).toHaveLength(Math.min(target/5+1,4321));
      expect(event.observations!.every(reading=>{const receipt=(Date.parse(reading.receivedAt)-Date.parse(s.startTime))/1000;return receipt>=event.historyStartSec!&&receipt<=target;})).toBe(true);
    }
  },20000);
  it('accepts an enormous declared duration without calculating or retaining that whole timeline',()=>{
    const {runtime,events,s,e}=setup();s.config.durationSec=1_000_000_000_000;s.authoritativeTimeSec=0;e.weather.samples[1].timeSec=s.config.durationSec;
    runtime.handle({type:'load',generation:2,scenario:s,environment:e});expect(events.at(-1)?.type).toBe('ready');
    runtime.handle({type:'run',generation:2,speed:60});vi.advanceTimersByTime(84);expect(events.at(-1)?.frame?.timeSec).toBe(5);expect(events.at(-1)?.historyStartSec).toBe(0);
    runtime.handle({type:'pause',generation:2});
  });
  it('retains recently received delayed samples even when their observation time precedes the history window',()=>{
    const {runtime,events,s,e}=setup();s.sensors=s.sensors.slice(0,1);s.sensors[0].simulationFaults=[{type:'delay',startTimeSec:0,endTimeSec:5,delaySec:40000}];
    s.config.durationSec=45000;s.authoritativeTimeSec=45000;e.weather.samples[1].timeSec=45000;
    runtime.handle({type:'load',generation:2,scenario:s,environment:e});runtime.handle({type:'seek',generation:2,timeSec:45000});vi.runAllTimers();
    const event=events.at(-1)!,late=event.observations!.find(reading=>reading.simulationTimeSec===0);
    expect(event.historyStartSec).toBe(23400);expect(late?.receivedAt).toBe(new Date(Date.parse(s.startTime)+40000000).toISOString());expect(late?.quality).toContain('late');expect(event.observations).toHaveLength(4322);
  },10000);
  it('cancels a long seek after checkpoint eviction and can resume from the still-visible cursor',()=>{
    const {runtime,events,s,e}=setup();s.sensors=s.sensors.slice(0,1);s.config.durationSec=172800;s.authoritativeTimeSec=172800;e.weather.samples[1].timeSec=172800;
    runtime.handle({type:'load',generation:2,scenario:s,environment:e});runtime.handle({type:'seek',generation:2,timeSec:172800});vi.runAllTimers();
    runtime.handle({type:'seek',generation:2,timeSec:100000});expect(events.at(-1)?.type).toBe('progress');
    runtime.handle({type:'pause',generation:2});const length=events.length;vi.advanceTimersByTime(1000);expect(events).toHaveLength(length);expect(events.at(-1)?.frame?.timeSec).toBe(172800);
    runtime.handle({type:'seek',generation:2,timeSec:0});vi.runAllTimers();runtime.handle({type:'run',generation:2,speed:60});vi.advanceTimersByTime(84);expect(events.at(-1)?.frame).toEqual(simulateFrame(s,e,5));
  },15000);
});
