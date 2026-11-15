// Bounded, offline CLI used by the local dashboard. JSON in / JSON out.
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createSimulationSession, cellIndexAt, cellCenter, ENGINE_VERSION} from '../vendor/irish_simulation/engine.mjs';
import {SENSOR_PROFILES, DEFAULT_SIMULATION_CONFIG} from '../vendor/irish_simulation/contracts.mjs';

try {
  const request=JSON.parse(fs.readFileSync(0,'utf8'));
  const siteId=request.siteId||'glendalough';
  if(siteId!=='glendalough'&&!/^ireland-[0-6]$/.test(siteId))throw new Error('Unknown Ireland simulation site');
  const file=siteId==='glendalough'?'environment.json.gz':'sites/'+siteId+'.json.gz';
  const environment=JSON.parse(gunzipSync(fs.readFileSync(new URL('../vendor/irish_simulation/'+file,import.meta.url))));
  const duration=Number(request.durationSec);
  if (![1800,3600,10800].includes(duration)) throw new Error('Choose 30 minutes, 1 hour or 3 hours');
  if (!Number.isFinite(request.windSpeedMps)||request.windSpeedMps<0||request.windSpeedMps>15||
      !Number.isFinite(request.windFromDeg)||request.windFromDeg<0||request.windFromDeg>=360) throw new Error('Invalid scenario wind');
  function location(point, ignition=false) {
    if (!point||!Number.isFinite(point.longitude)||!Number.isFinite(point.latitude)) throw new Error('Invalid position');
    const index=cellIndexAt(environment.landscape,point);
    if (index<0) throw new Error('Position is outside the selected prepared area');
    const cell=environment.landscape.cells[index];
    if (ignition&&(!cell.burnable||cell.cover==='unknown')) throw new Error('Choose known burnable terrain for ignition');
    return cellCenter(environment.landscape,index);
  }
  const ignition=location(request.ignition,true);
  if (!Array.isArray(request.sensors)||request.sensors.length>8) throw new Error('Use at most 8 virtual sensors');
  // Temperature, humidity and rain are synthetic; wind can use the cached GFS forecast.
  const weather={...environment.weather.samples[0],windSpeedMps:request.windSpeedMps,windFromDeg:request.windFromDeg};
  environment.weather.samples=[{...weather,timeSec:0},{...weather,timeSec:duration}];
  environment.weather.id=siteId+'-user-dry-scenario';
  if (request.forecastWind) {
    environment.weather.samples=request.forecastWind.samples.map(w=>({timeSec:w.timeSec,
      temperatureC:weather.temperatureC,humidityPct:weather.humidityPct,precipitationMm:weather.precipitationMm,
      windSpeedMps:w.windSpeedMps,windFromDeg:w.windFromDeg}));
    environment.weather.validAt=request.forecastWind.issuedAt;
    environment.weather.issuedAt=request.forecastWind.cycleUTC;
    environment.weather.id='cached-gfs-wind-dry-scenario';
  }
  const start=environment.weather.validAt;
  const sensors=request.sensors.map((s,i)=>{
    const profile=SENSOR_PROFILES[s.profileId];
    if (!profile||!['temperature','combined'].includes(s.profileId)) throw new Error('Unsupported virtual sensor profile');
    return {id:'virtual-'+i,deviceId:'virtual-'+i,name:'Virtual sensor '+(i+1),source:'simulated',
      location:location(s),profileId:s.profileId,capabilities:profile.capabilities,expectedIntervalSec:5,
      enabled:true,tags:[],createdAt:start,updatedAt:start};
  });
  const scenario={id:siteId+'-demo',name:environment.name+' dry-weather scenario',revision:1,seed:42,
    startTime:start,environmentId:environment.id,sensors,ignitions:[{id:'ignition',location:ignition,timeSec:0}],
    config:{...DEFAULT_SIMULATION_CONFIG,durationSec:duration},status:'draft',authoritativeTimeSec:0,createdAt:start,updatedAt:start};
  const session=createSimulationSession(scenario,environment),frames=[];
  for (let t=0;t<=duration;t+=30) {
    const f=session.frameAt(t);
    frames.push({timeSec:t,burningCells:f.burningCells,burnedCells:f.burnedCells,
      readings:f.readings.map(r=>({sensorId:r.sensorId,values:r.values,quality:r.quality})),weather:f.weather});
  }
  session.dispose();
  process.stdout.write(JSON.stringify({engineVersion:ENGINE_VERSION,environmentId:environment.id,siteId,
    scenario:true,weatherMode:request.forecastWind?'forecast_wind':'manual',
    weatherSource:request.forecastWind?'Cached NOAA GFS wind; synthetic temperature, humidity and rain':'Synthetic dry summer scenario, not current weather',
    forecastWind:request.forecastWind||null,startTime:start,
    durationSec:duration,frameIntervalSec:30,ignition,sensors,frames}));
} catch (error) {
  process.stderr.write(error.message+'\n');process.exitCode=1;
}
