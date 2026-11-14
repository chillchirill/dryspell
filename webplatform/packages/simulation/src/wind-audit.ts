/** Reproducible numerical diagnostic; not imported by browser code. */
import {createSampleEnvironment} from '@dryspell/data-sources';
import {cellCenter,computeArrivalTimes,edgeRate} from './index';
import {fixture} from './test-fixture';
const directionResults=[];
for(const from of [0,45,90,135,180,225,270,315]){
  const {s,e}=fixture(21),c=220,dx=Math.round(-Math.sin(from*Math.PI/180)),dy=Math.round(-Math.cos(from*Math.PI/180));
  e.weather.samples[0].windFromDeg=from;e.weather.samples[0].windSpeedMps=5;
  const arrival=computeArrivalTimes(e.landscape,e.weather,s.ignitions,21600);directionResults.push({fromDeg:from,downwindOffset:[dx,dy],downwindArrivalSec:arrival[c+4*dx+4*dy*21],upwindArrivalSec:arrival[c-4*dx-4*dy*21]});
}
const {e:uniform}=fixture(5),base=uniform.weather.samples[0];
const speedResults=[0,1,5,10,20,40].map(speed=>{const w={...base,windFromDeg:270,windSpeedMps:speed};return {speedMps:speed,downwindRateMps:edgeRate(uniform.landscape,12,13,w),upwindRateMps:edgeRate(uniform.landscape,12,11,w)};});
const e=createSampleEnvironment(),g=e.landscape,centre=Math.floor(g.height/2)*g.width+Math.floor(g.width/2);
const ignition=[...g.cells.keys()].filter(i=>g.cells[i].burnable&&g.cells[i].cover!=='unknown').sort((a,b)=>Math.abs(a%g.width-centre%g.width)+Math.abs(Math.floor(a/g.width)-Math.floor(centre/g.width))-Math.abs(b%g.width-centre%g.width)-Math.abs(Math.floor(b/g.width)-Math.floor(centre/g.width)))[0];
const ignitions=[{location:cellCenter(g,ignition),timeSec:0}],weather={...e.weather,samples:[{...e.weather.samples[0],windFromDeg:270,windSpeedMps:5}]};
const terrain=computeArrivalTimes(g,weather,ignitions,21600),flat=computeArrivalTimes({...g,cells:g.cells.map(cell=>({...cell,elevationM:0}))},weather,ignitions,21600);
let differing=0,maxSlopeArrivalDifferenceSec=0,reached=0,waterReached=0;
terrain.forEach((t,i)=>{if(Number.isFinite(t)){reached++;if(g.cells[i].cover==='water')waterReached++;}if(Number.isFinite(t)&&Number.isFinite(flat[i])){const diff=Math.abs(t-flat[i]);if(diff>.01)differing++;maxSlopeArrivalDifferenceSec=Math.max(maxSlopeArrivalDifferenceSec,diff);}});
const targets=[[-8,0],[8,0],[0,-8],[0,8]].map(([dx,dy])=>{const i=ignition+dx+dy*g.width;return {offset:[dx,dy],cover:g.cells[i].cover,elevationM:g.cells[i].elevationM,arrivalSec:Number.isFinite(terrain[i])?terrain[i]:null,flatArrivalSec:Number.isFinite(flat[i])?flat[i]:null};});
console.log(JSON.stringify({directionResults,speedResults,preparedTerrain:{landscapeId:g.id,checksum:g.checksum,controlledWeather:'5 m/s from west; prepared temperature/humidity',ignitionCell:ignition,reached,waterReached,cellsAffectedBySlope:differing,maxSlopeArrivalDifferenceSec,targets}},null,2));
