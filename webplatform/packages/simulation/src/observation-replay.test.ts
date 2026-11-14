import {describe,it,expect} from 'vitest';
import {createSimulationSession,computeArrivalTimes,cellCenter,windVector} from './index';
import {combustionProfile} from './combustion';
import {observationGeometry,sourceFieldAt,queriedSourceFieldAt,sourceObservationTargets} from './observation';
import {fixture} from './test-fixture';

describe('observation-only deterministic reconstruction',()=>{
  it('matches every full-frame reading, including source-time faults and coincident delayed deliveries',()=>{
    const {s,e}=fixture();s.sensors[0].simulationFaults=[{type:'delay',startTimeSec:0,endTimeSec:30,delaySec:20},{type:'dropout',startTimeSec:30,endTimeSec:50,channels:['temperatureC']}];
    s.sensors[1].simulationFaults=[{type:'stuck',startTimeSec:0,endTimeSec:20,value:0}];
    const all=createSimulationSession(s,e),readings=createSimulationSession(s,e);
    for(let t=0;t<=600;t+=5){let tick;while(!tick)tick=readings.prepareReadings(t,1);expect(tick).toEqual({timeSec:t,readings:all.frameAt(t).readings});}
    expect(readings.frameAt(600)).toEqual(all.frameAt(600));
    for(const t of [15,300,600,0]){let tick;while(!tick)tick=readings.prepareReadings(t,1);expect(tick?.readings).toEqual(all.frameAt(t).readings);expect(readings.frameAt(t)).toEqual(all.frameAt(t));}
  });
  it('can abandon a partially prepared reading and immediately reconstruct another target',()=>{
    const {s,e}=fixture(3);s.config.durationSec=45000;s.sensors[0].simulationFaults=[{type:'delay',startTimeSec:0,endTimeSec:1000,delaySec:40000}];
    const session=createSimulationSession(s,e),reference=createSimulationSession(s,e);
    expect(session.prepareReadings(40500,1)).toBeUndefined();expect(session.timeSec).toBe(5);
    expect(session.prepareFrame(5,1)).toEqual(reference.frameAt(5));expect(session.prepareReadings(0,1)?.readings).toEqual(reference.frameAt(0).readings);
  });
  it('lazy local sources give exactly the same targets as the complete field in calm and directional wind',()=>{
    const {s,e}=fixture();e.landscape.cells.forEach((cell,i)=>{if(i%3===0)cell.cover='woodland';});
    const profiles=e.landscape.cells.map(combustionProfile),geometry=observationGeometry(e.landscape),arrival=computeArrivalTimes(e.landscape,e.weather,s.ignitions);
    for(const time of [0,30,180,1000])for(const speed of [0,4])for(const direction of [0,90,225,270]){
      const weather={...e.weather.samples[0],windSpeedMps:speed,windFromDeg:direction},vector=windVector(speed,direction),eager=sourceFieldAt(profiles,arrival,time),lazy=queriedSourceFieldAt(profiles,arrival,time);
      for(const cell of [0,30,60,90,120]){const location=cellCenter(e.landscape,cell);expect(sourceObservationTargets(e.landscape,geometry,profiles,arrival,lazy,location,weather,vector)).toEqual(sourceObservationTargets(e.landscape,geometry,profiles,arrival,eager,location,weather,vector));}
    }
  });
});
