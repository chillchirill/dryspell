import { describe,it,expect } from 'vitest';
import { fixture } from './test-fixture';
import { simulateFrame,createCheckpoint,clearSimulationCache,replayFromCheckpoint,deliverySampleTimes } from './index';
describe('source-time delayed delivery queue',()=>{
  it('emits every sample exactly once at its due receipt, including backlog after the fault ends',()=>{
    const {s,e}=fixture(7),sensor=s.sensors[0];sensor.simulationFaults=[{type:'delay',startTimeSec:0,endTimeSec:30,delaySec:20}];
    const deliveries=[];
    for(let t=0;t<=60;t+=5){const readings=simulateFrame(s,e,t).readings.filter(o=>o.sensorId===sensor.id);if(t<20)expect(readings).toEqual([]);if(t===30)expect(readings.map(o=>o.simulationTimeSec)).toEqual([30,10]);if(t===45)expect(readings.map(o=>o.simulationTimeSec)).toEqual([45,25]);deliveries.push(...readings);}
    expect(new Set(deliveries.map(o=>o.id)).size).toBe(deliveries.length);
    expect(deliveries.map(o=>o.simulationTimeSec).sort((a,b)=>a!-b!)).toEqual(Array.from({length:13},(_,i)=>i*5));
    for(const o of deliveries){const sample=o.simulationTimeSec!;expect(Date.parse(o.receivedAt)-Date.parse(o.recordedAt)).toBe(sample<30?20000:0);}
  });
  it('restores the same backlog across checkpoints and applies measurement faults at source time',()=>{
    const {s,e}=fixture(7),sensor=s.sensors[0];sensor.simulationFaults=[{type:'delay',startTimeSec:0,endTimeSec:30,delaySec:20},{type:'stuck',startTimeSec:10,endTimeSec:15,channels:['temperatureC'],value:0}];
    const checkpoint=createCheckpoint(s,e,20),a=simulateFrame(s,e,30),late=a.readings.find(o=>o.sensorId===sensor.id&&o.simulationTimeSec===10)!;expect(late.values.temperatureC).toBe(0);expect(late.quality).toContain('fault');
    const b=simulateFrame(s,e,45);clearSimulationCache();expect(replayFromCheckpoint(s,e,checkpoint,30)).toEqual(a);expect(simulateFrame(s,e,45)).toEqual(b);
  });
  it('handles overlapping delays and rounds non-tick delays forward without early delivery',()=>{
    const {s}=fixture(),sensor=s.sensors[0];sensor.simulationFaults=[{type:'delay',startTimeSec:0,endTimeSec:20,delaySec:7},{type:'delay',startTimeSec:5,endTimeSec:10,delaySec:12}];
    expect(deliverySampleTimes(sensor,0)).toEqual([]);expect(deliverySampleTimes(sensor,5)).toEqual([]);expect(deliverySampleTimes(sensor,10)).toEqual([0]);expect(deliverySampleTimes(sensor,20)).toEqual([20,10,5]);expect(deliverySampleTimes(sensor,25)).toEqual([25,15]);
  });
});
