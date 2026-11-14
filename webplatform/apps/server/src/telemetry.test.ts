import {describe,it,expect} from 'vitest';
import {telemetrySchema} from './telemetry.ts';
import {makeSensor} from './domain.ts';
describe('real telemetry boundary',()=>{
  it('accepts numerical zeros, inclusive percentages, and independent boolean false',()=>{expect(telemetrySchema.parse({deviceId:'sensor-a',temperatureC:0,humidityPct:100,smokePct:0,smoke:false}).smokePct).toBe(0);expect(telemetrySchema.parse({deviceId:'smoke-device',smoke:false}).smoke).toBe(false);});
  it('keeps absent channels absent',()=>expect(telemetrySchema.parse({deviceId:'sensor-a',smokePct:0})).not.toHaveProperty('temperatureC'));
  it('persists valid simulated faults and rejects real-device injection',()=>{const input={name:'Fault demonstration',profileId:'temperature',location:{longitude:0,latitude:0},simulationFaults:[{type:'dropout',startTimeSec:10,endTimeSec:20,channels:['temperatureC']}]};expect(makeSensor(input,'simulated').simulationFaults).toHaveLength(1);expect(()=>makeSensor(input,'real')).toThrow('only available for simulated');expect(()=>makeSensor({...input,simulationFaults:[{type:'delay',startTimeSec:10,endTimeSec:20}]},'simulated')).toThrow();expect(()=>makeSensor({...input,simulationFaults:[{type:'dropout',startTimeSec:10,endTimeSec:20,channels:['smokePct']}]},'simulated')).toThrow('supported by this profile');});
  it.each([{deviceId:'a'}, {deviceId:'a',smokePct:101},{deviceId:'a',humidityPct:-1},{deviceId:'a',temperatureC:NaN},{deviceId:'a',temperatureC:Infinity},{deviceId:'a',temperatureC:25,source:'simulated'},{deviceId:'a',temperatureC:25,location:{latitude:0,longitude:0}}])('rejects invalid or unauthorized packet shape %j',packet=>expect(()=>telemetrySchema.parse(packet)).toThrow());
});
