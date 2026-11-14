import { sha256Hex,sha256Uint32LE } from './hash';
import { SENSOR_PROFILES, type Coordinate, type EnvironmentSnapshot, type LandscapeSnapshot, type Scenario, type SimulationFrame, type SimulationCheckpoint, type WeatherSample, type WeatherSnapshot, type ValidatedObservation, type Channel } from '@dryspell/contracts';

import { PUBLISHED_FUELS, equivalentDeadSpreadMps } from './fuels';
export { PUBLISHED_FUELS, equivalentDeadSpreadMps } from './fuels';
export const ENGINE_VERSION = 'surface-grid-1.2.0';
const RAD = Math.PI / 180;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
export const checksum = (x: unknown) => sha256Hex(JSON.stringify(x));
/** Linear head-fire response to along-edge mid-flame wind; reciprocal backing damping. */
export function windMultiplier(alongWindMps:number,canopy:number){const influence=.35*canopy*alongWindMps;return influence>=0?1+influence:1/(1-influence);}
export function windVector(speed: number, from: number) { return { east: -speed * Math.sin(from * RAD), north: -speed * Math.cos(from * RAD) }; }
export function weatherAt(snapshot: WeatherSnapshot, t: number): WeatherSample {
  const samples = snapshot.samples;
  if (!samples.length) throw new Error('Weather snapshot has no samples');
  const hi = samples.findIndex(s => s.timeSec >= t);
  if (hi <= 0) return { ...samples[hi < 0 ? samples.length - 1 : 0], timeSec: t };
  const a = samples[hi - 1], b = samples[hi], q = (t - a.timeSec) / (b.timeSec - a.timeSec);
  const lerp = (x: number, y: number) => x + q * (y - x);
  const va = windVector(a.windSpeedMps, a.windFromDeg), vb = windVector(b.windSpeedMps, b.windFromDeg);
  const east = lerp(va.east, vb.east), north = lerp(va.north, vb.north);
  return { timeSec: t, temperatureC: lerp(a.temperatureC,b.temperatureC), humidityPct: lerp(a.humidityPct,b.humidityPct), precipitationMm: lerp(a.precipitationMm,b.precipitationMm), windSpeedMps: Math.hypot(east,north), windFromDeg: (Math.atan2(-east,-north)/RAD + 360)%360 };
}
function wrappedSpan(west: number, east: number) { return (east - west + 360) % 360 || 360; }
export function cellIndexAt(grid: LandscapeSnapshot, location: Coordinate): number {
  const dx = (location.longitude - grid.bounds.west + 360) % 360;
  const x = Math.floor(dx / wrappedSpan(grid.bounds.west,grid.bounds.east) * grid.width);
  const y = Math.floor((location.latitude-grid.bounds.south)/(grid.bounds.north-grid.bounds.south)*grid.height);
  return x < 0 || x >= grid.width || y < 0 || y >= grid.height ? -1 : y * grid.width+x;
}
export function cellCenter(grid: LandscapeSnapshot, index: number): Coordinate {
  return { longitude: ((grid.bounds.west+(index%grid.width+.5)/grid.width*wrappedSpan(grid.bounds.west,grid.bounds.east)+540)%360)-180,
    latitude:grid.bounds.south+(Math.floor(index/grid.width)+.5)/grid.height*(grid.bounds.north-grid.bounds.south) };
}
export function distanceM(a: Coordinate,b: Coordinate) {
  const dlon = ((b.longitude-a.longitude+540)%360)-180;
  return Math.hypot(dlon*RAD*6371008.8*Math.cos((a.latitude+b.latitude)*RAD/2),(b.latitude-a.latitude)*RAD*6371008.8);
}
class Heap {
  a: [number,number][]=[];
  push(v:[number,number]) { let i=this.a.length; this.a.push(v); while(i>0){ const p=(i-1)>>1; if(this.a[p][0]<=v[0])break; this.a[i]=this.a[p];i=p;} this.a[i]=v; }
  pop() { const root=this.a[0],last=this.a.pop()!; if(this.a.length){let i=0;while(i*2+1<this.a.length){let c=i*2+1;if(c+1<this.a.length&&this.a[c+1][0]<this.a[c][0])c++;if(this.a[c][0]>=last[0])break;this.a[i]=this.a[c];i=c;}this.a[i]=last;} return root; }
}
/** Empirical, dimensionally explicit baseline, not a full Rothermel implementation. */
export function edgeRate(grid: LandscapeSnapshot, from: number, to: number, weather: WeatherSample): number {
  const a=grid.cells[from],b=grid.cells[to];
  if(!a?.burnable||!b?.burnable||a.cover==='unknown'||b.cover==='unknown')return 0;
  const dx=(to%grid.width)-(from%grid.width),dy=Math.floor(to/grid.width)-Math.floor(from/grid.width),len=Math.hypot(dx,dy);
  const vector=windVector(weather.windSpeedMps,weather.windFromDeg);
  // Explicit canopy adjustment from 10 m wind to an illustrative mid-flame wind.
  const canopy=a.cover==='woodland'?.25:.4;
  const wind=windMultiplier((vector.east*dx+vector.north*dy)/len,canopy);
  const slope=a.elevationM===null||b.elevationM===null?0:(b.elevationM-a.elevationM)/(len*grid.cellSizeM);
  const slopeFactor=Math.exp(clamp(3*slope,-1.5,1.5));
  const moisture=clamp((a.moisture+b.moisture)/2+weather.humidityPct/350+weather.precipitationMm*.05-(weather.temperatureC-20)*.002,0,.95);
  const rate=(cell:typeof a)=>{const published=PUBLISHED_FUELS[cell.fuelModel];return published?equivalentDeadSpreadMps(published,clamp(cell.moisture+(weather.humidityPct-30)/1000+weather.precipitationMm*.03-(weather.temperatureC-20)*.001,0,1)):Math.max(0,cell.spreadRateMps)*(1-moisture);};
  let fuel=Math.sqrt(rate(a)*rate(b));
  if(Math.abs(dx)+Math.abs(dy)===3){const x=from%grid.width,y=Math.floor(from/grid.width),sx=Math.sign(dx),sy=Math.sign(dy);const indices=Math.abs(dx)===2?[from,y*grid.width+x+sx,(y+sy)*grid.width+x+sx,to]:[from,(y+sy)*grid.width+x,(y+sy)*grid.width+x+sx,to];const rates=indices.map(i=>rate(grid.cells[i]));fuel=rates.some(r=>r<=0)?0:rates.length/rates.reduce((sum,r)=>sum+1/r,0);}
  return clamp(fuel*wind*slopeFactor,0,8);
}
/** Time-dependent FIFO edge travel integration; fixed maximum 5 s steps independent of rendering. */
function constantTailStart(weather:WeatherSnapshot):number {
  let tail=0;
  for(let i=1;i<weather.samples.length;i++){const a=weather.samples[i-1],b=weather.samples[i];if(a.temperatureC!==b.temperatureC||a.humidityPct!==b.humidityPct||a.precipitationMm!==b.precipitationMm||a.windSpeedMps!==b.windSpeedMps||a.windFromDeg!==b.windFromDeg)tail=b.timeSec;}
  return tail;
}
function travelTime(grid: LandscapeSnapshot,weather: WeatherSnapshot,from:number,to:number,start:number,horizon:number,dt:number) {
  let remaining=grid.cellSizeM*Math.hypot((to%grid.width)-(from%grid.width),Math.floor(to/grid.width)-Math.floor(from/grid.width)),t=start;
  if(weather.samples.length===1){const rate=edgeRate(grid,from,to,weather.samples[0]);const end=start+remaining/rate;return rate>0&&end<=horizon?end:Infinity;}
  const tail=Math.max(21600,constantTailStart(weather));
  while(remaining>1e-8&&t<horizon){ const step=Math.min(dt,horizon-t);const rate=edgeRate(grid,from,to,weatherAt(weather,t+step/2));if(rate<=0)return Infinity;
    if(t>=tail){const end=t+remaining/rate;return end<=horizon?end:Infinity;}
    if(rate*step>=remaining)return t+remaining/rate; remaining-=rate*step;t+=step; }
  return Infinity;
}
interface RateIntegral { times:Float64Array; rates:Float64Array; cumulative:Float64Array; }
function lowerBound(values:Float64Array,value:number){let lo=0,hi=values.length;while(lo<hi){const mid=(lo+hi)>>>1;if(values[mid]<value)lo=mid+1;else hi=mid;}return lo;}
/** Reusable time-dependent directional rate integrals. Spatial edges are still traversed individually. */
function createTravelSolver(grid:LandscapeSnapshot,weather:WeatherSnapshot,horizon:number,dt:number){
  // Six-hour numerical chunks retain the previous grid for existing horizons. Neither
  // the number of chunks nor the constant tail is allocated up front.
  const chunkSec=21600,numericalEnd=Math.min(horizon,Math.max(chunkSec,constantTailStart(weather)));
  const conditionAt=(t:number)=>{const w=weatherAt(weather,t),v=windVector(w.windSpeedMps,w.windFromDeg);return {east:v.east,north:v.north,moisture:w.humidityPct/350+w.precipitationMm*.05-(w.temperatureC-20)*.002};};
  const windows=new Map<number,{times:Float64Array;conditions:ReturnType<typeof conditionAt>[]} >();
  const windowAt=(start:number)=>{
    const chunkStart=Math.floor(start/chunkSec)*chunkSec;let window=windows.get(chunkStart);
    if(!window){const end=Math.min(chunkStart+chunkSec,numericalEnd),points=new Set([chunkStart,end,...weather.samples.map(w=>w.timeSec).filter(t=>t>chunkStart&&t<end)]);
      for(let t=Math.ceil(chunkStart/dt)*dt;t<end;t+=dt)points.add(t);
      const times=Float64Array.from([...points].sort((a,b)=>a-b));window={times,conditions:Array.from(times,conditionAt)};windows.set(chunkStart,window);if(windows.size>4)windows.delete(windows.keys().next().value!);
    }return {chunkStart,...window};
  };
  const tables=new Map<string,RateIntegral>();
  const maxWindSpeed=Math.max(...weather.samples.map(w=>w.windSpeedMps));
  const cumulativeAt=(table:RateIntegral,t:number)=>{const times=table.times;if(t<=times[0])return 0;const upper=lowerBound(times,t);if(upper>=times.length)return table.cumulative.at(-1)!;if(times[upper]===t)return table.cumulative[upper];const i=upper-1,span=times[upper]-times[i],x=t-times[i];return table.cumulative[i]+table.rates[i]*x+(table.rates[upper]-table.rates[i])*x*x/(2*span);};
  return (from:number,to:number,start:number)=>{
    const a=grid.cells[from],b=grid.cells[to],x=from%grid.width,y=Math.floor(from/grid.width),dx=to%grid.width-x,dy=Math.floor(to/grid.width)-y,len=Math.hypot(dx,dy),sx=Math.sign(dx),sy=Math.sign(dy);
    const indices=Math.abs(dx)+Math.abs(dy)===3?(Math.abs(dx)===2?[from,y*grid.width+x+sx,(y+sy)*grid.width+x+sx,to]:[from,(y+sy)*grid.width+x,(y+sy)*grid.width+x+sx,to]):[from,to];
    // Published nonlinear fuel kernels retain the fine-step reference integration.
    if(indices.some(i=>PUBLISHED_FUELS[grid.cells[i].fuelModel]))return travelTime(grid,weather,from,to,start,horizon,dt);
    const fuels=indices.map(i=>Math.max(0,grid.cells[i].spreadRateMps));if(fuels.some(f=>f<=0))return Infinity;
    const fuel=indices.length===2?Math.sqrt(fuels[0]*fuels[1]):fuels.length/fuels.reduce((sum,f)=>sum+1/f,0);
    const slope=a.elevationM===null||b.elevationM===null?0:(b.elevationM-a.elevationM)/(len*grid.cellSizeM),base=fuel*Math.exp(clamp(3*slope,-1.5,1.5));
    const canopy=a.cover==='woodland'?.25:.4,moisture=(a.moisture+b.moisture)/2,cap=base*(1+.35*canopy*maxWindSpeed)>8?8/base:Infinity,key=`${dx}:${dy}:${canopy}:${moisture}:${cap}`;
    const normalizedRate=(c:ReturnType<typeof conditionAt>)=>Math.min(cap,windMultiplier((c.east*dx+c.north*dy)/len,canopy)*(1-clamp(moisture+c.moisture,0,.95)));
    let remainingDistance=grid.cellSizeM*len/base,t=start;
    while(t<horizon){
      if(t>=numericalEnd){const rate=normalizedRate(conditionAt(numericalEnd)),end=t+remainingDistance/rate;return rate>0&&end<=horizon?end:Infinity;}
      const {chunkStart,times,conditions}=windowAt(t),tableKey=`${chunkStart}:${key}`;let table=tables.get(tableKey);
      if(!table){
        // Preserve the <=6 h solver's heterogeneous-shape fallback. For longer runs
        // eviction bounds retained tables instead of growing with the declared horizon.
        if(tables.size>=128&&horizon<=chunkSec)return travelTime(grid,weather,from,to,start,horizon,dt);
        const rates=Float64Array.from(conditions,normalizedRate),cumulative=new Float64Array(times.length);
        for(let i=1;i<times.length;i++)cumulative[i]=cumulative[i-1]+(rates[i-1]+rates[i])*.5*(times[i]-times[i-1]);
        table={times,rates,cumulative};tables.set(tableKey,table);if(tables.size>128)tables.delete(tables.keys().next().value!);
      }
      const current=cumulativeAt(table,t),target=current+remainingDistance;
      if(target>table.cumulative.at(-1)!){remainingDistance-=table.cumulative.at(-1)!-current;t=times.at(-1)!;continue;}
      const upper=lowerBound(table.cumulative,target);if(upper===0)return times[0];const i=upper-1,remaining=target-table.cumulative[i],span=times[upper]-times[i],rate=table.rates[i],gradient=(table.rates[upper]-rate)/span;
      const duration=Math.abs(gradient)<1e-14?remaining/rate:2*remaining/(rate+Math.sqrt(Math.max(0,rate*rate+2*gradient*remaining)));
      return Math.min(horizon,times[i]+clamp(duration,0,span));
    }return Infinity;
  };
}
export function computeArrivalTimes(grid: LandscapeSnapshot, weather: WeatherSnapshot, ignitions: {location:Coordinate;timeSec:number}[], horizon=21600, integrationStepSec=5, _burnDurationSec=180, referenceIntegration=false): Float64Array {
  if(grid.cells.length!==grid.width*grid.height)throw new Error('Landscape dimensions do not match cells');
  if(!Number.isFinite(integrationStepSec)||integrationStepSec<=0)throw new Error('Invalid numerical step');
  const solve=weather.samples.length>1&&!referenceIntegration?createTravelSolver(grid,weather,horizon,integrationStepSec):(from:number,to:number,start:number)=>travelTime(grid,weather,from,to,start,horizon,integrationStepSec);
  const arrival=new Float64Array(grid.cells.length).fill(Infinity),heap=new Heap();
  for(const ignition of ignitions){ const i=cellIndexAt(grid,ignition.location); if(i<0)throw new Error('Ignition outside prepared area');if(!grid.cells[i].burnable||grid.cells[i].cover==='unknown')throw new Error('Ignition requires known burnable terrain');if(ignition.timeSec<arrival[i]){arrival[i]=ignition.timeSec;heap.push([ignition.timeSec,i]);}}
  while(heap.a.length){const [time,i]=heap.pop();if(time!==arrival[i]||time>horizon)continue;const x=i%grid.width,y=Math.floor(i/grid.width);
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){if((!dx&&!dy)||Math.max(Math.abs(dx),Math.abs(dy))===2&&Math.abs(dx)+Math.abs(dy)!==3)continue;const xx=x+dx,yy=y+dy;if(xx<0||xx>=grid.width||yy<0||yy>=grid.height)continue;const j=yy*grid.width+xx;
      if(!grid.cells[j].burnable||grid.cells[j].cover==='unknown')continue;
      if(Math.abs(dx)===1&&Math.abs(dy)===1&&(!grid.cells[y*grid.width+xx].burnable||!grid.cells[yy*grid.width+x].burnable||grid.cells[y*grid.width+xx].cover==='unknown'||grid.cells[yy*grid.width+x].cover==='unknown'))continue;
      if(Math.abs(dx)+Math.abs(dy)===3){const sx=Math.sign(dx),sy=Math.sign(dy),middle=Math.abs(dx)===2?[y*grid.width+x+sx,(y+sy)*grid.width+x+sx]:[(y+sy)*grid.width+x,(y+sy)*grid.width+x+sx];if(middle.some(k=>!grid.cells[k].burnable||grid.cells[k].cover==='unknown'))continue;}
      if(arrival[j]<=time)continue; const next=solve(i,j,time);if(next<arrival[j]){arrival[j]=next;heap.push([next,j]);}
    }
  }return arrival;
}
function random(seed:number,id:string,t:number,channel:string){return sha256Uint32LE(`${seed}:${id}:${t}:${channel}`)/4294967296*2-1;}
interface SensorState { temperatureC:number; humidityPct:number; smokePct:number; noise:Record<Channel,number>; }
interface EngineState { timeSec:number; sensors:Record<string,SensorState>; }
interface Cache { arrival:Float64Array; checkpoints:Map<number,EngineState>; last:EngineState; }
export const MAX_SENSOR_CHECKPOINTS=512;
function saveSensorCheckpoint(cache:Cache,state:EngineState){
  cache.checkpoints.set(state.timeSec,structuredClone(state));
  if(cache.checkpoints.size>MAX_SENSOR_CHECKPOINTS){for(const time of cache.checkpoints.keys()){if(time!==0){cache.checkpoints.delete(time);break;}}}
}
function nearestState(cache:Cache,target:number):EngineState {
  let state=cache.last.timeSec<=target?cache.last:cache.checkpoints.get(0)!;
  for(const [time,checkpoint] of cache.checkpoints){if(time<=target&&time>state.timeSec)state=checkpoint;}
  return state;
}
const caches=new Map<string,Cache>();
function keyFor(s:Scenario,e:EnvironmentSnapshot){return checksum({engine:ENGINE_VERSION,id:s.id,revision:s.revision,seed:s.seed,start:s.startTime,config:s.config,sensors:s.sensors,ignitions:s.ignitions,environment:e});}
function initialState(s:Scenario,e:EnvironmentSnapshot):EngineState {const w=weatherAt(e.weather,0);return {timeSec:0,sensors:Object.fromEntries(s.sensors.map(sensor=>[sensor.id,{temperatureC:w.temperatureC,humidityPct:w.humidityPct,smokePct:0,noise:{temperatureC:0,humidityPct:0,smokePct:0}}]))};}
function prepareCache(s:Scenario,e:EnvironmentSnapshot):Cache {
  if(s.environmentId!==e.id)throw new Error('Scenario/environment snapshot mismatch');
  if(e.status!=='ready'&&e.status!=='partial')throw new Error('Environment is not prepared');
  const cache={arrival:computeArrivalTimes(e.landscape,e.weather,s.ignitions,s.config.durationSec,5,s.config.burnDurationSec),checkpoints:new Map<number,EngineState>(),last:initialState(s,e)};
  cache.checkpoints.set(0,structuredClone(cache.last));return cache;
}
function getCache(s:Scenario,e:EnvironmentSnapshot){if(s.environmentId!==e.id)throw new Error('Scenario/environment snapshot mismatch');const key=keyFor(s,e);let cache=caches.get(key);if(!cache){cache=prepareCache(s,e);caches.set(key,cache);if(caches.size>4)caches.delete(caches.keys().next().value!);}return cache;}
export function clearSimulationCache(){caches.clear();}
function responseTargets(s:Scenario,e:EnvironmentSnapshot,arrival:Float64Array,location:Coordinate,t:number,candidates:number[]) {
  const w=weatherAt(e.weather,t),grid=e.landscape,v=windVector(w.windSpeedMps,w.windFromDeg),speed=Math.hypot(v.east,v.north);
  let nearest=Infinity,smoke=0;
  for(const i of candidates){const age=t-arrival[i];const c=cellCenter(grid,i);const dx=(((location.longitude-c.longitude+540)%360)-180)*RAD*6371008.8*Math.cos(location.latitude*RAD),dy=(location.latitude-c.latitude)*RAD*6371008.8;
    const distance=Math.hypot(dx,dy);if(age<=s.config.burnDurationSec)nearest=Math.min(nearest,Math.max(0,distance-grid.cellSizeM*.5));
    // Bounded wind-advected Gaussian puff approximation with diffusion and finite transport delay.
    if(speed>.1){const along=(dx*v.east+dy*v.north)/speed,cross=Math.abs(dx*v.north-dy*v.east)/speed;const transport=along/speed;
      if(along>0&&age>=transport&&age-transport<=s.config.burnDurationSec){const sigma=12+Math.sqrt(Math.max(0,transport))*3;smoke+=12*Math.exp(-cross*cross/(2*sigma*sigma))*Math.exp(-transport/180);}}
  }
  const q=Math.max(0,1-nearest/s.config.responseRadiusM)**2;
  const temperature=w.temperatureC+s.config.temperatureGainC*q;
  // Constant vapour pressure approximation using saturation vapour pressure ratio.
  const saturation=(temp:number)=>Math.exp(17.625*temp/(243.04+temp));
  return {temperatureC:temperature,humidityPct:clamp(w.humidityPct*saturation(w.temperatureC)/saturation(temperature),0,100),smokePct:clamp(smoke+75*q,0,100)};
}
function advance(s:Scenario,e:EnvironmentSnapshot,cache:Cache,target:number):EngineState {
  const state=structuredClone(nearestState(cache,target));
  const dt=5; // fixed response integration clock; output/render speed never modifies it
  for(let time=state.timeSec+dt;time<=target;time+=dt){const candidates:number[]=[];cache.arrival.forEach((a,i)=>{if(a<=time&&time-a<=s.config.burnDurationSec+180)candidates.push(i);});for(const sensor of s.sensors){if(!sensor.enabled||sensor.archived)continue;const st=state.sensors[sensor.id];const profile=SENSOR_PROFILES[sensor.profileId],targets=responseTargets(s,e,cache.arrival,sensor.location,time,candidates);const alpha=1-Math.exp(-dt/profile.responseTimeSec);
      for(const channel of ['temperatureC','humidityPct','smokePct'] as const){st.noise[channel]=.82*st.noise[channel]+.18*random(s.seed,sensor.id,time,channel)*(profile.noise[channel]??0);st[channel]+=alpha*(targets[channel]-st[channel]);}}
    state.timeSec=time;if(time%s.config.checkpointIntervalSec===0)saveSensorCheckpoint(cache,state);}
  cache.last=structuredClone(state);return state;
}
/** Source-time fault windows determine receipt. This implicit immutable queue survives seeks/restarts. */
export function deliverySampleTimes(sensor:Scenario['sensors'][number],deliveryTimeSec:number):number[]{
  const faults=sensor.simulationFaults??[];
  // The maximum active delay must be one of the configured delays; enumerate only those candidates.
  const delays=new Set([0,...faults.filter(f=>f.type==='delay').map(f=>Math.max(0,f.delaySec??0))]);
  const candidates=new Set([...delays].map(delay=>deliveryTimeSec-Math.ceil(delay/5)*5).filter(time=>time>=0));
  return [...candidates].filter(sampleTime=>{
    const delay=Math.max(0,...faults.filter(f=>f.type==='delay'&&sampleTime>=f.startTimeSec&&sampleTime<f.endTimeSec).map(f=>f.delaySec??0));
    return sampleTime+Math.ceil(delay/5)*5===deliveryTimeSec;
  }).sort((a,b)=>b-a);
}
function frameFromState(s:Scenario,e:EnvironmentSnapshot,cache:Cache,state:EngineState,observedStates?:Map<number,EngineState>):SimulationFrame {
  const timeSec=state.timeSec,timestamp=new Date(Date.parse(s.startTime)+timeSec*1000).toISOString(),burningCells:number[]=[],burnedCells:number[]=[];
  cache.arrival.forEach((a,i)=>{if(a<=timeSec)(timeSec-a<=s.config.burnDurationSec?burningCells:burnedCells).push(i);});
  const readings:ValidatedObservation[]=s.sensors.filter(x=>x.enabled&&!x.archived).flatMap(sensor=>deliverySampleTimes(sensor,timeSec).map(observedSec=>{
    const active=(sensor.simulationFaults??[]).filter(f=>observedSec>=f.startTimeSec&&observedSec<f.endTimeSec);
    const delay=timeSec-observedSec;
    const observedState=delay?(observedStates?.get(observedSec)??advance(s,e,cache,observedSec)):state;
    const st=observedState.sensors[sensor.id],values:Partial<Record<Channel,number>>={};const quality:ValidatedObservation['quality']=delay?['late']:[];
    for(const ch of sensor.capabilities){
      const channelFaults=active.filter(f=>!f.channels||f.channels.includes(ch));
      if(channelFaults.some(f=>f.type==='dropout')){quality.push('missing');continue;}
      const bias=(sensor.calibration?.[ch]??random(s.seed,sensor.id,0,`bias-${ch}`)*(SENSOR_PROFILES[sensor.profileId].noise[ch]??0)*.3);
      let raw=st[ch]+st.noise[ch]+bias;
      for(const fault of channelFaults){if(fault.type==='stuck'){raw=fault.value??0;quality.push('fault');}if(fault.type==='spike'){raw+=fault.value??50;quality.push('fault');}if(fault.type==='smoke-without-fire'&&ch==='smokePct')raw=fault.value??70;}
      const value=ch==='temperatureC'?raw:clamp(raw,0,100);if(ch!=='temperatureC'&&raw!==value)quality.push('saturated');values[ch]=Math.round(value*1000)/1000;
    }
    const recordedAt=new Date(Date.parse(s.startTime)+observedSec*1000).toISOString();
    return {id:`${s.id}:${s.revision}:${sensor.id}:${observedSec}`,sensorId:sensor.id,source:'simulated',scenarioId:s.id,revision:s.revision,recordedAt,receivedAt:timestamp,simulationTimeSec:observedSec,location:sensor.location,locationVersion:sensor.locationVersion??1,values,quality:[...new Set(quality)]};}));
  // Historical reads made for delayed devices must not move the authoritative integrator state.
  cache.last=structuredClone(state);
  const frame={scenarioId:s.id,revision:s.revision,environmentId:e.id,timeSec,timestamp,engineVersion:ENGINE_VERSION,burningCells,burnedCells,readings,weather:weatherAt(e.weather,timeSec),checksum:''};frame.checksum=checksum(frame);return frame;
}
export function simulateFrame(scenario:Scenario,environment:EnvironmentSnapshot,requestedTimeSec:number):SimulationFrame {
  if(!Number.isFinite(requestedTimeSec)||requestedTimeSec<0)throw new Error('Invalid simulation time');
  const target=Math.floor(Math.min(requestedTimeSec,scenario.config.durationSec)/5)*5,cache=getCache(scenario,environment);
  return frameFromState(scenario,environment,cache,advance(scenario,environment,cache,target));
}
export interface SimulationSession {
  readonly timeSec:number;
  readonly checkpointCount:number;
  frameAt(timeSec:number):SimulationFrame;
  /** Integrates at most maxSteps fixed ticks; undefined means call again after yielding. */
  prepareFrame(timeSec:number,maxSteps?:number):SimulationFrame|undefined;
  dispose():void;
}
function freezeInput<T>(value:T):T {
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freezeInput(child);}
  return value;
}
/** Isolated immutable inputs avoid serializing the complete terrain on every browser tick. */
export function createSimulationSession(scenario:Scenario,environment:EnvironmentSnapshot):SimulationSession {
  const s=freezeInput(structuredClone(scenario)),e=freezeInput(structuredClone(environment));
  let cache:Cache|undefined=prepareCache(s,e);
  let pending:{target:number;times:number[];states:Map<number,EngineState>}|undefined;
  const targetAt=(requestedTimeSec:number)=>{if(!cache)throw new Error('Simulation session is disposed');if(!Number.isFinite(requestedTimeSec)||requestedTimeSec<0)throw new Error('Invalid simulation time');return Math.floor(Math.min(requestedTimeSec,s.config.durationSec)/5)*5;};
  return {
    get timeSec(){return cache?.last.timeSec??0;},
    get checkpointCount(){return cache?.checkpoints.size??0;},
    frameAt(requestedTimeSec:number){
      const target=targetAt(requestedTimeSec);pending=undefined;
      return frameFromState(s,e,cache!,advance(s,e,cache!,target));
    },
    prepareFrame(requestedTimeSec:number,maxSteps=12){
      const target=targetAt(requestedTimeSec);if(!Number.isSafeInteger(maxSteps)||maxSteps<1)throw new Error('Invalid preparation step budget');
      if(pending?.target!==target){const times=new Set([target]);for(const sensor of s.sensors.filter(sensor=>sensor.enabled&&!sensor.archived)){for(const time of deliverySampleTimes(sensor,target))times.add(time);}pending={target,times:[...times].sort((a,b)=>a-b),states:new Map()};}
      let budget=maxSteps;
      for(const time of pending.times){
        if(pending.states.has(time))continue;
        const start=nearestState(cache!,time).timeSec,until=Math.min(time,start+budget*5),state=advance(s,e,cache!,until);budget-=(until-start)/5;
        if(until<time)return undefined;
        pending.states.set(time,state);if(budget===0&&pending.states.size<pending.times.length)return undefined;
      }
      const frame=frameFromState(s,e,cache!,pending.states.get(target)!,pending.states);pending=undefined;return frame;
    },
    dispose(){cache?.checkpoints.clear();cache=undefined;pending=undefined;},
  };
}
export function createCheckpoint(scenario:Scenario,environment:EnvironmentSnapshot,timeSec:number):SimulationCheckpoint {
  const cache=getCache(scenario,environment),state=advance(scenario,environment,cache,Math.floor(timeSec/5)*5);
  const payload={inputHash:keyFor(scenario,environment),arrival:Array.from(cache.arrival,a=>Number.isFinite(a)?a:null),sensorState:state};
  return {scenarioId:scenario.id,revision:scenario.revision,timeSec:state.timeSec,engineVersion:ENGINE_VERSION,environmentId:environment.id,state:payload,checksum:checksum(payload)};
}
export function restoreCheckpoint(scenario:Scenario,environment:EnvironmentSnapshot,checkpoint:SimulationCheckpoint):void {
  if(checkpoint.scenarioId!==scenario.id||checkpoint.revision!==scenario.revision||checkpoint.environmentId!==environment.id||checkpoint.engineVersion!==ENGINE_VERSION||checksum(checkpoint.state)!==checkpoint.checksum)throw new Error('Incompatible or damaged checkpoint');
  const payload=checkpoint.state as {inputHash:string;arrival:(number|null)[];sensorState:EngineState};if(payload.inputHash!==keyFor(scenario,environment))throw new Error('Checkpoint input mismatch');
  caches.set(payload.inputHash,{arrival:Float64Array.from(payload.arrival,a=>a??Infinity),checkpoints:new Map([[0,initialState(scenario,environment)],[checkpoint.timeSec,structuredClone(payload.sensorState)]]),last:structuredClone(payload.sensorState)});
}
export function replayFromCheckpoint(scenario:Scenario,environment:EnvironmentSnapshot,checkpoint:SimulationCheckpoint,timeSec:number):SimulationFrame {restoreCheckpoint(scenario,environment,checkpoint);return simulateFrame(scenario,environment,timeSec);}
