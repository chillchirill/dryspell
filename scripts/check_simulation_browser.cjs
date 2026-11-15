const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function checkSimulation({evaluate,wait,send,out,mobile=false}) {
  const probabilities=await evaluate('JSON.stringify(D.p)');
  await evaluate('document.getElementById("simulation-open").click()');
  await wait('window.FireSimulation.getState().ready');
  assert.equal((await evaluate('window.FireSpreadLayer.getState()')).visibleArrows,0);
  assert(await evaluate('getComputedStyle(document.getElementById("panel")).display === "none"'));
  if(mobile) {
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'));
    assert(await evaluate('(()=>{const p=document.getElementById("simulation-panel").getBoundingClientRect(),t=document.getElementById("simulation-clock").getBoundingClientRect();return p.bottom<t.top && p.left>=0 && p.right<=innerWidth && t.bottom<=innerHeight;})()'));
    const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'simulation_mobile.png'),Buffer.from(shot.data,'base64'));
    await evaluate('window.FireSimulation.close()');return;
  }
  await evaluate('document.getElementById("sim-demo").click();document.getElementById("sim-run").click()');
  await wait('window.FireSimulation.getState().frames === 121');
  assert.equal((await evaluate('window.FireSimulation.getState()')).weatherMode,'forecast_wind');
  assert((await evaluate('window.FireSimulation.getState()')).forecastWind?.cycleUTC);
  await evaluate('document.getElementById("sim-play").click()');
  assert.equal((await evaluate('window.FireSimulation.getState()')).playing,false);
  const seek=async t=>evaluate(`document.getElementById('sim-time-slider').value=${t};document.getElementById('sim-time-slider').dispatchEvent(new Event('input'))`);
  await seek(1800);
  const middle=await evaluate('JSON.stringify(window.FireSimulation.getState().frame)');
  assert(JSON.parse(middle).burnedCells.length>0);
  assert.equal(JSON.parse(middle).readings[0].values.humidityPct,undefined,'Temperature-only profile must not invent humidity');
  await seek(3600);await seek(1800);
  assert.equal(await evaluate('JSON.stringify(window.FireSimulation.getState().frame)'),middle,'Rewind must reproduce the same calculated frame');
  const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'simulation_desktop.png'),Buffer.from(shot.data,'base64'));
  await evaluate('document.getElementById("sim-clear").click();document.getElementById("sim-ignite").click();map.fire("click",{latlng:L.latLng(0,0)});void 0');
  assert.equal((await evaluate('window.FireSimulation.getState()')).ignition,null);
  await evaluate(`(async()=>{const e=await (await fetch('/api/simulation/environment')).json();const i=e.cover.indexOf('water');if(i<0)throw new Error('Fixture lacks water');map.fire('click',{latlng:L.latLng(e.bounds.south+(Math.floor(i/e.width)+.5)/e.height*(e.bounds.north-e.bounds.south),e.bounds.west+(i%e.width+.5)/e.width*(e.bounds.east-e.bounds.west))});})()`);
  assert.equal((await evaluate('window.FireSimulation.getState()')).ignition,null,'Water ignition must be rejected');
  await evaluate(`(()=>{const p=window.FireSimulation.getState().defaultIgnition;map.fire('click',{latlng:L.latLng(p.latitude,p.longitude)});document.getElementById('sim-sensor').click();map.fire('click',{latlng:L.latLng(p.latitude,p.longitude)});})()`);
  assert.equal((await evaluate('window.FireSimulation.getState()')).sensors.length,1);
  await evaluate('document.getElementById("sim-weather-mode").value="manual";document.getElementById("sim-weather-mode").dispatchEvent(new Event("change"));document.getElementById("sim-from").value="90";document.getElementById("sim-from").dispatchEvent(new Event("input"));document.getElementById("sim-run").click()');
  await wait('window.FireSimulation.getState().frames === 121');
  await evaluate('document.getElementById("sim-play").click()');await seek(1800);
  const opposite=await evaluate('JSON.stringify(window.FireSimulation.getState().frame.burnedCells)');
  assert.notEqual(opposite,JSON.stringify(JSON.parse(middle).burnedCells),'Changing wind must affect the calculated spread');
  assert.equal(await evaluate('JSON.stringify(D.p)'),probabilities);
  await evaluate('window.FireSimulation.openSite("glendalough")');
  assert.equal((await evaluate('window.FireSimulation.getState()')).frames,0,'Switching back to forecast wind must discard the manual run');
  assert.equal((await evaluate('window.FireSimulation.getState()')).weatherMode,'forecast_wind');
  const areas=await evaluate('window.FireSimulation.getState().sites.filter(s=>s.id!=="glendalough")');
  assert.equal(areas.length,7);assert(areas.every(s=>s.available));
  for(const site of areas) {
    await evaluate(`(()=>{const host=document.createElement('div');host.innerHTML=window.FireSimulation.buttonFor(${site.latitude},${site.longitude});const button=host.querySelector('button');if(!button)throw new Error('Missing forecast simulation button');button.click();})()`);
    await wait(`window.FireSimulation.getState().ready && window.FireSimulation.getState().siteId === ${JSON.stringify(site.id)}`);
    assert.equal((await evaluate('window.FireSimulation.getState()')).weatherMode,'forecast_wind');
  }
  await evaluate('document.getElementById("sim-run").click()');await wait('window.FireSimulation.getState().frames === 121');
  await evaluate('document.getElementById("sim-play").click()');await seek(1800);
  const seven=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'simulation_seven_sites.png'),Buffer.from(seven.data,'base64'));
  await evaluate('window.FireSimulation.close()');
  await wait('window.FireSpreadLayer.getState().visibleArrows > 0');
  console.log('Ireland simulation: actual engine run, wind response, water/out-of-area rejection, virtual sensor placement, replay, and forecast restoration passed');
};
