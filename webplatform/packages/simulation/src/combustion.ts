import type {LandscapeCell} from '@dryspell/contracts';
import {PUBLISHED_FUELS} from './fuels';

export const FUEL_PARAMETER_VERSION='dryspell-combustion-v1';
export interface CombustionComponent {massKgM2:number;tauSec:number;heatJkg:number;sensibleFraction:number;smokeKgPerKg:number;}
export interface CombustionProfile {id:string;fast:CombustionComponent;residual:CombustionComponent;flameThresholdWm2:number;residualThresholdWm2:number;}
const component=(massKgM2:number,tauSec:number,sensibleFraction:number,smokeKgPerKg:number):CombustionComponent=>({massKgM2,tauSec,heatJkg:18_000_000,sensibleFraction,smokeKgPerKg});
const profile=(id:string,mass:number,fastFraction:number,fastTau:number,residualTau:number,fastSmoke=.01,residualSmoke=.04):CombustionProfile=>({id,fast:component(mass*fastFraction,fastTau,.35,fastSmoke),residual:component(mass*(1-fastFraction),residualTau,.2,residualSmoke),flameThresholdWm2:500,residualThresholdWm2:20});
/** Load conversion is exact SI conversion; combustion splits/times/emissions are named assumptions. */
export const TON_ACRE_TO_KG_M2=2000*.45359237/4046.8564224;
export const COMBUSTION_PROFILES:Record<string,CombustionProfile>={
  grass:profile('illustrative-dry-grass',1.1*TON_ACRE_TO_KG_M2,.9,35,160),
  woodland:profile('illustrative-woodland-litter-understory',1.5,.65,90,900,.015,.06),
  scrub:profile('illustrative-scrub',.8,.75,60,450,.012,.05),
  crop:profile('illustrative-crop-residue',.45,.85,45,240),
};
for(const [name,fuel] of Object.entries(PUBLISHED_FUELS))COMBUSTION_PROFILES[name]=profile(`${name}-combustion-assumption`,fuel.fineLoadTonAcre*TON_ACRE_TO_KG_M2,.9,35,160);

export function isSurfaceFuel(cell:LandscapeCell|undefined):cell is LandscapeCell{return Boolean(cell?.burnable&&cell.cover!=='water'&&cell.cover!=='built'&&cell.cover!=='unknown');}
export function combustionProfile(cell:LandscapeCell):CombustionProfile|null {
  if(!isSurfaceFuel(cell))return null;
  return COMBUSTION_PROFILES[cell.fuelModel]??(cell.sourceClassCode===40?COMBUSTION_PROFILES.crop:COMBUSTION_PROFILES[cell.cover]??COMBUSTION_PROFILES.grass);
}
function remaining(component:CombustionComponent,ageSec:number){return component.massKgM2*Math.exp(-Math.max(0,ageSec)/component.tauSec);}
export function combustionAt(profile:CombustionProfile,ageSec:number){
  const fastRemaining=remaining(profile.fast,ageSec),residualRemaining=remaining(profile.residual,ageSec),reached=ageSec>=0;
  const fastRate=reached?fastRemaining/profile.fast.tauSec:0,residualRate=reached?residualRemaining/profile.residual.tauSec:0;
  const fastHeat=fastRate*profile.fast.heatJkg*profile.fast.sensibleFraction,residualHeat=residualRate*profile.residual.heatJkg*profile.residual.sensibleFraction;
  const heatFluxWm2=fastHeat+residualHeat,smokeFluxKgM2Sec=fastRate*profile.fast.smokeKgPerKg+residualRate*profile.residual.smokeKgPerKg;
  const initialHeat=profile.fast.massKgM2/profile.fast.tauSec*profile.fast.heatJkg*profile.fast.sensibleFraction+profile.residual.massKgM2/profile.residual.tauSec*profile.residual.heatJkg*profile.residual.sensibleFraction;
  const phase=!reached?'unreached':fastHeat>=profile.flameThresholdWm2?'flaming':heatFluxWm2>=profile.residualThresholdWm2?'residual':'burned';
  return {phase,intensity:reached?heatFluxWm2/initialHeat:0,fuelRemainingKgM2:fastRemaining+residualRemaining,heatFluxWm2,smokeFluxKgM2Sec} as const;
}
/** Exact interval source integral: mass, sensible energy and emitted smoke per horizontal m². */
export function combustionInterval(profile:CombustionProfile,fromAgeSec:number,toAgeSec:number){
  if(toAgeSec<fromAgeSec)throw new Error('Combustion interval must be ordered');
  const consumed=(c:CombustionComponent)=>remaining(c,fromAgeSec)-remaining(c,toAgeSec),fastKgM2=consumed(profile.fast),residualKgM2=consumed(profile.residual);
  return {consumedKgM2:fastKgM2+residualKgM2,heatJm2:fastKgM2*profile.fast.heatJkg*profile.fast.sensibleFraction+residualKgM2*profile.residual.heatJkg*profile.residual.sensibleFraction,smokeKgM2:fastKgM2*profile.fast.smokeKgPerKg+residualKgM2*profile.residual.smokeKgPerKg};
}
