import 'dotenv/config';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const base=process.env.BASE_URL??'http://127.0.0.1:4000';
for(const path of ['/health/live','/health/ready','/','/map/replay']){
  const response=await fetch(base+path);assert.equal(response.status,200,path);
  if(path.includes('health'))console.log(path,await response.json());
}
const denied=await fetch(base+'/api/v1/sensors',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
assert.equal(denied.status,401,'Anonymous mutation must fail');
const scenarios=await fetch(base+'/api/v1/scenarios').then(r=>r.json()) as {id:string}[];
assert.ok(scenarios.length,'Prepared scenario missing');
await new Promise<void>((resolve,reject)=>{
  const ws=new WebSocket(base.replace(/^http/,'ws')+'/ws?context=simulation&scenarioId='+scenarios[0].id);
  const timer=setTimeout(()=>{ws.terminate();reject(new Error('No WebSocket snapshot'));},10000);
  ws.on('message',data=>{const event=JSON.parse(String(data));if(event.type==='snapshot'){clearTimeout(timer);ws.close();resolve();}});
  ws.on('error',reject);
});
if(process.env.SMOKE_DEVICE_TOKEN&&process.env.SMOKE_DEVICE_ID){
  const result=await fetch(base+'/api/v1/telemetry',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${process.env.SMOKE_DEVICE_TOKEN}`},body:JSON.stringify({deviceId:process.env.SMOKE_DEVICE_ID,messageId:`smoke-${Date.now()}`,temperatureC:22,humidityPct:0,smokePct:0})});
  assert.ok(result.ok,'Authenticated ingestion failed');
  console.log('Authenticated device ingestion passed');
} else console.log('Authenticated device ingestion skipped: set SMOKE_DEVICE_ID and SMOKE_DEVICE_TOKEN. Covered separately by integration suite.');
console.log('HTTP/static/auth denial/WebSocket smoke checks passed');
