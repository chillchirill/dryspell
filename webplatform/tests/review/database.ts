import dotenv from 'dotenv';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
dotenv.config({quiet:true});
const database=process.env.TEST_DATABASE_URL;
if(!database||!new URL(database).pathname.endsWith('_test'))throw new Error('Review requires explicit TEST_DATABASE_URL ending in _test');
process.env.DATABASE_URL=database;
const {pool,event}=await import('../../apps/server/src/db.ts');
const reviewId=randomUUID();
const a=await pool.connect(),b=await pool.connect();
try{
 await a.query('BEGIN');await b.query('BEGIN');
 await event(a,'source.status','live',{reviewId,order:'A'});
 let allocatedB=false;
 const pending=event(b,'source.status','live',{reviewId,order:'B'}).then(()=>{allocatedB=true;});
 await new Promise(resolve=>setTimeout(resolve,250));
 assert.equal(allocatedB,false,'Second transaction must not allocate a visible later cursor before first commits');
 await a.query('COMMIT');await pending;await b.query('COMMIT');
 const rows=(await pool.query("SELECT cursor::text,payload->>'order' AS ordering FROM event_outbox WHERE payload->>'reviewId'=$1 ORDER BY cursor",[reviewId])).rows;
 assert.deepEqual(rows.map(r=>r.ordering),['A','B']);
 console.log(JSON.stringify({check:'outbox commit ordering on actual PostgreSQL',passed:true,cursors:rows.map(r=>r.cursor)}));
}finally{await a.query('ROLLBACK');await b.query('ROLLBACK');a.release();b.release();await pool.query("DELETE FROM event_outbox WHERE payload->>'reviewId'=$1",[reviewId]);}
const sensorId='review-'+reviewId;
try{
 await pool.query('INSERT INTO sensors(id,device_id,document,location) VALUES($1,$1,$2,ST_SetSRID(ST_MakePoint(0,0),4326)::geography)',[sensorId,JSON.stringify({id:sensorId,name:sensorId})]);
 const hour=new Date(Math.floor((Date.now()-91*86400000)/3600000)*3600000);
 for(const [minute,value] of [[10,20],[50,80]]){
  const at=new Date(hour.getTime()+minute*60000).toISOString();
  await pool.query('INSERT INTO telemetry(id,sensor_id,recorded_at,received_at,document) VALUES($1,$2,$3,$3,$4)',[randomUUID(),sensorId,at,JSON.stringify({values:{temperatureC:value}})]);
 }
 await import(new URL('../../scripts/maintenance.ts?review-pass=1',import.meta.url).href);
 const first=(await pool.query('SELECT count,min,max,mean FROM telemetry_hourly WHERE sensor_id=$1',[sensorId])).rows;
 assert.deepEqual(first,[{count:2,min:20,max:80,mean:50}]);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM telemetry WHERE sensor_id=$1',[sensorId])).rows[0].n,0);
 await import(new URL('../../scripts/maintenance.ts?review-pass=2',import.meta.url).href);
 const second=(await pool.query('SELECT count,min,max,mean FROM telemetry_hourly WHERE sensor_id=$1',[sensorId])).rows;
 assert.deepEqual(second,first);
 console.log(JSON.stringify({check:'first-run aggregation before deletion and repeat preservation on actual PostgreSQL',passed:true,aggregate:second}));
}finally{await pool.query('DELETE FROM sensors WHERE id=$1',[sensorId]);await pool.end();}
