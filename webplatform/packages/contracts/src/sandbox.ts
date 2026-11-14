import type {Scenario,EnvironmentSnapshot,SimulationFrame,ValidatedObservation} from './index';
export const SANDBOX_CONTRACT_VERSION='sandbox-v4';
export const SANDBOX_PLAYBACK_SPEEDS=[1,10,60,150,300] as const;
export interface SandboxWeatherSelection {mode:'current'|'historical';}
export interface SandboxWeatherCatalog {
 availableFrom:string; latestHistoricalStart:string; stepSec:number;
 localArchive:null|{id:string;status:'ready'|'loading'|'unavailable';bounds:import('./index').Bounds;startTime:string;endTime:string;spacingDeg:number;pointCount:number;provider:string;attribution:string};
}
/** Duration is a user value, bounded only by safe ticks and representable UTC dates. */
export function validSandboxDuration(seconds:number,startTime?:string):boolean {return Number.isSafeInteger(seconds)&&seconds>=5&&seconds%5===0&&(!startTime||Number.isFinite(new Date(Date.parse(startTime)+seconds*1000).getTime()));}
export function sandboxHoursToSeconds(hours:number,startTime?:string):number {const seconds=Math.round(hours*3600/5)*5;if(!Number.isFinite(hours)||hours<=0||!validSandboxDuration(seconds,startTime))throw new Error('Enter positive hours within the supported date range (minimum 5 seconds).');return seconds;}
export interface SandboxAreaRequest {center:import('./index').Coordinate;sizeM?:number;startTime:string;durationSec:number;}
export type SandboxCommand={type:'load';generation:number;scenario:Scenario;environment:EnvironmentSnapshot}|{type:'run';generation:number;speed:number}|{type:'pause'|'dispose';generation:number}|{type:'seek';generation:number;timeSec:number};
export interface SandboxEvent {type:'ready'|'frame'|'paused'|'progress'|'error';generation:number;frame?:SimulationFrame;computedUntilSec:number;message?:string;observations?:ValidatedObservation[];historyStartSec?:number;observationBatch?:ValidatedObservation[];playbackLagSec?:number;}
export interface SandboxWindControl {mode:'api'|'manual'|'demo';speedMps?:number;fromDeg?:number;}
export interface SandboxDocument {version:1;engineVersion?:string;windControl?:SandboxWindControl;weatherSelection?:SandboxWeatherSelection;scenario:Scenario;environment:EnvironmentSnapshot;cursorSec:number;computedUntilSec:number;}

