import dotenv from 'dotenv';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {writeFile} from 'node:fs/promises';
import pg from 'pg';
import {cellCenter,simulateFrame} from '@dryspell/simulation';
import type {Scenario,EnvironmentSnapshot} from '@dryspell/contracts';
dotenv.config({path:'.env.test',quiet:true});
export async function checkRestarts(restartWorker:()=>Promise<void>,restartWeb:()=>Promise<void>){
  const base='http://127.0.0.1:4000/api/v1';
  const login=await fetch(base+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:process.env.DRYSPELL_TEST_USERNAME,password:process.env.DRYSPELL_TEST_PASSWORD})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0],csrf=(await login.json() as {csrfToken:string}).csrfToken;
  const request=async(path:string,method='GET',data?:unknown)=>{const r=await fetch(base+path,{method,headers:{cookie,'x-csrf-token':csrf,'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});assert.ok(r.ok,await r.clone().text());return r.json();};
  const e=await request('/environment') as EnvironmentSnapshot;
  let s=await request('/scenarios','POST',{name:'Worker restart acceptance'}) as Scenario;
  const index=e.landscape.cells.findIndex(c=>c.burnable);
  s=await request('/scenarios/'+s.id,'PATCH',{revision:s.revision,ignitions:[{id:'restart-ignition',location:cellCenter(e.landscape,index),timeSec:0}],config:{...s.config,durationSec:120}}) as Scenario;
  await request(`/scenarios/${s.id}/run`,'POST',{});
  async function awaitTime(time:number){for(let i=0;i<360;i++){const current=await request('/scenarios/'+s.id) as Scenario;if(current.authoritativeTimeSec>=time)return current;await delay(500);}throw new Error('Worker did not reach '+time);}
  await awaitTime(65);
  const db=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:1});
  try{
    const checkpoints=Number((await db.query('SELECT count(*) AS n FROM simulation_checkpoints WHERE scenario_id=$1 AND revision=$2 AND time_sec>=60',[s.id,s.revision])).rows[0].n);assert.ok(checkpoints>=1);
    await restartWorker();
    await awaitTime(90);await request(`/scenarios/${s.id}/pause`,'POST',{});
    const actual=await request(`/scenarios/${s.id}/state?revision=${s.revision}&at=90`);
    const expected=simulateFrame(s,e,90);assert.equal(actual.checksum,expected.checksum);
    const countBefore=Number((await db.query('SELECT count(*) AS n FROM telemetry')).rows[0].n);assert.ok(countBefore>0);
    await restartWeb();
    const session=await request('/auth/session');assert.equal(session.authenticated,true,'Persisted session must survive web restart');
    const replay=await request(`/scenarios/${s.id}/state?revision=${s.revision}&at=90`);assert.equal(replay.checksum,actual.checksum);
    const countAfter=Number((await db.query('SELECT count(*) AS n FROM telemetry')).rows[0].n);assert.equal(countAfter,countBefore);
    const result={measuredAt:new Date().toISOString(),scenarioId:s.id,revision:s.revision,checkpoints,workerRestartDeterministic:true,webRestartSessionPreserved:true,acknowledgedTelemetryBefore:countBefore,acknowledgedTelemetryAfter:countAfter,frameChecksum:actual.checksum};
    await writeFile('docs/evidence/restart-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{await db.end();}
}
