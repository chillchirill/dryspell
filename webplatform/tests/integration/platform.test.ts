import {beforeAll,describe,it,expect} from 'vitest';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import pg from 'pg';
import type {Scenario,Sensor,EnvironmentSnapshot,SimulationFrame,WsEnvelope} from '@dryspell/contracts';
dotenv.config({path:'.env.test',quiet:true});
dotenv.config({quiet:true});
const base=process.env.DRYSPELL_BASE_URL??'http://127.0.0.1:4000';
let cookie='',csrf='';
async function request(path:string,method='GET',body?:unknown,auth=true){
  const response=await fetch(base+'/api/v1'+path,{method,headers:{'content-type':'application/json',...(auth?{cookie,'x-csrf-token':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();return {response,data};
}
const unique=()=>`check-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
describe('actual PostgreSQL, HTTP, worker and WS integration',()=>{
  beforeAll(async()=>{
    const response=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:process.env.DRYSPELL_TEST_USERNAME,password:process.env.DRYSPELL_TEST_PASSWORD})});
    expect(response.status).toBe(200);cookie=response.headers.get('set-cookie')!.split(';')[0];csrf=(await response.json()).csrfToken;
  });
  it('denies unauthenticated, CSRF and foreign-origin mutations',async()=>{
    expect((await request('/sensors','POST',{},false)).response.status).toBe(401);
    const missing=await fetch(base+'/api/v1/scenarios',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'});expect(missing.status).toBe(403);
    const foreign=await fetch(base+'/api/v1/scenarios',{method:'POST',headers:{cookie,'content-type':'application/json','x-csrf-token':csrf,origin:'https://unrelated.invalid'},body:'{}'});expect(foreign.status).toBe(403);
  });
  it('commits capability-aware telemetry, preserves zeros, rejects invalid and duplicate packets, and sends WS',async()=>{
    const id=unique();const created=await request('/sensors','POST',{deviceId:id,name:'Integration real device',source:'real',profileId:'combined',location:{longitude:-6.32,latitude:53.01},expectedIntervalSec:60,enabled:true,tags:['integration']});
    expect(created.response.status).toBeLessThan(300);const sensor=created.data as Sensor;
    const credential=await request(`/sensors/${sensor.id}/credentials`,'POST',{});expect(credential.response.ok).toBe(true);
    const token=credential.data.token;
    expect(token).toBeTruthy();
    const received:WsEnvelope[]=[];
    const ws=new WebSocket(base.replace(/^http/,'ws')+'/ws?context=live');
    await new Promise<void>((resolve,reject)=>{ws.on('error',reject);ws.on('message',d=>{const e=JSON.parse(String(d));received.push(e);if(e.type==='snapshot')resolve();});});
    const packet={deviceId:id,messageId:unique(),recordedAt:new Date().toISOString(),temperatureC:71,humidityPct:0,smokePct:0};
    const ingest=(p:unknown,t=token)=>fetch(base+'/api/v1/telemetry',{method:'POST',headers:{authorization:`Bearer ${t}`,'content-type':'application/json'},body:JSON.stringify(p)});
    try{
      const accepted=await ingest(packet);expect(accepted.ok,await accepted.text()).toBe(true);
      const duplicate=await ingest(packet);expect((await duplicate.json()).status).toBe('duplicate');
      expect((await ingest({...packet,messageId:unique(),humidityPct:101})).status).toBe(400);
      expect((await ingest(packet,'wrong')).status).toBe(401);
      await expect.poll(()=>received.some(e=>e.type==='sensor.reading'&&(e.payload as any).sensorId===sensor.id),{timeout:10000}).toBe(true);
      const history=await request(`/sensors/${sensor.id}/readings`);const rows=Array.isArray(history.data)?history.data:history.data.readings;
      expect(rows[0].values.humidityPct).toBe(0);expect(rows[0].values.smokePct).toBe(0);
      const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL||process.env.DATABASE_URL,max:1});
      try{const persisted=await pool.query('SELECT count(*)::int AS n FROM telemetry WHERE sensor_id=$1',[sensor.id]);expect(persisted.rows[0].n).toBe(1);}finally{await pool.end();}
      // Partial packet has no fabricated channels; late packet cannot replace newer latest.
      const partial=await ingest({deviceId:id,messageId:unique(),recordedAt:sensor.createdAt,smokePct:12});expect(partial.ok,await partial.text()).toBe(true);
      const again=await request(`/sensors/${sensor.id}/readings`);const observations=Array.isArray(again.data)?again.data:again.data.readings;
      expect(observations.some((o:any)=>o.values.smokePct===12&&o.values.temperatureC===undefined)).toBe(true);
    }finally{ws.close();}
  });
  it('runs actual worker, pauses, rewinds deterministically, and forks revisions',async()=>{
    const environment=(await request('/environment')).data as EnvironmentSnapshot;
    expect(environment.status).toMatch(/ready|partial/);
    const landscape=environment.landscape;
    const idx=landscape.cells.findIndex(c=>c.burnable&&c.cover==='grass');expect(idx).toBeGreaterThanOrEqual(0);
    const x=idx%landscape.width,y=Math.floor(idx/landscape.width);
    const location={longitude:landscape.bounds.west+(x+.5)/landscape.width*(landscape.bounds.east-landscape.bounds.west),latitude:landscape.bounds.south+(y+.5)/landscape.height*(landscape.bounds.north-landscape.bounds.south)};
    const created=await request('/scenarios','POST',{name:unique(),environmentId:environment.id});expect(created.response.ok).toBe(true);
    let scenario=created.data as Scenario;
    const now=new Date().toISOString();
    const profiles=['combined','temperature','humidity','smoke'] as const;
    const sensors=profiles.map((profile,i)=>({id:unique(),deviceId:unique(),name:`Check ${profile}`,source:'simulated',location,profileId:profile,capabilities:profile==='combined'?['temperatureC','humidityPct','smokePct']:[profile==='temperature'?'temperatureC':profile==='humidity'?'humidityPct':'smokePct'],expectedIntervalSec:5,enabled:true,tags:[],createdAt:now,updatedAt:now}));
    const edited=await request(`/scenarios/${scenario.id}`,'PATCH',{revision:scenario.revision,sensors,ignitions:[{id:unique(),location,timeSec:0}],config:{...scenario.config,durationSec:120}});expect(edited.response.ok,JSON.stringify(edited.data)).toBe(true);scenario=edited.data;
    expect((await request(`/scenarios/${scenario.id}/run`,'POST',{})).response.ok).toBe(true);
    await expect.poll(async()=>((await request(`/scenarios/${scenario.id}`)).data as Scenario).authoritativeTimeSec,{timeout:60000}).toBeGreaterThanOrEqual(20);
    expect((await request(`/scenarios/${scenario.id}/pause`,'POST',{})).response.ok).toBe(true);
    const first=(await request(`/scenarios/${scenario.id}/state?at=10&revision=${scenario.revision}`)).data as SimulationFrame;
    const replay=(await request(`/scenarios/${scenario.id}/state?at=10&revision=${scenario.revision}`)).data as SimulationFrame;
    expect(first.checksum).toBeTruthy();expect(replay.checksum).toBe(first.checksum);expect(first.environmentId).toBe(environment.id);
    expect(Object.keys(first.readings.find(o=>o.sensorId===sensors[1].id)!.values)).toEqual(['temperatureC']);
    expect(Object.keys(first.readings.find(o=>o.sensorId===sensors[2].id)!.values)).toEqual(['humidityPct']);
    expect(Object.keys(first.readings.find(o=>o.sensorId===sensors[3].id)!.values)).toEqual(['smokePct']);
    const fork=await request(`/scenarios/${scenario.id}`,'PATCH',{revision:scenario.revision,name:'Edited after run'});expect(fork.response.ok).toBe(true);expect(fork.data.revision).toBeGreaterThan(scenario.revision);expect(fork.data.authoritativeTimeSec).toBe(0);expect(fork.data.status).toBe('draft');
    const old=(await request(`/scenarios/${scenario.id}/state?at=10&revision=${scenario.revision}`)).data;expect(old.checksum).toBe(first.checksum);
  });
  it('persists coincident delayed and current samples exactly once',async()=>{
    const e=(await request('/environment')).data as EnvironmentSnapshot,g=e.landscape;
    const i=g.cells.findIndex(c=>c.burnable),location={longitude:g.bounds.west+(i%g.width+.5)/g.width*(g.bounds.east-g.bounds.west),latitude:g.bounds.south+(Math.floor(i/g.width)+.5)/g.height*(g.bounds.north-g.bounds.south)};
    let s=(await request('/scenarios','POST',{name:'Delayed delivery '+unique()})).data as Scenario;
    const id=unique();
    const edited=await request(`/scenarios/${s.id}`,'PATCH',{revision:s.revision,sensors:[{id,name:'Delayed smoke',deviceId:id,source:'simulated',location,profileId:'smoke',expectedIntervalSec:5,enabled:true,tags:[],simulationFaults:[{type:'delay',startTimeSec:0,endTimeSec:30,delaySec:20}]}],ignitions:[{id:unique(),location,timeSec:0}],config:{...s.config,durationSec:60}});expect(edited.response.ok).toBe(true);s=edited.data;
    expect((await request(`/scenarios/${s.id}/run`,'POST',{})).response.ok).toBe(true);
    await expect.poll(async()=>((await request(`/scenarios/${s.id}`)).data as Scenario).authoritativeTimeSec,{timeout:60000}).toBe(60);
    const early=(await request(`/scenarios/${s.id}/state?at=10`)).data as SimulationFrame;expect(early.readings.filter(r=>r.sensorId===id)).toHaveLength(0);
    const collision=(await request(`/scenarios/${s.id}/state?at=30`)).data as SimulationFrame;expect(collision.readings.filter(r=>r.sensorId===id).map(r=>r.simulationTimeSec)).toEqual([30,10]);
    const rows=(await request(`/scenarios/${s.id}/readings?sensorId=${id}&to=60`)).data;
    expect(new Set(rows.map((r:any)=>r.id)).size).toBe(13);expect(rows).toHaveLength(13);
    expect(rows.find((r:any)=>r.simulationTimeSec===0).receivedAt).toBe(new Date(Date.parse(s.startTime)+20000).toISOString());
  });
});
