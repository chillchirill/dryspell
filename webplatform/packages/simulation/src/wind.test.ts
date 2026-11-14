import {describe,it,expect} from 'vitest';
import {cellCenter,computeArrivalTimes,edgeRate,windVector,weatherAt} from './index';
import {fixture} from './test-fixture';

const directions=[{from:0,dx:0,dy:-1},{from:45,dx:-1,dy:-1},{from:90,dx:-1,dy:0},{from:135,dx:-1,dy:1},{from:180,dx:0,dy:1},{from:225,dx:1,dy:1},{from:270,dx:1,dy:0},{from:315,dx:1,dy:-1}];
describe('meteorological wind and geographic propagation',()=>{
  it('retains configured direction throughout calm manual weather and replay sampling',()=>{
    const {e}=fixture(5);
    for(const from of [0,45,90,135,180,225,270,315]){
      e.weather.samples=[0,3600].map(timeSec=>({...e.weather.samples[0],timeSec,windFromDeg:from,windSpeedMps:0}));
      for(const t of [0,5,180,1800,3600]){expect(weatherAt(e.weather,t).windSpeedMps).toBe(0);expect(weatherAt(e.weather,t).windFromDeg).toBe(from);}
    }
  });
  for(const {from,dx,dy} of directions)it(`spreads downwind from ${from} degrees on north-increasing rows`,()=>{
    const {s,e}=fixture(21),g=e.landscape,c=220,down=c+4*dx+4*dy*g.width,up=c-4*dx-4*dy*g.width;
    const vector=windVector(5,from);expect(vector.east).toBeCloseTo(dx*5/(dx&&dy?Math.SQRT2:1));expect(vector.north).toBeCloseTo(dy*5/(dx&&dy?Math.SQRT2:1));
    expect(Math.sign(cellCenter(g,down).latitude-cellCenter(g,c).latitude)).toBe(dy);expect(Math.sign(cellCenter(g,down).longitude-cellCenter(g,c).longitude)).toBe(dx);
    e.weather.samples[0].windFromDeg=from;e.weather.samples[0].windSpeedMps=5;
    const single=computeArrivalTimes(g,e.weather,s.ignitions,21600);
    expect(single[down]).toBeLessThan(single[up]);
    // Identical snapshots use the optimized multi-sample solver, exposing convention mismatches.
    e.weather.samples.push({...e.weather.samples[0],timeSec:21600});
    const multi=computeArrivalTimes(g,e.weather,s.ignitions,21600);
    expect(multi[down]).toBeCloseTo(single[down],7);expect(multi[up]).toBeCloseTo(single[up],7);
  });
  it('increases headwind-aligned spread monotonically, reduces backing spread, bounds extreme speed',()=>{
    const {e}=fixture(5),g=e.landscape,w={...e.weather.samples[0],windFromDeg:270},centre=12;
    const rows=[0,1,5,10,20,40,1000].map(windSpeedMps=>({down:edgeRate(g,centre,centre+1,{...w,windSpeedMps}),up:edgeRate(g,centre,centre-1,{...w,windSpeedMps}),cross:edgeRate(g,centre,centre+5,{...w,windSpeedMps})}));
    rows.forEach((row,i)=>{expect(row.down).toBeLessThanOrEqual(8);expect(row.up).toBeGreaterThanOrEqual(0);expect(row.cross).toBeCloseTo(rows[0].cross,10);if(i){expect(row.down).toBeGreaterThanOrEqual(rows[i-1].down);expect(row.up).toBeLessThanOrEqual(rows[i-1].up);}});
    expect(rows[2].down/rows[0].down).toBeCloseTo(1.7,10);expect(rows.at(-1)?.down).toBe(8);for(const [i,speed] of [0,1,5,10,20,40,1000].entries()){expect(rows[i].down).toBeCloseTo(Math.min(8,rows[0].down*(1+.14*speed)),10);expect(rows[i].up).toBeCloseTo(rows[0].up/(1+.14*speed),10);}
  });
  it('turns opposing interpolated winds through calm and respects water despite strong downwind flow',()=>{
    const {e,s}=fixture(11);e.weather.samples=[{...e.weather.samples[0],windFromDeg:270,windSpeedMps:20},{...e.weather.samples[0],timeSec:100,windFromDeg:90,windSpeedMps:20}];
    expect(weatherAt(e.weather,50).windSpeedMps).toBeLessThan(1e-12);
    for(let y=0;y<11;y++){const c=e.landscape.cells[y*11+6];c.cover='water';c.burnable=false;}
    const arrival=computeArrivalTimes(e.landscape,e.weather,s.ignitions,21600);expect(arrival[62]).toBe(Infinity);
  });
});
