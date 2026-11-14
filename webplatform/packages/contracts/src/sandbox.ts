import type {Scenario,EnvironmentSnapshot,SimulationFrame,ValidatedObservation} from './index';
export const SANDBOX_CONTRACT_VERSION='sandbox-v2';
/** Duration is a user value, bounded only by safe ticks and representable UTC dates. */
export function validSandboxDuration(seconds:number,startTime?:string):boolean {return Number.isSafeInteger(seconds)&&seconds>=5&&seconds%5===0&&(!startTime||Number.isFinite(new Date(Date.parse(startTime)+seconds*1000).getTime()));}
export function sandboxHoursToSeconds(hours:number,startTime?:string):number {const seconds=Math.round(hours*3600/5)*5;if(!Number.isFinite(hours)||hours<=0||!validSandboxDuration(seconds,startTime))throw new Error('Enter positive hours within the supported date range (minimum 5 seconds).');return seconds;}
export interface SandboxAreaRequest {center:import('./index').Coordinate;sizeM?:number;startTime:string;durationSec:number;}
export type SandboxCommand={type:'load';generation:number;scenario:Scenario;environment:EnvironmentSnapshot}|{type:'run';generation:number;speed:number}|{type:'pause'|'dispose';generation:number}|{type:'seek';generation:number;timeSec:number};
export interface SandboxEvent {type:'ready'|'frame'|'paused'|'progress'|'error';generation:number;frame?:SimulationFrame;computedUntilSec:number;message?:string;observations?:ValidatedObservation[];historyStartSec?:number;}
export interface SandboxDocument {version:1;engineVersion?:string;scenario:Scenario;environment:EnvironmentSnapshot;cursorSec:number;computedUntilSec:number;}

