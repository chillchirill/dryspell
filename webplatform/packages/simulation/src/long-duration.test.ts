import {describe,it,expect} from 'vitest';
import {createSimulationSession,simulateFrame,computeArrivalTimes,MAX_SENSOR_CHECKPOINTS} from './index';
import {fixture} from './test-fixture';

describe('bounded long-duration engine',()=>{
  it('pins the new versioned combustion model six-hour frame checksums',()=>{
    const {s,e}=fixture();s.config.durationSec=21600;e.weather.samples.push({...e.weather.samples[0],timeSec:21600,windSpeedMps:4,windFromDeg:270});
    // 1.2.0 results were deliberately superseded by the fuel-consumption/observation model.
    const expected=['9020761de1ec980296ad30bdf60698bfd73050745073866cbd99261df09211af','ffeb2515f1359df5b5c34d5d26ad85066c4aa7f4d6d355521e439c361c31a9b1','3e38c4a10655f0082a4b43071d07c34dc97a529c286c27f3238483ab529ff051','7581a381448c99b7ed1c2c9c9c424d97ae244585fa9d131402e1a27eead746e2'];
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
