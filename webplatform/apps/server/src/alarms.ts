import type {ValidatedObservation,Incident} from '@dryspell/contracts';
import {pool,transaction,event,type DB} from './db.ts';
export interface AlarmState { level:'normal'|'suspicious'|'critical';suspectCount:number;clearCount:number;lastRecordedAt:string|null;lastObservationId:string|null;temperatureC?:number;smokePct?:number;requiredClearChannels?:('temperatureC'|'smokePct'|'smoke')[]; }
export interface AlarmThresholds { criticalTemperatureC:number;warningTemperatureC:number;clearTemperatureC:number;warningSmokePct:number;clearSmokePct:number;riseCPerMinute:number;consecutiveWarning:number;consecutiveClear:number; }
export const DEFAULT_ALARM_THRESHOLDS:AlarmThresholds={criticalTemperatureC:70,warningTemperatureC:45,clearTemperatureC:40,warningSmokePct:40,clearSmokePct:20,riseCPerMinute:2,consecutiveWarning:3,consecutiveClear:5};
export function initialAlarmState():AlarmState{return{level:'normal',suspectCount:0,clearCount:0,lastRecordedAt:null,lastObservationId:null};}
export function evaluateAlarm(previous:AlarmState,observation:ValidatedObservation,thresholds=DEFAULT_ALARM_THRESHOLDS):{state:AlarmState;changed:boolean;ignored:boolean;evidence:string[]}{
  const timestamp=Date.parse(observation.recordedAt),last=previous.lastRecordedAt?Date.parse(previous.lastRecordedAt):-Infinity;
  if(observation.id===previous.lastObservationId||timestamp<=last)return{state:previous,changed:false,ignored:true,evidence:[]};
  const temperature=observation.values.temperatureC,smoke=observation.values.smokePct;
  const minutes=Number.isFinite(last)?(timestamp-last)/60000:Infinity;
  const temperatureRise=temperature!==undefined&&previous.temperatureC!==undefined&&minutes>=1/60?(temperature-previous.temperatureC)/minutes:0;
  const hasEvidence=temperature!==undefined||smoke!==undefined||observation.smoke!==undefined;
  const unreliable=observation.quality.some(q=>['fault','stale','late','missing'].includes(q));
  const critical=temperature!==undefined&&temperature>=thresholds.criticalTemperatureC;
  const trending=temperature!==undefined&&temperature>=35&&temperatureRise>=thresholds.riseCPerMinute;
  const suspicious=critical||(temperature!==undefined&&temperature>=thresholds.warningTemperatureC)||(smoke!==undefined&&smoke>=thresholds.warningSmokePct)||observation.smoke===true||trending;
  const required=new Set(previous.requiredClearChannels||[]);
  if(critical||trending||(temperature!==undefined&&temperature>=thresholds.warningTemperatureC))required.add('temperatureC');
  if(smoke!==undefined&&smoke>=thresholds.warningSmokePct)required.add('smokePct');
  if(observation.smoke===true)required.add('smoke');
  // A long gap breaks consecutiveness. Missing/faulty channels never count as
  // reassuring evidence and therefore cannot resolve a prior alarm.
  const continuous=minutes<=10;
  const trustworthy=hasEvidence&&!unreliable;
  const suspectCount=trustworthy&&suspicious?(continuous?previous.suspectCount:0)+1:0;
  const completeRecoveryEvidence=[...required].every(channel=>channel==='smoke'?observation.smoke!==undefined:observation.values[channel]!==undefined);
  const clear=trustworthy&&completeRecoveryEvidence&&!suspicious&&(temperature===undefined||temperature<thresholds.clearTemperatureC)&&(smoke===undefined||smoke<thresholds.clearSmokePct)&&observation.smoke!==true;
  const clearCount=clear?(continuous?previous.clearCount:0)+1:0;
  let level=previous.level;
  if(critical)level='critical';
  else if(clearCount>=thresholds.consecutiveClear)level='normal';
  else if(suspectCount>=thresholds.consecutiveWarning&&level==='normal')level='suspicious';
  const evidence:string[]=[];
  if(critical)evidence.push(`Critical temperature alarm ≥${thresholds.criticalTemperatureC} °C; this is not confirmation of wildfire.`);
  if(smoke!==undefined&&smoke>=thresholds.warningSmokePct)evidence.push(`Elevated normalized smoke index: ${smoke.toFixed(1)}%.`);
  if(trending)evidence.push(`Temperature rose ${temperatureRise.toFixed(1)} °C/min over the last observation interval.`);
  if(suspectCount>=thresholds.consecutiveWarning)evidence.push(`${suspectCount} consecutive valid warning observations.`);
  if(level==='normal'&&previous.level!=='normal')evidence.push(`${clearCount} consecutive valid observations below recovery thresholds.`);
  if(unreliable)evidence.push('Observation quality prevents it from clearing an existing alarm.');
  return{state:{level,suspectCount,clearCount,lastRecordedAt:observation.recordedAt,lastObservationId:observation.id,temperatureC:temperature,smokePct:smoke,requiredClearChannels:level==='normal'&&clearCount>=thresholds.consecutiveClear?[]:[...required]},changed:level!==previous.level,ignored:false,evidence};
}
function configuredThresholds():AlarmThresholds{return{...DEFAULT_ALARM_THRESHOLDS,consecutiveWarning:Math.max(1,Math.min(20,Number(process.env.ALARM_WARNING_SAMPLES)||3)),consecutiveClear:Math.max(1,Math.min(30,Number(process.env.ALARM_CLEAR_SAMPLES)||5))};}
export async function alarmForObservation(db:DB,observation:ValidatedObservation):Promise<void>{
  if(db===pool)return transaction(client=>alarmForObservation(client,observation));
  const context=observation.source==='simulated'?'simulation':'live';
  const id=`${context}:${observation.scenarioId||''}:${observation.revision||0}:${observation.sensorId}`;
  await db.query('INSERT INTO alarm_states(key,document) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,JSON.stringify(initialAlarmState())]);
  const previous=(await db.query('SELECT document FROM alarm_states WHERE key=$1 FOR UPDATE',[id])).rows[0].document as AlarmState;
  const evaluated=evaluateAlarm(previous,observation,configuredThresholds());if(evaluated.ignored)return;
  await db.query('UPDATE alarm_states SET last_observation_id=$2,last_recorded_at=$3,document=$4 WHERE key=$1',[id,observation.id,observation.recordedAt,JSON.stringify(evaluated.state)]);
  if(!evaluated.changed&&evaluated.state.level==='normal')return;
  const old=(await db.query('SELECT document FROM incidents WHERE id=$1',[id])).rows[0]?.document as Incident|undefined;
  const manualState=old?.state==='confirmed'||old?.state==='acknowledged';
  const state=old?.state==='confirmed'?'confirmed':evaluated.state.level==='normal'?'resolved':manualState?old!.state:evaluated.state.level;
  const incident:Incident={id,sensorId:observation.sensorId,state,context,scenarioId:observation.scenarioId,revision:observation.revision,observedAt:observation.recordedAt,evidence:evaluated.evidence.length?evaluated.evidence:old?.evidence||[]};
  await db.query('INSERT INTO incidents(id,sensor_id,context,scenario_id,revision,observed_at,document) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET document=EXCLUDED.document,observed_at=EXCLUDED.observed_at',[id,observation.sensorId,context,observation.scenarioId,observation.revision,observation.recordedAt,JSON.stringify(incident)]);
  await db.query('INSERT INTO incident_evidence(incident_id,observation_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,observation.id]);
  if(evaluated.changed||!old)await event(db,'incident.updated',context,incident,observation.scenarioId,observation.revision);
}
