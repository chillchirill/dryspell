import {describe,it,expect} from 'vitest';
import {cellCenter,createSimulationSession} from './index';
import {fixture} from './test-fixture';
import {combustionProfile,combustionAt} from './combustion';
import {OBSERVATION_PARAMETERS,observationGeometry,sourceFieldAt,sourceObservationTargets} from './observation';

describe('nearby fire temperature and humidity response',()=>{
  for(const windSpeedMps of [0,4])it(`warms before contact and recovers after a passing front (${windSpeedMps} m/s)`,()=>{
    const {s,e}=fixture(25),row=12;
    e.landscape.cells.forEach((cell,i)=>{cell.burnable=Math.floor(i/25)===row&&i%25>=2&&i%25<=22;});
    e.weather.samples=[{...e.weather.samples[0],humidityPct:40,windSpeedMps,windFromDeg:270}];
    s.config.durationSec=3600;s.ignitions=[{id:'passing-fire',location:cellCenter(e.landscape,row*25+2),timeSec:0}];
    const sensor=s.sensors[0];s.sensors=[1,2,4,10].map((offset,i)=>({...sensor,id:`distance-${i}`,deviceId:`distance-${i}`,location:cellCenter(e.landscape,(row+offset)*25+12)}));
    const fire=createSimulationSession(s,e),ambient=createSimulationSession({...s,ignitions:[]},e),heat=[0,0,0,0],drying=[0,0,0,0];
    let lastHeat:number[]=[],lastDrying:number[]=[];
    for(let time=0;time<=3600;time+=5){const actual=fire.frameAt(time),base=ambient.frameAt(time);lastHeat=actual.readings.map((r,i)=>r.values.temperatureC!-base.readings[i].values.temperatureC!);lastDrying=actual.readings.map((r,i)=>base.readings[i].values.humidityPct!-r.values.humidityPct!);lastHeat.forEach((v,i)=>heat[i]=Math.max(heat[i],v));lastDrying.forEach((v,i)=>drying[i]=Math.max(drying[i],v));if(time===0)expect(lastHeat).toEqual([0,0,0,0]);}
    expect(heat[0]).toBeGreaterThan(3);expect(heat[1]).toBeGreaterThan(2);expect(heat[2]).toBeGreaterThan(.3);expect(heat[3]).toBe(0);
    expect(heat[0]).toBeGreaterThan(heat[1]);expect(heat[1]).toBeGreaterThan(heat[2]);
    expect(drying[0]).toBeGreaterThan(5);expect(drying[1]).toBeGreaterThan(3);expect(drying[2]).toBeGreaterThan(.5);expect(drying[3]).toBe(0);
    lastHeat.forEach(v=>expect(Math.abs(v)).toBeLessThan(.01));lastDrying.forEach(v=>expect(Math.abs(v)).toBeLessThan(.01));
    const earlier=fire.frameAt(500);fire.frameAt(1000);expect(fire.frameAt(500)).toEqual(earlier);fire.dispose();ambient.dispose();
  });
});

describe('direct burning-cell exposure',()=>{
  for(const windSpeedMps of [0,4])it(`responds strongly when the front crosses the sensor and recovers (${windSpeedMps} m/s)`,()=>{
    const {s,e}=fixture(25),row=12,cell=row*25+12;
    e.landscape.cells.forEach((c,i)=>{c.burnable=Math.floor(i/25)===row&&i%25>=2&&i%25<=22;});
    e.weather.samples=[{...e.weather.samples[0],humidityPct:40,windSpeedMps,windFromDeg:270}];
    s.config.durationSec=3600;s.ignitions=[{id:'crossing',location:cellCenter(e.landscape,row*25+2),timeSec:0}];
    s.sensors=[{...s.sensors[0],location:cellCenter(e.landscape,cell)}];
    const fire=createSimulationSession(s,e),ambient=createSimulationSession({...s,ignitions:[]},e);
    let peak=0,peakTime=0,humidityAtPeak=100,reached=false;
    for(let time=0;time<=3600;time+=5){
      const frame=fire.frameAt(time),reading=frame.readings[0];
      if(reading.values.temperatureC!>peak){peak=reading.values.temperatureC!;peakTime=time;humidityAtPeak=reading.values.humidityPct!;reached=frame.burningCells.includes(cell);}
    }
    expect(peak).toBeGreaterThanOrEqual(70);expect(peak).toBeLessThan(150);expect(reached).toBe(true);expect(humidityAtPeak).toBeLessThan(15);
    const recovered=fire.frameAt(3600).readings[0],base=ambient.frameAt(3600).readings[0];
    expect(recovered.values.temperatureC!).toBeCloseTo(base.values.temperatureC!,2);expect(recovered.values.humidityPct!).toBeCloseTo(base.values.humidityPct!,2);
    const earlier=fire.frameAt(peakTime);fire.frameAt(3600);expect(fire.frameAt(peakTime)).toEqual(earlier);
    fire.dispose();ambient.dispose();
  });

  it('interpolates local heat continuously through cell interiors and edges without changing smoke',()=>{
    const {e}=fixture(5),center=12;e.landscape.cells.forEach((cell,i)=>{cell.burnable=i===center;});
    const profiles=e.landscape.cells.map(combustionProfile),arrival=new Float64Array(25).fill(Infinity);arrival[center]=0;
    const geometry=observationGeometry(e.landscape),field=sourceFieldAt(profiles,arrival,60),origin=cellCenter(e.landscape,center),p=OBSERVATION_PARAMETERS;
    const q=combustionAt(profiles[center]!,60).heatFluxWm2,variance=625/12+2*p.heatDiffusionM2Sec*p.heatResidenceSec;
    for(const [x,y] of [[0,0],[.25,0],[.5,0],[.5,.5],[1,0]]){
      const dx=x*geometry.dx,dy=y*geometry.dy,location={longitude:origin.longitude+dx/geometry.longitudeScale,latitude:origin.latitude+dy/geometry.metresPerDegree};
      const target=sourceObservationTargets(e.landscape,geometry,profiles,arrival,field,location,e.weather.samples[0],{east:0,north:0});
      const diffuse=p.heatGroundFraction*q*625*p.heatResidenceSec/(p.airDensityKgM3*p.airHeatCapacityJkgK*p.heatLayerM*2*Math.PI*variance)*Math.exp(-(dx*dx+dy*dy)/(2*variance));
      const contact=q*p.contactHeatFraction*p.contactHeatResidenceSec/(p.airDensityKgM3*p.airHeatCapacityJkgK*p.contactHeatLayerM)*(1-x)*(1-y);
      expect(target.temperatureC).toBeCloseTo(25+diffuse+contact,5);
      const noHeat=sourceObservationTargets(e.landscape,geometry,profiles,arrival,{...field,heat:new Float64Array(25)},location,e.weather.samples[0],{east:0,north:0});
      expect(target.smokePct).toBe(noHeat.smokePct);expect(noHeat.temperatureC).toBe(25);
    }
    // Shared boundary has half of each source, rather than two full local sources.
    e.landscape.cells[center+1].burnable=true;profiles[center+1]=combustionProfile(e.landscape.cells[center+1]);arrival[center+1]=0;
    const pair=sourceFieldAt(profiles,arrival,60),boundary={...origin,longitude:origin.longitude+.5*geometry.dx/geometry.longitudeScale};
    const at=(offset:number)=>sourceObservationTargets(e.landscape,geometry,profiles,arrival,pair,{...boundary,longitude:boundary.longitude+offset/geometry.longitudeScale},e.weather.samples[0],{east:0,north:0});
    expect(at(-.0001).temperatureC).toBeCloseTo(at(.0001).temperatureC,5);
  });

  it('bounds hot woodland targets and preserves saturated quality through the sensor response',()=>{
    const {s,e}=fixture(1);e.landscape.cells[0].cover='woodland';s.sensors.forEach(sensor=>{sensor.location=cellCenter(e.landscape,0);});
    const profiles=e.landscape.cells.map(combustionProfile),arrival=new Float64Array([0]),field=sourceFieldAt(profiles,arrival,5);
    const target=sourceObservationTargets(e.landscape,observationGeometry(e.landscape),profiles,arrival,field,s.sensors[0].location,e.weather.samples[0],{east:0,north:0});
    expect(target.temperatureC).toBe(150);expect(target.temperatureLimited).toBe(true);
    const session=createSimulationSession(s,e),frame=session.frameAt(5);
    expect(frame.readings[0].quality).toContain('saturated');expect(frame.readings[2].quality).toContain('saturated');expect(frame.readings[3].quality).not.toContain('saturated');session.dispose();
  });
});
