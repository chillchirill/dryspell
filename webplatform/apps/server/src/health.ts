import type {Sensor,SensorStatus} from '@dryspell/contracts';
import {pool,transaction,event} from './db.ts';
export function deriveSensorStatus(sensor:Sensor,lastRecordedAt:string|null,lastReceivedAt:string|null,at=new Date().toISOString()):SensorStatus{
  const interval=sensor.expectedIntervalSec*1000,now=Date.parse(at),receivedAge=lastReceivedAt?now-Date.parse(lastReceivedAt):Infinity;
  const freshness=!lastRecordedAt?'missing':now-Date.parse(lastRecordedAt)>interval*3?'stale':'fresh';
  const state=sensor.archived?'archived':!sensor.enabled?'disabled':!lastReceivedAt?'waiting':receivedAge>interval*10?'offline':receivedAge>interval*3?'stale':'online';
  return{sensorId:sensor.id,state,freshness,lastRecordedAt,lastReceivedAt,evaluatedAt:at,expectedIntervalSec:sensor.expectedIntervalSec};
}
export async function getSensorStatuses(at=new Date().toISOString()):Promise<SensorStatus[]>{
  const rows=await pool.query('SELECT s.document,history.recorded_at,history.received_at FROM sensors s LEFT JOIN LATERAL (SELECT max(recorded_at) AS recorded_at,max(received_at) AS received_at FROM telemetry WHERE sensor_id=s.id AND received_at<=$1) history ON true',[at]);
  return rows.rows.map(r=>deriveSensorStatus(r.document,r.recorded_at?.toISOString()||null,r.received_at?.toISOString()||null,at));
}
export async function refreshSensorHealth(){
  const statuses=await getSensorStatuses();
  await transaction(async db=>{for(const status of statuses){const previous=(await db.query('SELECT document FROM sensor_health WHERE sensor_id=$1',[status.sensorId])).rows[0]?.document as SensorStatus|undefined;
    await db.query('INSERT INTO sensor_health(sensor_id,document) VALUES($1,$2) ON CONFLICT(sensor_id) DO UPDATE SET document=EXCLUDED.document,updated_at=now()',[status.sensorId,JSON.stringify(status)]);
    if(!previous||previous.state!==status.state||previous.freshness!==status.freshness)await event(db,'sensor.status','live',status);
  }});
}
