/** Reproduces the real-browser saved-frontier fixture without changing servers or provider data. */
import {createSampleEnvironment} from '@dryspell/data-sources';
import {fixture} from './test-fixture';
import {createSimulationSession,cellCenter,checksum} from './index';
const e=createSampleEnvironment(),{s}=fixture(),g=e.landscape;
const cell=g.cells.findIndex((c,i)=>c.burnable&&c.cover==='grass'&&i%g.width>g.width*.4&&i%g.width<g.width*.6&&Math.floor(i/g.width)>g.height*.4&&Math.floor(i/g.width)<g.height*.6);
s.config.durationSec=21600;s.environmentId=e.id;s.startTime=e.weather.validAt;s.sensors=s.sensors.slice(0,1);s.sensors[0].location=cellCenter(g,cell);s.ignitions=[{id:'fire',location:cellCenter(g,cell),timeSec:0}];
e.weather.samples=[0,21600].map(timeSec=>({timeSec,temperatureC:25,humidityPct:40,windSpeedMps:4,windFromDeg:270,precipitationMm:0}));
const started=performance.now(),session=createSimulationSession(s,e),initialMs=performance.now()-started,runStart=performance.now(),history=[];
let fullFrames=0,at300='';
for(let time=0;time<=21600;time+=5){let tick;while(!tick)tick=session.prepareReadings(time,1);history.push(...tick.readings);if(time===300){at300=session.frameAt(time).checksum;fullFrames++;}}
const final=session.frameAt(21600);fullFrames++;const runMs=performance.now()-runStart,historyChecksum=checksum(history),rewind=session.frameAt(300),replayed=session.frameAt(21600);
const expected={at300:'6d2d0f0a817f2e406402212b75e097c6b61bc21b580bde19d98a456bafe6bf6d',final:'085b31f0a4e22395626794d80ddfd18eb27634600cb422ec839df914859e35ef',history:'673b0568ff1894741c0bb8873b288ba60a66d82acb1920b08038fb7875e852cc'};
if(at300!==expected.at300||final.checksum!==expected.final||historyChecksum!==expected.history||rewind.checksum!==at300||replayed.checksum!==final.checksum)throw new Error('Measured pre-optimization outputs differ');
console.log(JSON.stringify({runtime:'Node; prepared terrain and deterministic external weather fixture; not browser evidence',cell,gridCells:g.cells.length,sensors:1,initialMs,runMs,readings:history.length,fullFramesDuringReconstruction:fullFrames,at300,finalChecksum:final.checksum,historyChecksum,replayIdentical:true,rssBytes:process.memoryUsage().rss},null,2));session.dispose();
