import {describe,it,expect} from 'vitest';
import {readingState,SENSOR_PROFILES,type Sensor,type ValidatedObservation} from './index.ts';
const sensor:Sensor={id:'s',deviceId:'s',name:'smoke',source:'real',location:{latitude:0,longitude:0},profileId:'smoke',capabilities:SENSOR_PROFILES.smoke.capabilities,expectedIntervalSec:60,enabled:true,tags:[],createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'};
const observation:ValidatedObservation={id:'r',sensorId:'s',source:'real',recordedAt:'2026-01-01T00:00:00Z',receivedAt:'2026-01-01T00:00:01Z',location:sensor.location,locationVersion:1,values:{smokePct:0},quality:[]};
describe('capability and time states',()=>{
  it('separates unsupported, missing, zero and stale without fabricating values',()=>{
    expect(readingState(sensor,observation,'temperatureC',observation.recordedAt).state).toBe('unsupported');
    expect(readingState(sensor,undefined,'smokePct',observation.recordedAt).state).toBe('missing');
    expect(readingState(sensor,observation,'smokePct',observation.recordedAt)).toMatchObject({state:'fresh',value:0});
    expect(readingState(sensor,observation,'smokePct','2026-01-01T00:04:00Z')).toMatchObject({state:'stale',value:0});
  });
});
