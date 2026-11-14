import 'dotenv/config';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import type {Context,EventType} from '@dryspell/contracts';
export const pool = new pg.Pool({connectionString:process.env.DATABASE_URL, max:Number(process.env.DB_POOL_SIZE||6),connectionTimeoutMillis:5000,idleTimeoutMillis:30000});
export const databaseDiagnostics:{lastPoolErrorAt:string|null;lastPoolErrorCode:string|null}={lastPoolErrorAt:null,lastPoolErrorCode:null};
// pg removes the failed idle client itself. Handling this event prevents an
// otherwise unhandled EventEmitter error from terminating web/worker processes.
pool.on('error',error=>{databaseDiagnostics.lastPoolErrorAt=new Date().toISOString();databaseDiagnostics.lastPoolErrorCode=(error as Error&{code?:string}).code||'CONNECTION_ERROR';console.error(JSON.stringify({service:'postgres-pool',event:'idle-client-disconnected',code:databaseDiagnostics.lastPoolErrorCode,recovery:'Subsequent queries acquire a replacement connection.'}));});
export type DB = Pick<pg.PoolClient,'query'>;
export async function transaction<T>(fn:(db:pg.PoolClient)=>Promise<T>):Promise<T> {const db=await pool.connect();let broken=false;try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result;}catch(e){try{await db.query('ROLLBACK');}catch{broken=true;}throw e;}finally{db.release(broken);}}
export function compress(value:unknown):Buffer{return gzipSync(JSON.stringify(value));}
export function expand<T>(value:Buffer):T{return JSON.parse(gunzipSync(value).toString());}
export async function event(db:DB,type:EventType,context:Context,payload:unknown,scenarioId?:string,revision?:number):Promise<void>{
  // Sequence allocation alone does not order commits. Hold this lock through the
  // enclosing commit so snapshot/reconnect cursors cannot skip an older commit.
  if(db===pool)return transaction(client=>event(client,type,context,payload,scenarioId,revision));
  await db.query('SELECT pg_advisory_xact_lock(40002001)');
  await db.query('INSERT INTO event_outbox(event_id,type,context,payload,scenario_id,revision) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),type,context,JSON.stringify(payload),scenarioId,revision]);
}
export async function audit(db:DB,actor:string,action:string,id:string,details:unknown={}){await db.query('INSERT INTO audit_log(actor,action,entity_id,details) VALUES($1,$2,$3,$4)',[actor,action,id,JSON.stringify(details)]);}
