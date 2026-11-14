import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config({path:'.env.test',quiet:true});dotenv.config({quiet:true});
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
const sensor='363a9e2b-bc43-4f22-a1d3-00ac1ffb9e0d';
const scenarios=['b79bb8bf-7acc-4758-8c66-a84ed0db1108','c4c5be4f-996c-47fb-8ae6-46305ee30442'];
await db.connect();
try {
 await db.query('BEGIN');
 const owned=(await db.query('SELECT document FROM sensors WHERE id=$1 FOR UPDATE',[sensor])).rows[0]?.document;
 if(owned?.deviceId!=='check-1794669337667-0oma3q'||owned.createdAt!=='2026-11-14T15:15:37.690Z')throw Error('Owned sensor identity changed');
 const rows=(await db.query('SELECT id,document FROM scenarios WHERE id=ANY($1::text[]) FOR UPDATE',[scenarios])).rows;
 if(rows.length!==2||rows.some(r=>!['2026-11-14T15:15:43.445Z','2026-11-14T15:15:39.089Z'].includes(r.document.createdAt)))throw Error('Owned scenario identity changed');
 if((await db.query("SELECT id FROM analysis_jobs WHERE scenario_id=ANY($1::text[]) AND status IN ('queued','running')",[scenarios])).rowCount)throw Error('Owned job still active');
 await db.query('DELETE FROM incident_evidence WHERE incident_id IN (SELECT id FROM incidents WHERE sensor_id=$1 OR scenario_id=ANY($2::text[]))',[sensor,scenarios]);
 await db.query('DELETE FROM incidents WHERE sensor_id=$1 OR scenario_id=ANY($2::text[])',[sensor,scenarios]);
 for(const table of ['scenario_events','simulation_checkpoints','simulation_frames','simulation_readings','prediction_runs','analysis_jobs']) await db.query(`DELETE FROM ${table} WHERE scenario_id=ANY($1::text[])`,[scenarios]);
 await db.query('DELETE FROM scenarios WHERE id=ANY($1::text[])',[scenarios]);
 await db.query('UPDATE device_credentials SET revoked_at=now() WHERE $1=ANY(sensor_ids)',[sensor]);
 await db.query('DELETE FROM sensors WHERE id=$1',[sensor]);
 await db.query("INSERT INTO audit_log(actor,action,entity_id,details) VALUES('development-verification','test.cleanup',$1,$2)",[sensor,JSON.stringify({scenarios,reason:'Removed only three identified objects created by unintended legacy integration-test invocation; audit/outbox history retained.'})]);
 await db.query('COMMIT');console.log('Removed only 1 owned test sensor and 2 owned test scenarios; revoked owned credential; retained audit/outbox history.');
} catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
