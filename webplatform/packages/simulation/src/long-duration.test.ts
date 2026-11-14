import {describe,it,expect} from 'vitest';
import {createSimulationSession,simulateFrame,computeArrivalTimes,MAX_SENSOR_CHECKPOINTS} from './index';
import {fixture} from './test-fixture';

describe('bounded long-duration engine',()=>{
  it('pins the new versioned combustion model six-hour frame checksums',()=>{
    const {s,e}=fixture();s.config.durationSec=21600;e.weather.samples.push({...e.weather.samples[0],timeSec:21600,windSpeedMps:4,windFromDeg:270});
    // 1.3.2 adds local burning-cell heat coupling and its derived relative humidity.
    const expected=['3cd6b9cb32fc27990950b6c664ff10b8ae52c6bfa228873b59f9a4c5ed9d5353','361526bc6dd2a6b3abfae5400aed09ff4aba6fb5c3d3b0e27a952e6e96ca2b57','78e4e58adc4954b99e491c29fe1566e41c48ac03ab8672927632afcc223e74a6','044f9bbf81a378335584cb12e9b820d62c02f3a1c80f8edb3e4e3d3a23e90c44'];
    expect([0,30,300,21600].map(t=>simulateFrame(s,e,t).checksum)).toEqual(expected);
  });
  it('handles huge constant tails without allocating horizon-sized rate arrays',()=>{
    const {s,e}=fixture(3);e.weather.samples.push({...e.weather.samples[0],timeSec:3600,windSpeedMps:5,windFromDeg:270},{...e.weather.samples[0],timeSec:1e12,windSpeedMps:5,windFromDeg:270});
    const long=computeArrivalTimes(e.landscape,e.weather,s.ignitions,1e12),short=computeArrivalTimes(e.landscape,e.weather,s.ignitions,21600);
    expect([...long]).toEqual([...short]);
    e.landscape.cells.forEach(cell=>cell.spreadRateMps=1e-8);
    const slow=computeArrivalTimes(e.landscape,e.weather,s.ignitions,1e12);expect(Number.isFinite(slow[5])).toBe(true);expect(slow[5]).toBeGreaterThan(21600);
  });
  it('crosses multiple changing-weather chunks with stable arrival times',()=>{
    const {s,e}=fixture(3);e.landscape.cells.forEach(cell=>cell.spreadRateMps=.0006);
    e.weather.samples=[{...e.weather.samples[0],timeSec:0},{...e.weather.samples[0],timeSec:36000,windSpeedMps:5,windFromDeg:270},{...e.weather.samples[0],timeSec:172800,windSpeedMps:5,windFromDeg:270}];
    const coarse=computeArrivalTimes(e.landscape,e.weather,s.ignitions,172800,5),fine=computeArrivalTimes(e.landscape,e.weather,s.ignitions,172800,2.5);
    expect(coarse[5]).toBeGreaterThan(21600);expect(Math.abs(coarse[5]-fine[5])).toBeLessThan(.01);
  });
  it('evicts sensor checkpoints while preserving exact old and recent replay',()=>{
    const {s,e}=fixture(3);s.sensors=s.sensors.slice(0,1);s.config.durationSec=172800;s.config.checkpointIntervalSec=5;
    const session=createSimulationSession(s,e),early=session.frameAt(300),later=session.frameAt(172800);
    expect(session.checkpointCount).toBeLessThanOrEqual(MAX_SENSOR_CHECKPOINTS);expect(session.frameAt(300)).toEqual(early);expect(session.frameAt(172800)).toEqual(later);
  });
  it('prepares long jumps and delayed source states with a cooperative fixed-step budget',()=>{
    const {s,e}=fixture(3);s.config.durationSec=45000;s.sensors=s.sensors.slice(0,1);s.sensors[0].simulationFaults=[{type:'delay',startTimeSec:0,endTimeSec:1000,delaySec:40000}];
    const session=createSimulationSession(s,e);expect(session.prepareFrame(40500,1)).toBeUndefined();expect(session.timeSec).toBe(5);
    let result;let calls=1;while(!result&&calls<10000){result=session.prepareFrame(40500,12);calls++;}
    expect(calls).toBeGreaterThan(100);expect(result).toEqual(simulateFrame(s,e,40500));expect(result?.readings.some(reading=>reading.simulationTimeSec===500)).toBe(true);expect(session.checkpointCount).toBeLessThanOrEqual(MAX_SENSOR_CHECKPOINTS);
  });
});
