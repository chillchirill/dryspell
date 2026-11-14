import type {EnvironmentSnapshot,ValidatedObservation,PredictionInput} from '@dryspell/contracts';
import {predictFireSpread} from '@dryspell/inference';
import {pool,event,transaction} from './db.ts';
let cached:{until:number;environments:EnvironmentSnapshot[]}|undefined;
const reported=new Set<string>();
export async function analyzeRealObservation(observationId:string){
  const row=(await pool.query('SELECT document FROM telemetry WHERE id=$1',[observationId])).rows[0];if(!row)return;
  const observation=row.document as ValidatedObservation;
  if(!cached||cached.until<Date.now())cached={until:Date.now()+60000,environments:(await pool.query("SELECT document FROM environment_snapshots WHERE NOT (document->'weather'->'provenance' @> '[{\"sample\":true}]'::jsonb) ORDER BY created_at DESC LIMIT 20")).rows.map(r=>r.document)};
  const environment=cached.environments.find(e=>{const b=e.landscape.bounds,lon=observation.location.longitude,lat=observation.location.latitude;return lat>=b.south&&lat<=b.north&&(b.west<=b.east?lon>=b.west&&lon<=b.east:lon>=b.west||lon<=b.east)&&Date.parse(e.weather.issuedAt)<=Date.parse(observation.receivedAt)&&Date.parse(observation.receivedAt)-Date.parse(e.weather.validAt)<=86400000;});
  if(!environment){if(!reported.has(observation.sensorId)){reported.add(observation.sensorId);await event(pool,'source.status','live',{sensorId:observation.sensorId,status:'unavailable',reason:'Live inference requires a covering prepared terrain snapshot with real, time-valid weather. Synthetic sample weather is not used for real forecasts.'});}return;}
  reported.delete(observation.sensorId);
  const cutoff=observation.receivedAt,from=new Date(Date.parse(observation.recordedAt)-3600000).toISOString();
  const observations=(await pool.query('SELECT document FROM telemetry WHERE received_at<=$1 AND recorded_at BETWEEN $2 AND $1 ORDER BY recorded_at DESC LIMIT 3000',[cutoff,from])).rows.map(r=>r.document).reverse();
  const b=environment.landscape.bounds;
  const input:PredictionInput={area:{type:'Polygon',coordinates:[[[b.west,b.south],[b.east,b.south],[b.east,b.north],[b.west,b.north],[b.west,b.south]]]},issuedAt:cutoff,requestedTimes:[cutoff],observations,weatherSnapshot:environment.weather,landscapeSnapshot:environment.landscape,config:{ensembleSize:32,horizonSec:21600},seed:42};
  const result=await predictFireSpread(input);
  await transaction(async db=>{await db.query('INSERT INTO prediction_runs(id,issued_at,document) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[result.id,result.issuedAt,JSON.stringify(result)]);await event(db,'prediction.updated','live',result);});
}
