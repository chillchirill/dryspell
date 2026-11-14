/** Bounded-preparation diagnostic; declaring a long run does not pretend it was completed. */
import {createSampleEnvironment} from '@dryspell/data-sources';
import {createSimulationSession,cellCenter} from './index';
import {fixture} from './test-fixture';
const e=createSampleEnvironment(),{s}=fixture(),g=e.landscape,centre=Math.floor(g.height/2)*g.width+Math.floor(g.width/2);
const ignition=[...g.cells.keys()].filter(i=>g.cells[i].burnable&&g.cells[i].cover!=='unknown').sort((a,b)=>Math.abs(a%g.width-centre%g.width)+Math.abs(Math.floor(a/g.width)-Math.floor(centre/g.width))-Math.abs(b%g.width-centre%g.width)-Math.abs(Math.floor(b/g.width)-Math.floor(centre/g.width)))[0];
s.environmentId=e.id;s.startTime=e.weather.validAt;s.config.durationSec=1e12;s.ignitions=[{id:'long-run',location:cellCenter(g,ignition),timeSec:0}];s.sensors.forEach(sensor=>sensor.location=cellCenter(g,ignition));
e.weather.samples.push({...e.weather.samples.at(-1)!,timeSec:s.config.durationSec});
const started=performance.now(),session=createSimulationSession(s,e),frame=session.frameAt(5);
console.log(JSON.stringify({runtime:'Node diagnostic',weather:'prepared synthetic weather; explicitly held constant after prepared forecast',gridCells:g.cells.length,declaredDurationSec:s.config.durationSec,actuallyComputedSensorTimeSec:frame.timeSec,initializationAndFirstTickMs:performance.now()-started,retainedSensorCheckpoints:session.checkpointCount,rssBytes:process.memoryUsage().rss},null,2));session.dispose();
