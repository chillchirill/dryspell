import { describe,it,expect } from 'vitest';
import { fixture } from './test-fixture';
import { computeArrivalTimes } from './index';
describe('cached time-dependent edge integrals',()=>{
  it('converges to fine reference stepping through weather knots and clamps',()=>{
    const {e,s}=fixture(9);e.weather.samples=[{timeSec:0,temperatureC:25,humidityPct:30,windSpeedMps:2,windFromDeg:359,precipitationMm:0},{timeSec:113,temperatureC:35,humidityPct:10,windSpeedMps:6,windFromDeg:1,precipitationMm:0},{timeSec:401,temperatureC:18,humidityPct:80,windSpeedMps:2,windFromDeg:180,precipitationMm:15}];
    const coarse=computeArrivalTimes(e.landscape,e.weather,s.ignitions,900,5),fine=computeArrivalTimes(e.landscape,e.weather,s.ignitions,900,1),reference=computeArrivalTimes(e.landscape,e.weather,s.ignitions,900,.5,180,true);
    let coarseError=0,fineError=0;reference.forEach((value,i)=>{expect(Number.isFinite(fine[i])).toBe(Number.isFinite(value));if(Number.isFinite(value)){coarseError=Math.max(coarseError,Math.abs(coarse[i]-value));fineError=Math.max(fineError,Math.abs(fine[i]-value));}});
    expect(fineError).toBeLessThan(coarseError);expect(fineError).toBeLessThan(.05);
  });
  it('preserves water barriers and bounded maximum rate during wind/slope changes',()=>{
    const {e,s}=fixture(7);e.landscape.cells.forEach((cell,i)=>{cell.spreadRateMps=4;cell.elevationM=i%7*10;if(i%7===5){cell.burnable=false;cell.cover='water';}});e.weather.samples.push({...e.weather.samples[0],timeSec:80,windSpeedMps:15,windFromDeg:270});
    const cached=computeArrivalTimes(e.landscape,e.weather,s.ignitions,180,1),reference=computeArrivalTimes(e.landscape,e.weather,s.ignitions,180,.25,180,true);
    cached.forEach((value,i)=>{if(i%7>=5)expect(value).toBe(Infinity);if(Number.isFinite(reference[i]))expect(Math.abs(value-reference[i])).toBeLessThan(.05);});
  });
});
