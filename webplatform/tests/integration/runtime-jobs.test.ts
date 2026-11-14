import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';
import WebSocket from 'ws';
import type {Sensor,ValidatedObservation,WsEnvelope} from '@dryspell/contracts';

// Opt-in is captured before loading dotenv: merely keeping .env.test on disk
// must not cause this suite to mutate an application database.
const enabled=process.env.RUN_DB_TESTS==='1';
dotenv.config({path:'.env.test',quiet:true});
const base=process.env.DRYSPELL_BASE_URL||'http://127.0.0.1:4000';
let database:pg.Pool|undefined,cookie='',csrf='';
const ownedSensors:Sensor[]=[],ownedJobs:string[]=[];
const openSockets=new Set<WebSocket>();
type Snapshot={sensors:Sensor[];readings:ValidatedObservation[];cursor:string};
type Capture={socket:WebSocket;events:WsEnvelope[];errors:string[]};

async function api(route:string,method='GET',body?:unknown,authenticated=true){
  const response=await fetch(base+'/api/v1'+route,{method,signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json',...(authenticated?{cookie,'x-csrf-token':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return{response,data:await response.json()};
}
async function socketCapture(query:string):Promise<Capture>{
  const socket=new WebSocket(base.replace(/^http/,'ws')+'/ws?'+query);
  const capture:Capture={socket,events:[],errors:[]};openSockets.add(socket);
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('WebSocket snapshot timed out')),10000);
    socket.on('error',error=>{capture.errors.push(error.message);clearTimeout(timer);reject(error);});
    socket.on('close',(code,reason)=>{openSockets.delete(socket);if(!capture.events.some(e=>e.type==='snapshot')){clearTimeout(timer);reject(new Error(`Socket closed before snapshot: ${code} ${reason}`));}});
    socket.on('message',message=>{try{const event=JSON.parse(String(message)) as WsEnvelope;capture.events.push(event);if(event.type==='snapshot'){clearTimeout(timer);resolve();}}catch(error){capture.errors.push(String(error));clearTimeout(timer);reject(error);}});
  });
  return capture;
}
async function closeSocket(socket:WebSocket){
  if(socket.readyState===WebSocket.CLOSED){openSockets.delete(socket);return;}
  await new Promise<void>(resolve=>{const timer=setTimeout(()=>{socket.terminate();resolve();},1500);socket.once('close',()=>{clearTimeout(timer);resolve();});socket.close();});
  openSockets.delete(socket);
}
async function createDevice(name:string,longitude:number){
  const created=await api('/sensors','POST',{name,deviceId:'runtime-'+randomUUID(),profileId:'temperature',source:'real',location:{longitude,latitude:53.02},expectedIntervalSec:60,tags:['runtime-integration']});
  expect(created.response.status,JSON.stringify(created.data)).toBe(201);
  const sensor=created.data as Sensor;ownedSensors.push(sensor);
  const credential=await api(`/sensors/${sensor.id}/credentials`,'POST',{});
  expect(credential.response.status).toBe(201);expect(credential.data.token).toBeTruthy();
  return{sensor,token:String(credential.data.token)};
}
async function sendReading(device:Awaited<ReturnType<typeof createDevice>>,temperatureC:number){
  const response=await fetch(base+'/api/v1/telemetry',{method:'POST',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json',authorization:`Bearer ${device.token}`},body:JSON.stringify({deviceId:device.sensor.deviceId,messageId:randomUUID(),recordedAt:new Date().toISOString(),temperatureC})});
  const data=await response.json();expect(response.status,JSON.stringify(data)).toBe(201);expect(data.status).toBe('accepted');return String(data.id);
}

describe.skipIf(!enabled)('guarded real runtime jobs and geographic WebSocket subscriptions',()=>{
  beforeAll(async()=>{
    const connection=process.env.TEST_DATABASE_URL;
    if(!connection||!new URL(connection).pathname.endsWith('_test'))throw new Error('Explicit TEST_DATABASE_URL naming a dedicated *_test database is required.');
    if(!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))throw new Error('Runtime integration only targets a local loopback test server.');
    database=new pg.Pool({connectionString:connection,max:2,connectionTimeoutMillis:5000});
    const name=decodeURIComponent(new URL(connection).pathname.slice(1));
    expect((await database.query('SELECT current_database() AS name')).rows[0].name).toBe(name);

    // This probe is written only to the explicitly named test database. The
    // target API must prove it uses that database before login or any mutation.
    const probeId='runtime-binding-'+randomUUID(),now=new Date().toISOString();
    const probe:Sensor={id:probeId,deviceId:probeId,name:'Disposable test-database binding probe',source:'real',profileId:'temperature',capabilities:['temperatureC'],location:{longitude:0,latitude:0},expectedIntervalSec:60,enabled:false,tags:['runtime-binding-probe'],createdAt:now,updatedAt:now};
    await database.query('INSERT INTO sensors(id,device_id,document,location) VALUES($1,$1,$2,ST_SetSRID(ST_MakePoint(0,0),4326)::geography)',[probeId,JSON.stringify(probe)]);
    try{const observed=await api(`/sensors/${probeId}`,'GET',undefined,false);if(observed.response.status!==200||observed.data.id!==probeId)throw new Error('Target HTTP server is not connected to TEST_DATABASE_URL. No HTTP mutation was attempted.');}
    finally{await database.query('DELETE FROM sensors WHERE id=$1',[probeId]);}

    const login=await fetch(base+'/api/v1/auth/login',{method:'POST',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json'},body:JSON.stringify({username:process.env.DRYSPELL_TEST_USERNAME,password:process.env.DRYSPELL_TEST_PASSWORD})});
    expect(login.status,'Test administrator credentials must match the guarded stack.').toBe(200);
    cookie=login.headers.get('set-cookie')!.split(';')[0];csrf=(await login.json()).csrfToken;
    const ready=await fetch(base+'/health/ready',{signal:AbortSignal.timeout(10000)});expect(ready.status).toBe(200);expect((await ready.json()).worker).toBe('healthy');
  },30000);

  afterAll(async()=>{
    await Promise.all([...openSockets].map(closeSocket));
    if(cookie)await api('/auth/logout','POST',{}).catch(()=>{});
    if(database){try{
      // Every identifier below was returned for objects created by this suite;
      // cleanup never truncates tables or touches unrelated test scenarios.
      const ids=ownedSensors.map(s=>s.id);
      if(ids.length){await database.query("DELETE FROM analysis_jobs WHERE kind='real-observation' AND payload->>'sensorId'=ANY($1::text[])",[ids]);await database.query('DELETE FROM device_credentials WHERE sensor_ids&&$1::text[]',[ids]);await database.query('DELETE FROM sensors WHERE id=ANY($1::text[])',[ids]);}
      if(ownedJobs.length){await database.query('DELETE FROM prediction_runs WHERE id=ANY($1::text[])',[ownedJobs]);await database.query('DELETE FROM analysis_jobs WHERE id=ANY($1::text[])',[ownedJobs]);}
    }finally{await database.end();}}
  },10000);

  it('runs a daily prediction through HTTP, worker, PostgreSQL and WS with explicit missing-model fallback',async()=>{
    // These zero-valued feature rows are deliberately a plumbing fixture. They
    // are not provider-derived cells and establish no model/scientific accuracy.
    const input={region:'runtime-fixture',resolutionM:1000,horizonHours:24,features:[Array(13).fill(0),Array(13).fill(0)]};
    expect((await api('/predictions/daily','POST',input,false)).response.status).toBe(401);
    expect((await api('/predictions/daily','POST',{...input,directory:'client-controlled-path'})).response.status).toBe(400);
    const capture=await socketCapture('context=live');
    try{
      const queued=await api('/predictions/daily','POST',input);expect(queued.response.status,JSON.stringify(queued.data)).toBe(202);
      const id=String(queued.data.id);ownedJobs.push(id);
      await expect.poll(async()=>{const result=await api(`/predictions/${id}`);if(result.data.status==='failed')throw new Error(`Daily worker job failed: ${result.data.error}`);return result.data.kind;},{timeout:45000}).toBe('daily-prediction');
      const result=(await api(`/predictions/${id}`)).data;
      expect(result).toMatchObject({id,kind:'daily-prediction',activeModel:'physical',probabilities:null,modelVersion:'physical-fallback',resolutionM:1000,horizonHours:24,cellCount:2,featureCount:13,region:'runtime-fixture'});
      expect(result.fallbackReason).toMatch(/artifact directory unavailable|could not load|experimental and not promoted/i);
      expect(Number.isFinite(Date.parse(result.issuedAt))).toBe(true);expect(result.inputCutoff).toBe(result.issuedAt);
      await expect.poll(()=>capture.events.some(e=>e.type==='prediction.updated'&&(e.payload as {id?:string}).id===id),{timeout:10000}).toBe(true);
      await expect.poll(async()=>(await database!.query('SELECT status FROM analysis_jobs WHERE id=$1',[id])).rows[0]?.status,{timeout:10000}).toBe('completed');
      const persisted=(await database!.query('SELECT document FROM prediction_runs WHERE id=$1',[id])).rows[0]?.document;
      expect(persisted).toEqual(result);expect(capture.errors).toEqual([]);
    }finally{await closeSocket(capture.socket);}
  },60000);

  it('filters bbox snapshots and committed events, then reconnects with a fresh matching snapshot',async()=>{
    const inside=await createDevice('Inside subscription area',-6.32),outside=await createDevice('Outside subscription area',-6.40);
    const bounds='-6.34,53.00,-6.30,53.04',query='context=live&bounds='+encodeURIComponent(bounds);
    const capture=await socketCapture(query);
    let disconnectedCursor='0';
    try{
      const snapshot=capture.events.find(e=>e.type==='snapshot')!.payload as Snapshot;
      expect(snapshot.sensors.some(s=>s.id===inside.sensor.id)).toBe(true);expect(snapshot.sensors.some(s=>s.id===outside.sensor.id)).toBe(false);
      const outsideId=await sendReading(outside,21),insideId=await sendReading(inside,22);
      await expect.poll(()=>capture.events.some(e=>e.type==='sensor.reading'&&(e.payload as ValidatedObservation).id===insideId),{timeout:10000}).toBe(true);
      const delivered=capture.events.find(e=>e.type==='sensor.reading'&&(e.payload as ValidatedObservation).id===insideId)!;
      const commits=(await database!.query("SELECT cursor::text,payload->>'id' AS id FROM event_outbox WHERE type='sensor.reading' AND payload->>'id'=ANY($1::text[]) ORDER BY cursor",[[outsideId,insideId]])).rows;
      expect(commits.map(r=>r.id)).toEqual([outsideId,insideId]);expect(BigInt(delivered.cursor)).toBeGreaterThan(BigInt(commits[0].cursor));
      // The inside event is a committed cursor barrier after the outside event;
      // no sleep-based guess is needed to assert that outside was filtered.
      expect(capture.events.some(e=>e.type==='sensor.reading'&&(e.payload as ValidatedObservation).id===outsideId)).toBe(false);
      expect(capture.events.filter(e=>e.eventId===delivered.eventId)).toHaveLength(1);
      disconnectedCursor=delivered.cursor;expect(capture.errors).toEqual([]);
    }finally{await closeSocket(capture.socket);}

    const missedOutside=await sendReading(outside,23),missedInside=await sendReading(inside,24);
    const reconnect=await socketCapture(query+'&cursor='+encodeURIComponent(disconnectedCursor));
    try{
      expect(reconnect.events.some(e=>e.type==='resync.required')).toBe(true);
      const snapshotEnvelope=reconnect.events.find(e=>e.type==='snapshot')!,snapshot=snapshotEnvelope.payload as Snapshot;
      expect(BigInt(snapshotEnvelope.cursor)).toBeGreaterThan(BigInt(disconnectedCursor));
      expect(snapshot.readings.some(r=>r.id===missedInside&&r.values.temperatureC===24)).toBe(true);
      expect(snapshot.readings.some(r=>r.id===missedOutside||r.sensorId===outside.sensor.id)).toBe(false);
      expect(snapshot.sensors.some(s=>s.id===outside.sensor.id)).toBe(false);
      const subsequent=await sendReading(inside,25);
      await expect.poll(()=>reconnect.events.some(e=>e.type==='sensor.reading'&&(e.payload as ValidatedObservation).id===subsequent),{timeout:10000}).toBe(true);
      const delivered=reconnect.events.find(e=>e.type==='sensor.reading'&&(e.payload as ValidatedObservation).id===subsequent)!;
      expect(BigInt(delivered.cursor)).toBeGreaterThan(BigInt(snapshotEnvelope.cursor));expect(reconnect.events.filter(e=>e.eventId===delivered.eventId)).toHaveLength(1);
      expect(reconnect.errors).toEqual([]);
    }finally{await closeSocket(reconnect.socket);}
  },45000);
});
