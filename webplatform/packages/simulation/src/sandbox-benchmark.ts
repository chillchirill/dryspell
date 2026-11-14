/** Node diagnostic only; browser entry points do not import this benchmark. */
import { createSampleEnvironment } from '@dryspell/data-sources';
import { createSimulationSession,cellCenter } from './index';
import { fixture } from './test-fixture';
import {validSandboxDuration} from '@dryspell/contracts/sandbox';
const e=createSampleEnvironment(),{s}=fixture(),grid=e.landscape,centre=Math.floor(grid.height/2)*grid.width+Math.floor(grid.width/2);
const ignition=[...grid.cells.keys()].filter(i=>grid.cells[i].burnable&&grid.cells[i].cover!=='unknown').sort((a,b)=>Math.abs(a%grid.width-centre%grid.width)+Math.abs(Math.floor(a/grid.width)-Math.floor(centre/grid.width))-Math.abs(b%grid.width-centre%grid.width)-Math.abs(Math.floor(b/grid.width)-Math.floor(centre/grid.width)))[0];
const horizon=Number(process.argv[2]??21600);if(!validSandboxDuration(horizon,s.startTime))throw new Error('Benchmark duration must use valid positive five-second ticks');
if(e.weather.samples.at(-1)!.timeSec<horizon)e.weather.samples.push({...e.weather.samples.at(-1)!,timeSec:horizon});
s.environmentId=e.id;s.startTime=e.weather.validAt;s.config.durationSec=horizon;s.ignitions=[{id:'sandbox-benchmark-fire',location:cellCenter(grid,ignition),timeSec:0}];
const profiles=structuredClone(s.sensors);s.sensors=Array.from({length:30},(_,i)=>({...structuredClone(profiles[i%4]),id:`bounded-${i}`,deviceId:`bounded-${i}`,location:cellCenter(grid,Math.min(grid.cells.length-1,ignition+i))}));
const start=performance.now(),session=createSimulationSession(s,e),ready=session.frameAt(0),initialMs=performance.now()-start,runStart=performance.now();
let frames=1,observations=ready.readings.length,last=ready;const history=new Map(ready.readings.map(reading=>[reading.id,reading])),buckets=[{time:0,ids:ready.readings.map(reading=>reading.id)}];let head=0;
for(let t=5;t<=horizon;t+=5){last=session.frameAt(t);frames++;observations+=last.readings.length;for(const reading of last.readings)history.set(reading.id,reading);buckets.push({time:t,ids:last.readings.map(reading=>reading.id)});while(buckets[head]?.time<t-21600){for(const id of buckets[head].ids)history.delete(id);head++;}if(head>1024){buckets.splice(0,head);head=0;}}
const runMs=performance.now()-runStart,rewindStart=performance.now(),rewound=session.frameAt(600),rewindMs=performance.now()-rewindStart;
const historyBytes=new TextEncoder().encode(JSON.stringify([...history.values()])).byteLength;
console.log(JSON.stringify({runtime:'Node diagnostic; not browser measurement',weather:'prepared synthetic weather; final sample held beyond supplied horizon; not live Open-Meteo verification',gridCells:grid.cells.length,sensors:s.sensors.length,horizonSec:horizon,frames,observations,retainedObservations:history.size,retainedSensorCheckpoints:session.checkpointCount,historyBytes,initialMs,runMs,rewindMs,finalChecksum:last.checksum,rewindChecksum:rewound.checksum,rssBytes:process.memoryUsage().rss,node:process.version},null,2));session.dispose();
