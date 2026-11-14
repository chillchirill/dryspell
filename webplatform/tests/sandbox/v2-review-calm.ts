import { weatherAt } from '../../packages/simulation/src/index.ts';
const sample={timeSec:0,temperatureC:25,humidityPct:40,windSpeedMps:0,windFromDeg:270,precipitationMm:0};
const snapshot={id:'review-calm',validAt:'2026-11-14T00:00:00Z',issuedAt:'2026-11-14T00:00:00Z',samples:[sample,{...sample,timeSec:21600}],provenance:[],stale:false};
console.log(JSON.stringify([0,5,10].map(t=>weatherAt(snapshot,t))));
