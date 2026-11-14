import dotenv from 'dotenv';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import request from 'supertest';
dotenv.config({quiet:true});
const database=process.env.TEST_DATABASE_URL;
if(!database||!new URL(database).pathname.endsWith('_test'))throw new Error('Requires guarded TEST_DATABASE_URL');
process.env.DATABASE_URL=database;
const {pool}=await import('../../apps/server/src/db.ts');
const {createApp}=await import('../../apps/server/src/app.ts');
const {makeSensor}=await import('../../apps/server/src/domain.ts');
const id='review-history-'+randomUUID(),now=Date.now(),cutoff=now-2*86400000;
const sensor=makeSensor({id,deviceId:id,name:id,location:{longitude:1,latitude:1}},'real');
const server=createServer(createApp());await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 await pool.query('INSERT INTO sensors(id,device_id,document,location) VALUES($1,$1,$2,ST_SetSRID(ST_MakePoint(1,1),4326)::geography)',[id,JSON.stringify(sensor)]);
 await pool.query('INSERT INTO sensor_locations(sensor_id,version,effective_at,location,document) VALUES($1,1,$2,ST_SetSRID(ST_MakePoint(0,0),4326)::geography,$3),($1,2,$4,ST_SetSRID(ST_MakePoint(1,1),4326)::geography,$5)',[id,new Date(now-4*86400000).toISOString(),JSON.stringify({longitude:0,latitude:0}),new Date(now-86400000).toISOString(),JSON.stringify({longitude:1,latitude:1})]);
 const observations=Array.from({length:1201},(_,i)=>{const at=new Date(cutoff-(1200-i)*1000).toISOString();return{id:id+'-'+i,sensorId:id,source:'real',recordedAt:at,receivedAt:at,location:{longitude:0,latitude:0},locationVersion:1,values:{temperatureC:i===1200?71:20},quality:[]};});
 await pool.query("INSERT INTO telemetry(id,sensor_id,recorded_at,received_at,document) SELECT o->>'id',$1,(o->>'recordedAt')::timestamptz,(o->>'receivedAt')::timestamptz,o FROM jsonb_array_elements($2::jsonb) o",[id,JSON.stringify(observations)]);
 const last=observations.at(-1)!;
 await pool.query('INSERT INTO sensor_latest(sensor_id,recorded_at,document) VALUES($1,$2,$3)',[id,last.recordedAt,JSON.stringify(last)]);
 const old=await request(server).get('/api/v1/sensors').query({at:new Date(cutoff+500).toISOString()});
 assert.equal(old.status,200);assert.deepEqual(old.body.find((s:{id:string})=>s.id===id).location,{longitude:0,latitude:0});
 const current=await request(server).get('/api/v1/sensors');assert.deepEqual(current.body.find((s:{id:string})=>s.id===id).location,{longitude:1,latitude:1});
 const history=await request(server).get(`/api/v1/sensors/${id}/readings`).query({to:new Date(cutoff+500).toISOString(),order:'desc',limit:1200});
 assert.equal(history.status,200);assert.equal(history.body.length,1200);assert.equal(history.body[0].values.temperatureC,71);assert.equal(history.body[0].id,last.id);
 const latest=await request(server).get('/api/v1/readings/latest');assert.equal(latest.body.find((o:{sensorId:string})=>o.sensorId===id).values.temperatureC,71);
 console.log(JSON.stringify({check:'historical location, older-than-day default range, latest bounded chart window',passed:true,rows:history.body.length,newestTemperatureC:history.body[0].values.temperatureC,database:'guarded _test',transport:'isolated Express/Supertest loopback; main app untouched'}));
}finally{
 await pool.query('DELETE FROM sensors WHERE id=$1',[id]);
 await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 await pool.end();
}
