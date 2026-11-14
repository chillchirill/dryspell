import 'dotenv/config';
import dotenv from 'dotenv';
import {writeFile,mkdir} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import pg from 'pg';
import WebSocket from 'ws';
dotenv.config({path:'.env.test',quiet:true});
const base=process.env.DRYSPELL_BASE_URL??'http://127.0.0.1:4000';
const login=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:process.env.DRYSPELL_TEST_USERNAME,password:process.env.DRYSPELL_TEST_PASSWORD})});assert.equal(login.status,200);
const cookie=login.headers.get('set-cookie')!.split(';')[0],session=await login.json() as {csrfToken:string};
async function post(path:string,value:unknown){const r=await fetch(base+'/api/v1'+path,{method:'POST',headers:{cookie,'x-csrf-token':session.csrfToken,'content-type':'application/json'},body:JSON.stringify(value)});assert.ok(r.ok,await r.clone().text());return r.json();}
const run=Date.now(),sensors:{id:string;deviceId:string;token:string}[]=[];
for(let i=0;i<30;i++){const deviceId=`load-${run}-${i}`;const s=await post('/sensors',{deviceId,name:`Load check ${i+1}`,source:'real',profileId:'combined',location:{longitude:-6.35+i*.0001,latitude:53.02},expectedIntervalSec:1,enabled:true,tags:['load-check']}) as {id:string};const c=await post(`/sensors/${s.id}/credentials`,{}) as {token:string};sensors.push({...s,deviceId,token:c.token});}
const observations=new Set<string>(),wsLatency:number[]=[];
const ws=new WebSocket(base.replace(/^http/,'ws')+'/ws?context=live');
await new Promise<void>((resolve,reject)=>{ws.on('error',reject);ws.on('message',d=>{const e=JSON.parse(String(d));if(e.type==='snapshot')resolve();if(e.type==='sensor.reading'&&sensors.some(s=>s.id===e.payload.sensorId)){observations.add(e.payload.id);wsLatency.push(Date.now()-Date.parse(e.payload.receivedAt));}});});
const db=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:1});
const sizeBefore=Number((await db.query('SELECT pg_database_size(current_database()) AS bytes')).rows[0].bytes);
const latencies:number[]=[],ids:string[]=[];const start=performance.now();
try{
  for(let tick=0;tick<10;tick++){
    const tickStart=performance.now();
    await Promise.all(sensors.map(async s=>{const sent=performance.now();const response=await fetch(base+'/api/v1/telemetry',{method:'POST',headers:{authorization:`Bearer ${s.token}`,'content-type':'application/json'},body:JSON.stringify({deviceId:s.deviceId,messageId:`load:${run}:${tick}`,temperatureC:24+tick*.1,humidityPct:0,smokePct:0})});assert.equal(response.status,201);ids.push((await response.json() as {id:string}).id);latencies.push(performance.now()-sent);}));
    await delay(Math.max(0,1000-(performance.now()-tickStart)));
  }
  for(let i=0;i<20&&observations.size<300;i++)await delay(100);
  const persisted=Number((await db.query('SELECT count(*) AS n FROM telemetry WHERE id=ANY($1)',[ids])).rows[0].n);assert.equal(persisted,300);assert.equal(observations.size,300);
  const percentile=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
  const result={measuredAt:new Date().toISOString(),runtime:process.version,platform:process.platform,sensors:30,ticks:10,expected:300,acknowledged:ids.length,persisted,wsDelivered:observations.size,elapsedMs:Math.round(performance.now()-start),ingestionP95Ms:Math.round(percentile(latencies,.95)),wsP95Ms:Math.round(percentile(wsLatency,.95)),wsMaxMs:Math.round(Math.max(...wsLatency)),databaseGrowthBytes:Number((await db.query('SELECT pg_database_size(current_database()) AS bytes')).rows[0].bytes)-sizeBefore,limitations:'Windows host + Docker Desktop; not the 2CPU/3GB Ubuntu reference machine. Ten-second burst, not endurance.'};
  await mkdir('docs/evidence',{recursive:true});await writeFile('docs/evidence/load-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{ws.close();await db.end();}
