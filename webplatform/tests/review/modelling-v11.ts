import {fixture} from '../../packages/simulation/src/test-fixture.ts';
import {simulateFrame,clearSimulationCache} from '../../packages/simulation/src/index.ts';
import assert from 'node:assert/strict';
const {s,e}=fixture(7);
s.sensors[0].simulationFaults=[{type:'delay',startTimeSec:0,endTimeSec:30,delaySec:20}];
const deliveries:Array<{frame:number;id:string;observed:number;received:string;quality:string[]}>=[];
for(let time=0;time<=60;time+=5){
 for(const o of simulateFrame(s,e,time).readings.filter(o=>o.sensorId===s.sensors[0].id))
 deliveries.push({frame:time,id:o.id,observed:o.simulationTimeSec!,received:o.receivedAt,quality:o.quality});
}
assert.equal(new Set(deliveries.map(o=>o.id)).size,deliveries.length,'No repeated observation identities');
for(let sample=0;sample<=60;sample+=5){
 const matches=deliveries.filter(o=>o.observed===sample);
 assert.equal(matches.length,1,`Sample ${sample} delivered once`);
 assert.equal(matches[0].frame,sample+(sample<30?20:0),'No early or lost queued receipt');
}
assert.equal(deliveries.filter(o=>o.frame===30).length,2,'Current and queued observations coexist');
console.log(JSON.stringify({check:'delay windows postpone every sample without early or duplicate delivery',passed:true,deliveries},null,2));
clearSimulationCache();
