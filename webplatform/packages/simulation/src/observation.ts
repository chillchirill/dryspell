import type {Coordinate,LandscapeSnapshot,WeatherSample} from '@dryspell/contracts';
import {combustionAt,type CombustionProfile} from './combustion';

/** Named reduced observation parameters; see docs/FUEL_PARAMETER_MANIFEST.md. */
export const OBSERVATION_PARAMETERS={heatGroundFraction:.25,heatResidenceSec:60,heatDiffusionM2Sec:20,contactHeatFraction:.25,contactHeatResidenceSec:15,contactHeatLayerM:1,airDensityKgM3:1.2,airHeatCapacityJkgK:1005,heatLayerM:3,smokeGroundFraction:.25,smokeLayerM:20,smokeDiffusionM2Sec:4,smokeLocalResidenceSec:30,smokeRemovalSec:240,maxSmokeTravelSec:600,smokeC50KgM3:1e-5,minimumTemperatureC:-45,maximumTemperatureC:150} as const;
export function saturationPressurePa(temperatureC:number):number {
  const t=temperatureC+273.15;
  if(temperatureC<-45||temperatureC>150)throw new Error('Humidity model temperature range is -45..150 °C');
  if(temperatureC<.01)return Math.exp(54.842763-6763.22/t-4.210*Math.log(t)+.000367*t+Math.tanh(.0415*(t-218.8))*(53.878-1331.22/t-9.44523*Math.log(t)+.014025*t));
  const tau=1-t/647.096;
  return 22.064e6*Math.exp(647.096/t*(-7.85951783*tau+1.84408259*tau**1.5-11.7866497*tau**3+22.6807411*tau**3.5-15.9618719*tau**4+1.80122502*tau**7.5));
}
export function humidityAtTemperature(ambientC:number,humidityPct:number,airC:number){return Math.max(0,Math.min(100,humidityPct*saturationPressurePa(Math.max(-45,Math.min(150,ambientC)))/saturationPressurePa(airC)));}
export function observationGeometry(grid:LandscapeSnapshot){
  const metresPerDegree=Math.PI/180*6371008.8,longitudeScale=metresPerDegree*Math.cos((grid.bounds.south+grid.bounds.north)*Math.PI/360),longitudeSpan=(grid.bounds.east-grid.bounds.west+360)%360||360;
  return {dx:longitudeSpan*longitudeScale/grid.width,dy:(grid.bounds.north-grid.bounds.south)*metresPerDegree/grid.height,longitudeScale,metresPerDegree};
}
export interface SourceField {timeSec:number;heat:Float64Array;smoke:Float64Array;}
export interface QueriedSourceField {timeSec:number;sampleAt:(cell:number)=>{heatFluxWm2:number;smokeFluxKgM2Sec:number};}
export function sourceFieldAt(profiles:(CombustionProfile|null)[],arrival:Float64Array,timeSec:number):SourceField {
  const heat=new Float64Array(arrival.length),smoke=new Float64Array(arrival.length);
  arrival.forEach((a,i)=>{const p=profiles[i];if(p&&a<=timeSec){const source=combustionAt(p,timeSec-a);heat[i]=source.heatFluxWm2;smoke[i]=source.smokeFluxKgM2Sec;}});return {timeSec,heat,smoke};
}
/** Evaluate identical local source values only when a sensor kernel actually requests them. */
export function queriedSourceFieldAt(profiles:(CombustionProfile|null)[],arrival:Float64Array,timeSec:number):QueriedSourceField {
  const samples=new Map<number,{heatFluxWm2:number;smokeFluxKgM2Sec:number}>();
  return {timeSec,sampleAt(cell){let source=samples.get(cell);if(!source){const profile=profiles[cell];source=profile&&arrival[cell]<=timeSec?combustionAt(profile,timeSec-arrival[cell]):{heatFluxWm2:0,smokeFluxKgM2Sec:0};samples.set(cell,source);}return source;}};
}
/** Transitional source-driven local heat / retarded steady-plume model, NOT historical puffs. */
export function sourceObservationTargets(grid:LandscapeSnapshot,geometry:ReturnType<typeof observationGeometry>,profiles:(CombustionProfile|null)[],arrival:Float64Array,field:SourceField|QueriedSourceField,location:Coordinate,weather:WeatherSample,vector:{east:number;north:number}){
  const p=OBSERVATION_PARAMETERS,area=grid.cellSizeM**2,sourceVariance=area/12,heatVariance=sourceVariance+2*p.heatDiffusionM2Sec*p.heatResidenceSec,localVariance=sourceVariance+2*p.smokeDiffusionM2Sec*p.smokeLocalResidenceSec;
  const speed=Math.hypot(vector.east,vector.north),sx=((location.longitude-grid.bounds.west+360)%360)*geometry.longitudeScale,sy=(location.latitude-grid.bounds.south)*geometry.metresPerDegree;
  const corridor=4*Math.sqrt(sourceVariance+2*p.smokeDiffusionM2Sec*p.maxSmokeTravelSec),localRadius=4*Math.sqrt(Math.max(localVariance,heatVariance));
  const upX=speed>=.2?-vector.east*p.maxSmokeTravelSec:0,upY=speed>=.2?-vector.north*p.maxSmokeTravelSec:0,radius=speed>=.2?Math.max(corridor,localRadius):localRadius;
  const x0=Math.max(0,Math.floor((sx+Math.min(0,upX)-radius)/geometry.dx)),x1=Math.min(grid.width-1,Math.floor((sx+Math.max(0,upX)+radius)/geometry.dx)),y0=Math.max(0,Math.floor((sy+Math.min(0,upY)-radius)/geometry.dy)),y1=Math.min(grid.height-1,Math.floor((sy+Math.max(0,upY)+radius)/geometry.dy));
  let excessK=0,smokeKgM3=0;
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const i=y*grid.width+x,profile=profiles[i];if(!profile||arrival[i]>field.timeSec)continue;
    const dx=sx-(x+.5)*geometry.dx,dy=sy-(y+.5)*geometry.dy,d2=dx*dx+dy*dy;
    // Compact bilinear interpolation of the local source density. Adjacent weights
    // partition unity: no cell-area gain, double counting at edges, or distant boost.
    const contactWeight=Math.max(0,1-Math.abs(dx)/geometry.dx)*Math.max(0,1-Math.abs(dy)/geometry.dy);
    const local=contactWeight>0||d2<=16*Math.max(heatVariance,localVariance)?('sampleAt' in field?field.sampleAt(i):{heatFluxWm2:field.heat[i],smokeFluxKgM2Sec:field.smoke[i]}):undefined;
    if(contactWeight>0)excessK+=contactWeight*local!.heatFluxWm2*p.contactHeatFraction*p.contactHeatResidenceSec/(p.airDensityKgM3*p.airHeatCapacityJkgK*p.contactHeatLayerM);
    if(d2<=16*heatVariance)excessK+=p.heatGroundFraction*local!.heatFluxWm2*area*p.heatResidenceSec/(p.airDensityKgM3*p.airHeatCapacityJkgK*p.heatLayerM*2*Math.PI*heatVariance)*Math.exp(-d2/(2*heatVariance));
    if(d2<=16*localVariance)smokeKgM3+=p.smokeGroundFraction*local!.smokeFluxKgM2Sec*area*p.smokeLocalResidenceSec/(2*Math.PI*localVariance*p.smokeLayerM)*Math.exp(-d2/(2*localVariance));
    if(speed<.2)continue;
    const along=(dx*vector.east+dy*vector.north)/speed,transportSec=along/speed;if(transportSec<=0||transportSec>p.maxSmokeTravelSec)continue;
    const emissionAge=field.timeSec-arrival[i]-transportSec;if(emissionAge<0)continue;
    const cross=(dx*vector.north-dy*vector.east)/speed,variance=sourceVariance+2*p.smokeDiffusionM2Sec*transportSec;if(cross*cross>16*variance)continue;
    const emitted=combustionAt(profile,emissionAge).smokeFluxKgM2Sec;
    smokeKgM3+=p.smokeGroundFraction*emitted*area/(speed*Math.sqrt(2*Math.PI*variance)*p.smokeLayerM)*Math.exp(-cross*cross/(2*variance)-transportSec/p.smokeRemovalSec);
  }
  const rawTemperature=weather.temperatureC+excessK,temperatureC=Math.max(p.minimumTemperatureC,Math.min(p.maximumTemperatureC,rawTemperature));
  return {temperatureC,humidityPct:humidityAtTemperature(weather.temperatureC,weather.humidityPct,temperatureC),smokePct:100*smokeKgM3/(smokeKgM3+p.smokeC50KgM3),temperatureLimited:temperatureC!==rawTemperature};
}
