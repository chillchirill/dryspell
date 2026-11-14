const {test} = require('node:test');
const assert = require('node:assert/strict');
const T = require('./fire_telemetry.js');
const now = Date.parse('2026-11-14T14:00:00Z');
const sample = {deviceId:'esp32-01', temperatureC:0, recordedAt:'2026-11-14T13:59:30Z'};

test('direct telemetry preserves zero Celsius and measurement time', () => {
  const r=T.normalize(JSON.stringify(sample),now);
  assert.equal(r.temperatureC,0); assert.equal(r.timeSource,'device');
  assert.equal(r.measuredMs,now-30000); assert.equal(T.status(r,true,now),'Live');
});
test('partner relay supports JSON body, form numbers and GET query fields', () => {
  for (const fields of [{body:sample},{body:JSON.stringify(sample)},
    {query:{device_id:'esp32-01',temperature:'0'}}]) {
    const r=T.normalize({event:'request',time:'2026-11-14T14:00:00Z',...fields},now);
    assert.equal(r.deviceId,'esp32-01'); assert.equal(r.temperatureC,0);
  }
  assert.equal(T.normalize({event:'request',body:{deviceId:'esp32-01',temp:22},time:'2026-11-14T14:00:00Z'},now).timeSource,'server');
  assert.equal(T.normalize({deviceId:'esp32-01',temp:22},now).timeSource,'browser');
});
test('missing data, malformed readings and Fahrenheit are rejected', () => {
  for (const temperatureC of [null,true,{},[],NaN,Infinity,'','bad',-274]) {
    assert.throws(()=>T.normalize({...sample,temperatureC},now));
  }
  for (const x of ['bad JSON',null,[],{temperatureC:20},{...sample,unit:'F'},
    {...sample,deviceId:'<script>'},{...sample,recordedAt:'2026-11-14T14:00:00'},
    {...sample,recordedAt:'2026-11-15T14:00:00Z'},'x'.repeat(65537)]) {
    assert.throws(()=>T.normalize(x,now));
  }
  assert.equal(T.normalize({event:'server_started'},now),null);
});
test('replayed old data stays stale; disconnect does not erase last reading', () => {
  const r=T.normalize({...sample,recordedAt:'2026-11-14T12:00:00Z'},now);
  assert.equal(T.status(r,true,now),'Stale');
  assert.equal(T.status(r,false,now),'Disconnected');
  assert.equal(T.status(null,true,now),'Waiting for data');
  const current=T.normalize(sample,now);
  assert.equal(T.status(current,true,now+T.STALE_MS+1),'Stale');
});
test('browser endpoint policy rejects mixed content and embedded secrets', () => {
  assert.equal(T.endpoint('ws://127.0.0.1:2500/ws'),'ws://127.0.0.1:2500/ws');
  assert.equal(T.endpoint('wss://example.org/ws','https:'),'wss://example.org/ws');
  for(const x of ['https://example.org','ws://u:p@example.org/ws','ws://example.org/ws?token=a']) {
    assert.throws(()=>T.endpoint(x));
  }
  assert.throws(()=>T.endpoint('ws://example.org/ws','https:'));
});
