import type pg from 'pg';
import {pool} from './db.ts';
/** Single-worker architecture: only an exclusive DB session lock permits
 * immediate recovery of jobs abandoned by a terminated predecessor. */
export async function acquireWorkerLock(onLost:()=>void):Promise<()=>Promise<void>>{
  const client:pg.PoolClient=await pool.connect();let lost=false,released=false;
  const failure=()=>{if(released)return;lost=true;console.error(JSON.stringify({service:'dryspell-worker',event:'worker-lock-connection-lost',recovery:'Stop claiming work; supervisor must restart and reacquire the exclusive lock.'}));onLost();};
  client.on('error',failure);
  try{
    const acquired=(await client.query('SELECT pg_try_advisory_lock(40003001) AS acquired')).rows[0].acquired;
    if(!acquired)throw new Error('Another Dryspell worker owns the database lifetime lock.');
    // A current queued successor supersedes an older running real-observation
    // cutoff. All raw observations remain available to its analysis.
    await client.query(`UPDATE analysis_jobs old SET status=CASE
      WHEN old.kind='real-observation' AND EXISTS (SELECT 1 FROM analysis_jobs newer
        WHERE newer.kind='real-observation' AND newer.status='queued'
        AND newer.payload->>'sensorId'=old.payload->>'sensorId') THEN 'cancelled'
      ELSE 'queued' END,owner=NULL,lease_until=NULL,updated_at=now()
      WHERE old.status='running'`);
  }catch(error){released=true;client.removeListener('error',failure);client.release(true);throw error;}
  return async()=>{if(released)return;released=true;if(!lost)try{await client.query('SELECT pg_advisory_unlock(40003001)');}catch{lost=true;}client.removeListener('error',failure);client.release(lost);};
}
