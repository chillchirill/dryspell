// Local integration check. Synthetic telemetry goes only to a loopback fixture.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocket,WebSocketServer} from 'ws';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=http.createServer();await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
const feed=new WebSocketServer({server:fixture});let upstreamMessages=0;
feed.on('connection',client=>{
  client.on('message',()=>upstreamMessages++);
  client.send(JSON.stringify({deviceId:'hosting-qa',temperatureC:21.5,recordedAt:new Date().toISOString()}));
});
async function freePort(){const s=http.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
process.env.PORT=String(await freePort());process.env.BACKEND_PORT=String(await freePort());
process.env.TELEMETRY_UPSTREAM='ws://127.0.0.1:'+fixture.address().port+'/ws';
process.env.PYTHON_BIN=path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const {shutdown}=await import('./gateway.mjs');
const base='http://127.0.0.1:'+process.env.PORT;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
  let ready=false;
  for(let i=0;i<120;i++){try{if((await fetch(base+'/healthz')).status===200){ready=true;break;}}catch{}await delay(250);}
  assert(ready,'Hosting backend did not become ready');
  for(const route of ['/','/climate_map.html']){
    const r=await fetch(base+route);assert.equal(r.status,200);assert((await r.text()).includes('<title>DrySpell</title>'));
  }
  assert.equal((await fetch(base+'/.env')).status,404);
  const history=await (await fetch(base+'/api/history')).json();assert.equal(history.metadata.months.length,312);
  const env=await (await fetch(base+'/api/simulation/environment?site=ireland-3')).json();
  const run=await fetch(base+'/api/simulation/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    siteId:'ireland-3',weatherMode:'forecast_wind',ignition:env.defaultIgnition,sensors:[],durationSec:1800,windSpeedMps:3,windFromDeg:180})});
  assert.equal(run.status,200);const result=await run.json();assert.equal(result.frames.length,61);assert.equal(result.weatherMode,'forecast_wind');
  const client=new WebSocket(base.replace('http:','ws:')+'/ws/telemetry',{origin:base});
  const reading=await new Promise((resolve,reject)=>{client.once('message',m=>resolve(JSON.parse(m)));client.once('error',reject);});
  assert.equal(reading.temperatureC,21.5);client.send('browser must not write to hardware');await delay(250);assert.equal(upstreamMessages,0);client.close();
  console.log('Hosting gateway passed: pages, 312-month calendar, cached-GFS simulation (61 frames), telemetry forwarding and read-only relay');
  for(const c of feed.clients)c.terminate();feed.close();fixture.close();shutdown(0);
}catch(error){console.error(error.stack);for(const c of feed.clients)c.terminate();feed.close();fixture.close();shutdown(1);}
