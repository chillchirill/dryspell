import { createHash } from 'node:crypto';
import { describe,it,expect } from 'vitest';
import { sha256Bytes,sha256Hex,sha256Uint32LE } from './hash';
import { createSimulationSession,simulateFrame,clearSimulationCache,createCheckpoint } from './index';
import { fixture } from './test-fixture';

describe('browser-compatible deterministic engine',()=>{
  it('preserves UTF-8 SHA-256 bytes, hex and little-endian noise across Node and browser code',()=>{
    for(const text of ['', 'abc','123:sensor-0:25:temperatureC','Dryspell 🌲 é\u0000',JSON.stringify(fixture())]){
      const expected=createHash('sha256').update(text).digest();
      expect([...sha256Bytes(text)]).toEqual([...expected]);expect(sha256Hex(text)).toBe(expected.toString('hex'));expect(sha256Uint32LE(text)).toBe(expected.readUInt32LE(0));
    }
  });
  it('isolated sessions match server frames, faults, checksums and checkpoint replay',()=>{
    const {s,e}=fixture();s.sensors[0].simulationFaults=[{type:'delay',startTimeSec:0,endTimeSec:30,delaySec:20},{type:'dropout',startTimeSec:40,endTimeSec:55,channels:['humidityPct']}];
    const session=createSimulationSession(s,e);
    for(const t of [0,5,20,30,60,120,15,45,300]){
      clearSimulationCache();const expected=simulateFrame(s,e,t),actual=session.frameAt(t);
      expect(actual).toEqual(expected);
      const {checksum,...without}=actual;
      expect(checksum).toBe(createHash('sha256').update(JSON.stringify({...without,checksum:''})).digest('hex'));
    }
    const checkpoint=createCheckpoint(s,e,60);expect(checkpoint.checksum).toBe(createHash('sha256').update(JSON.stringify(checkpoint.state)).digest('hex'));
    session.dispose();expect(()=>session.frameAt(0)).toThrow('disposed');
  });
  it('copies input once and exposes no mutable internal coordinates through frames',()=>{
    const {s,e}=fixture();const expected=structuredClone(simulateFrame(s,e,30)),session=createSimulationSession(s,e);
    s.seed=999;e.weather.samples[0].temperatureC=99;s.sensors[0].location.latitude=55;
    const frame=session.frameAt(30);expect(frame).toEqual(expected);expect(Object.isFrozen(frame.readings[0].location)).toBe(true);
    frame.readings[0].values.temperatureC=-100;expect(session.frameAt(30)).toEqual(expected);
  });
});
