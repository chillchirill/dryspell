import {describe,it,expect} from 'vitest';
import {COMBUSTION_PROFILES,combustionAt,combustionInterval,combustionProfile,TON_ACRE_TO_KG_M2} from './combustion';
import {cellCenter,computeArrivalTimes,simulateFrame,createCheckpoint,restoreCheckpoint,replayFromCheckpoint,clearSimulationCache} from './index';
import {humidityAtTemperature,saturationPressurePa} from './observation';
import {fixture} from './test-fixture';

describe('fuel-specific mass and source model',()=>{
  it('conserves dry fuel mass, sensible heat and smoke exactly over interval partitions',()=>{
    for(const p of Object.values(COMBUSTION_PROFILES)){
      const end=3600,total=combustionInterval(p,0,end);let mass=0,heat=0,smoke=0;
      for(let t=0;t<end;t+=5){const step=combustionInterval(p,t,t+5);mass+=step.consumedKgM2;heat+=step.heatJm2;smoke+=step.smokeKgM2;}
      expect(mass).toBeCloseTo(total.consumedKgM2,12);expect(heat/total.heatJm2).toBeCloseTo(1,12);expect(smoke).toBeCloseTo(total.smokeKgM2,12);
      expect(mass+combustionAt(p,end).fuelRemainingKgM2).toBeCloseTo(p.fast.massKgM2+p.residual.massKgM2,12);
      expect(combustionInterval(p,-100,-5)).toEqual({consumedKgM2:0,heatJm2:0,smokeKgM2:0});
    }
  });
  it('does not multiply emitted mass when the same area is refined',()=>{
    const source=combustionInterval(COMBUSTION_PROFILES.grass,0,600);
    const coarse=source.smokeKgM2*50**2,fine=4*source.smokeKgM2*25**2;expect(fine).toBe(coarse);
    expect(COMBUSTION_PROFILES['SB-GR2-equivalent-dead'].fast.massKgM2+COMBUSTION_PROFILES['SB-GR2-equivalent-dead'].residual.massKgM2).toBeCloseTo(1.1*TON_ACRE_TO_KG_M2,12);
  });
  it('fades continuously through fuel-specific flaming, residual and char thresholds',()=>{
    for(const p of [COMBUSTION_PROFILES.grass,COMBUSTION_PROFILES.woodland]){
      const intensities=[0,5,30,180,300,900,3600,21600].map(t=>combustionAt(p,t).intensity);
      expect(intensities[0]).toBe(1);intensities.slice(1).forEach((intensity,i)=>expect(intensity).toBeLessThan(intensities[i]));
      expect(combustionAt(p,21600).phase).toBe('burned');
    }
    expect(combustionAt(COMBUSTION_PROFILES.grass,300).phase).toBe('residual');expect(combustionAt(COMBUSTION_PROFILES.woodland,300).phase).toBe('flaming');
    expect(combustionAt(COMBUSTION_PROFILES.woodland,300).heatFluxWm2).toBeGreaterThan(combustionAt(COMBUSTION_PROFILES.grass,300).heatFluxWm2);
  });
  it('drives woodland sensor heat after 180 seconds and aligns render phase with the same source',()=>{
    const {s,e}=fixture(1);s.sensors.forEach(sensor=>sensor.location=cellCenter(e.landscape,0));
    const grass=simulateFrame(s,e,300),forestEnv=structuredClone(e);forestEnv.landscape.cells[0].cover='woodland';const woodland=simulateFrame(s,forestEnv,300);
    expect(grass.combustion?.[0].phase).toBe('residual');expect(grass.burningCells).toEqual([]);expect(grass.burnedCells).toEqual([0]);
    expect(woodland.combustion?.[0].phase).toBe('flaming');expect(woodland.burningCells).toEqual([0]);expect(woodland.burnedCells).toEqual([]);
    expect(woodland.readings[0].values.temperatureC).toBeGreaterThan(grass.readings[0].values.temperatureC!);expect(woodland.readings[0].values.temperatureC).toBeGreaterThan(25);
    expect(woodland.combustion?.[0].heatFluxWm2).toBe(combustionAt(COMBUSTION_PROFILES.woodland,300).heatFluxWm2);
    expect(Object.keys(woodland.readings[1].values)).toEqual(['temperatureC']);expect(Object.keys(woodland.readings[2].values)).toEqual(['humidityPct']);expect(Object.keys(woodland.readings[3].values)).toEqual(['smokePct']);
    const changedLegacy={...s,config:{...s.config,burnDurationSec:1,responseRadiusM:1,temperatureGainC:1000}};expect(simulateFrame(changedLegacy,forestEnv,300)).toEqual(woodland);
  });
  it('does not consume water, built or unknown fuel even with an erroneous burnable flag',()=>{
    for(const cover of ['water','built','unknown'] as const){const {s,e}=fixture(3);e.landscape.cells[4].cover=cover;expect(combustionProfile(e.landscape.cells[4])).toBeNull();expect(()=>computeArrivalTimes(e.landscape,e.weather,s.ignitions)).toThrow('burnable');}
  });
  it('does not restart an extinguished zero-rate edge after later drying or cut off slow coarse travel by flame lifetime',()=>{
    const {s,e}=fixture(3);e.landscape.cells.forEach(cell=>{cell.fuelModel='SB-GR1-equivalent-dead';cell.moisture=.14;});
    e.weather.samples=[{...e.weather.samples[0],humidityPct:90},{...e.weather.samples[0],timeSec:3600,humidityPct:0}];
    expect(computeArrivalTimes(e.landscape,e.weather,s.ignitions,10000)[5]).toBe(Infinity);
    e.landscape.cells.forEach(cell=>{cell.fuelModel='test';cell.spreadRateMps=.0001;});
    const slow=computeArrivalTimes(e.landscape,e.weather,s.ignitions,1000000)[5];expect(Number.isFinite(slow)).toBe(true);expect(slow).toBeGreaterThan(180);
  });
  it('replays fuel phases and measurements exactly and rejects old engine checkpoints',()=>{
    const {s,e}=fixture();const wanted=simulateFrame(s,e,900),checkpoint=createCheckpoint(s,e,300);clearSimulationCache();expect(replayFromCheckpoint(s,e,checkpoint,900)).toEqual(wanted);
    expect(()=>restoreCheckpoint(s,e,{...checkpoint,engineVersion:'surface-grid-1.2.0'})).toThrow('Incompatible');
  });
});

describe('declared humidity response range',()=>{
  it('matches representative liquid-water saturation pressures and the warming RH example',()=>{
    expect(saturationPressurePa(0)).toBeCloseTo(611.2,0);expect(saturationPressurePa(20)).toBeCloseTo(2339,0);expect(saturationPressurePa(100)).toBeCloseTo(101418,0);expect(saturationPressurePa(150)).toBeCloseTo(476159,0);
    expect(humidityAtTemperature(20,60,40)).toBeCloseTo(19,0);expect(saturationPressurePa(-20)).toBeGreaterThan(100);expect(()=>saturationPressurePa(151)).toThrow('range');
  });
  it('flags temperature or humidity results that hit the reduced model range',()=>{
    const {s,e}=fixture(3);e.weather.samples[0].temperatureC=200;const frame=simulateFrame(s,e,5);
    expect(frame.readings[0].quality).toContain('saturated');expect(frame.readings[2].quality).toContain('saturated');expect(frame.readings[3].quality).not.toContain('saturated');
  });
});
