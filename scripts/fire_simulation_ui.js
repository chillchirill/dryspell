/* Glendalough-only scenario on the existing Leaflet map. No live readings are changed. */
(() => {
  'use strict';
  const el=id=>document.getElementById(id);
  const style=document.createElement('style');
  style.textContent=`
    #simulation-panel[hidden],#simulation-clock[hidden]{display:none!important}
    body.simulation-view #panel,body.simulation-view #iot{display:none!important}
    #simulation-panel{width:320px}
    #simulation-panel .sim-tag{color:var(--hot);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
    #simulation-panel .sim-actions{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
    #simulation-panel button[aria-pressed=true]{border-color:var(--hot);color:var(--hot)}
    #simulation-panel .sim-reading{padding:5px 0;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}
    #simulation-panel .sim-reading strong{display:block}
    #sim-status{min-height:38px;margin-top:8px}
    #sim-stat{font-size:17px;margin:8px 0}
    #simulation-clock{position:absolute;z-index:1001;left:350px;right:20px;bottom:20px;max-width:660px;margin:auto;padding:12px 16px;background:var(--panel);border:1px solid var(--line);border-radius:8px}
    #simulation-clock .sim-clock-row{display:flex;align-items:center;gap:12px}
    #simulation-clock output{font-size:20px;font-variant-numeric:tabular-nums}
    #simulation-clock label{margin-left:auto}
    #simulation-clock button{min-width:65px}
    .sim-sensor-label{font-size:11px;padding:1px 4px;background:#17252e;color:#b6edff;border-color:#38bdf8;box-shadow:none}
    #sim-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;margin-top:6px}
    #sim-legend i{display:inline-block;width:10px;height:10px;margin-right:4px}
    body.simulation-picking #map{cursor:crosshair}
    @media(max-width:700px){#simulation-panel{top:8px;left:8px;right:8px;width:auto;max-height:45%}#simulation-clock{left:8px;right:8px;bottom:22px;padding:10px}.sim-clock-row{flex-wrap:wrap}}
  `;
  document.head.append(style);
  const panel=document.createElement('aside');panel.className='panel';panel.id='simulation-panel';panel.hidden=true;
  panel.innerHTML=`<div class="head"><div><div class="sim-tag">What-if scenario · Ireland</div><h1>Glendalough fire simulation</h1><div class="sub">Prepared 5 × 5 km area · 25 m cells</div></div><button class="collapse" id="sim-close" aria-label="Return to forecast">×</button></div>
    <div class="body"><section>
      <div class="hint">Real terrain and land cover. Synthetic dry summer weather. This is an illustrative scenario, not a current fire or a validated forecast.</div>
      <div class="sim-actions"><button class="btn" id="sim-demo">Demo setup</button><button class="btn" id="sim-focus">Find area</button><button class="btn" id="sim-clear">Clear objects</button></div>
      <div class="sim-actions"><button class="btn" id="sim-ignite" aria-pressed="false">Place ignition</button><button class="btn" id="sim-sensor" aria-pressed="false">Place virtual sensor</button></div>
      <div class="field"><label for="sim-profile">Sensor profile</label><select id="sim-profile"><option value="temperature">Temperature only</option><option value="combined">Temperature, RH &amp; smoke</option></select></div>
      <div class="hint">Click inside the outlined area. Up to 8 virtual sensors. The fire cannot start on water or unknown terrain.</div>
    </section><section>
      <h2>Scenario weather</h2><div class="hint">27 °C · 35% RH · no rain. Constant conditions for this run; not live weather.</div>
      <label for="sim-wind">Wind speed: <output id="sim-wind-value">4</output> m/s</label><input type="range" id="sim-wind" min="0" max="15" step="1" value="4">
      <div class="field"><label for="sim-from">Wind from</label><select id="sim-from"><option value="270">West → east</option><option value="225">Southwest → northeast</option><option value="180">South → north</option><option value="90">East → west</option><option value="0">North → south</option></select></div>
      <div class="field"><label for="sim-duration">Duration</label><select id="sim-duration"><option value="1800">30 minutes</option><option value="3600" selected>1 hour</option><option value="10800">3 hours</option></select></div>
      <button class="btn primary" id="sim-run">Calculate &amp; play</button>
      <div id="sim-status" role="status">Loading prepared terrain…</div>
      <div id="sim-stat"></div>
      <div id="sim-legend"><span><i style="background:#ff762d"></i>Burning</span><span><i style="background:#6a3040"></i>Burned</span><span><i style="background:#38bdf8"></i>Virtual sensor</span></div>
    </section><section><h2>Virtual sensor readings</h2><div class="hint">Calculated at the displayed simulation time. Separate from real controllers.</div><div id="sim-readings"></div></section>
    <section><details><summary>Terrain, sources &amp; limits</summary><div id="sim-sources" class="hint"></div><p class="hint">ESA WorldCover 2021 and Copernicus DSM. Fuel assumptions and sensor responses are illustrative. No suppression or reliable fire-front uncertainty is modelled.</p></details></section></div>`;
  document.body.append(panel);
  const clock=document.createElement('div');clock.id='simulation-clock';clock.hidden=true;
  clock.innerHTML=`<div class="sim-clock-row"><button class="btn" id="sim-play" disabled>Play</button><output id="sim-time">00:00</output><span class="hint">elapsed</span><label for="sim-speed">Speed</label><select id="sim-speed"><option value="30">30×</option><option value="120" selected>120×</option><option value="600">600×</option></select></div><input id="sim-time-slider" type="range" min="0" max="3600" step="30" value="0" disabled aria-label="Simulation elapsed time"><div class="hint">Replay calculated frames · 30-second display steps</div>`;
  document.body.append(clock);
  let active=false,environment=null,view=null,layer=null,terrain=null,fire=null,markerLayer=null;
  let ignition=null,sensors=[],result=null,playing=false,cursor=0,lastFrame=-1,lastTick=0,pick=null,busy=false,generation=0,abort=null;
  let savedSensorVisibility=false;
  const simPane=map.createPane('simulation');simPane.style.zIndex=450;simPane.style.pointerEvents='none';
  const simMarkers=map.createPane('simulationObjects');simMarkers.style.zIndex=630;
  const palette={grass:[154,171,104],woodland:[53,107,68],scrub:[117,139,92],water:[63,141,186],built:[148,148,148],unknown:[83,87,92]};
  const message=text=>{el('sim-status').textContent=text;};
  const coordinate=ll=>({longitude:ll.lng,latitude:ll.lat});
  const bounds=()=>[[environment.bounds.south,environment.bounds.west],[environment.bounds.north,environment.bounds.east]];
  function index(point) {
    if(!environment)return -1;
    const b=environment.bounds;
    if(point.longitude<b.west||point.longitude>=b.east||point.latitude<b.south||point.latitude>=b.north)return -1;
    const x=Math.floor((point.longitude-b.west)/(b.east-b.west)*environment.width);
    const y=Math.floor((point.latitude-b.south)/(b.north-b.south)*environment.height);
    return y*environment.width+x;
  }
  function image(colors) {
    const canvas=document.createElement('canvas');canvas.width=environment.width;canvas.height=environment.height;
    const context=canvas.getContext('2d'),pixels=context.createImageData(canvas.width,canvas.height);
    for(let i=0;i<environment.cover.length;i++) {
      const color=colors(i);if(!color)continue;
      const offset=((environment.height-1-Math.floor(i/environment.width))*environment.width+i%environment.width)*4;
      pixels.data.set(color,offset);
    }
    context.putImageData(pixels,0,0);return canvas.toDataURL('image/png');
  }
  function focus() {
    if(!environment)return;
    map.fitBounds(bounds(),{paddingTopLeft:phone.matches?[20,Math.round(map.getSize().y*.46)]:[350,25],
      paddingBottomRight:[25,130],animate:false});
  }
  function pickingMode(value) {
    pick=value;document.body.classList.toggle('simulation-picking',!!value);
    el('sim-ignite').setAttribute('aria-pressed',String(value==='ignition'));
    el('sim-sensor').setAttribute('aria-pressed',String(value==='sensor'));
  }
  function stop() {playing=false;el('sim-play').textContent='Play';}
  function invalidate() {
    stop();result=null;cursor=0;lastFrame=-1;generation++;abort?.abort();abort=null;busy=false;
    el('sim-run').disabled=false;el('sim-play').disabled=true;el('sim-time-slider').disabled=true;
    el('sim-time-slider').value=0;el('sim-time').textContent='00:00';el('sim-stat').textContent='';
    if(fire){layer.removeLayer(fire);fire=null;}renderObjects();
  }
  function renderObjects() {
    if(!markerLayer)return;markerLayer.clearLayers();
    if(ignition)L.circleMarker([ignition.latitude,ignition.longitude],{pane:'simulationObjects',radius:8,color:'#fff',weight:2,fillColor:'#ff762d',fillOpacity:1,bubblingMouseEvents:false})
      .bindTooltip('Scenario ignition',{direction:'top'}).addTo(markerLayer);
    const frame=result?.frames[Math.max(0,lastFrame)];
    el('sim-readings').replaceChildren();
    sensors.forEach((sensor,i)=>{
      const reading=frame?.readings.find(r=>r.sensorId==='virtual-'+i),v=reading?.values;
      const parts=[`Temperature: ${v?.temperatureC===undefined?'—':v.temperatureC.toFixed(1)+' °C'}`];
      if(sensor.profileId==='combined')parts.push(`RH: ${v?.humidityPct===undefined?'—':v.humidityPct.toFixed(1)+'%'}`,`Smoke: ${v?.smokePct===undefined?'—':v.smokePct.toFixed(1)+'% index'}`);
      const marker=L.circleMarker([sensor.latitude,sensor.longitude],{pane:'simulationObjects',radius:6,color:'#fff',weight:2,fillColor:'#38bdf8',fillOpacity:1,bubblingMouseEvents:false}).addTo(markerLayer);
      marker.bindTooltip('V'+(i+1),{permanent:true,direction:['left','bottom','right'][i%3],className:'sim-sensor-label'});
      marker.bindPopup(`<b>Virtual sensor ${i+1}</b><br>${parts.join('<br>')}<br><small>Simulated readings at the selected time.</small>`);
      const row=document.createElement('div');row.className='sim-reading';
      const title=document.createElement('strong');title.textContent='V'+(i+1)+' · '+(sensor.profileId==='combined'?'Combined':'Temperature');row.append(title,document.createTextNode(parts.join(' · ')));
      const remove=document.createElement('button');remove.className='btn';remove.textContent='Remove';remove.setAttribute('aria-label','Remove virtual sensor '+(i+1));remove.style.marginLeft='6px';
      remove.onclick=()=>{sensors.splice(i,1);invalidate();message('Sensor removed. Recalculate the scenario.');};row.append(remove);el('sim-readings').append(row);
    });
    if(!sensors.length)el('sim-readings').textContent='Place virtual sensors or use Demo setup.';
  }
  function demo() {
    if(!environment)return;invalidate();ignition={...environment.defaultIgnition};
    // Positions are inside the prepared grid; they are explicitly simulated devices.
    const b=environment.bounds,dx=(b.east-b.west)/environment.width,dy=(b.north-b.south)/environment.height;
    sensors=[{...ignition,profileId:'temperature'},
      {longitude:ignition.longitude+dx*8,latitude:ignition.latitude,profileId:'temperature'},
      {longitude:ignition.longitude+dx*18,latitude:ignition.latitude+dy*4,profileId:'combined'}];
    pickingMode(null);renderObjects();message('Demo ready: one ignition and three virtual sensors. Calculate to begin.');
  }
  function draw(time) {
    if(!result)return;
    cursor=Math.max(0,Math.min(time,result.durationSec));const n=Math.min(result.frames.length-1,Math.floor(cursor/30));
    el('sim-time-slider').value=String(n*30);
    const seconds=n*30;el('sim-time').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
    if(n===lastFrame)return;lastFrame=n;
    const f=result.frames[n],burning=new Set(f.burningCells),burned=new Set(f.burnedCells);
    const url=image(i=>burning.has(i)?[255,118,45,245]:burned.has(i)?[106,48,64,220]:null);
    if(!fire)fire=L.imageOverlay(url,bounds(),{pane:'simulation',interactive:false}).addTo(layer);else fire.setUrl(url);
    const area=(burning.size+burned.size)*environment.cellSizeM**2/10000;
    el('sim-stat').textContent=`${area.toFixed(1)} ha reached · ${burning.size} burning cells`;
    renderObjects();
  }
  function play() {if(!result)return;if(cursor>=result.durationSec)draw(0);playing=true;lastTick=performance.now();el('sim-play').textContent='Pause';}
  function tick(now) {
    if(active&&playing&&result) {const dt=Math.min((now-lastTick)/1000,.25);draw(cursor+dt*Number(el('sim-speed').value));if(cursor>=result.durationSec){stop();message('Scenario complete. Rewind to inspect earlier frames.');}}
    lastTick=now;requestAnimationFrame(tick);
  }
  async function calculate() {
    if(!ignition){message('Place an ignition on burnable terrain first.');return;}
    invalidate();pickingMode(null);busy=true;const token=generation,controller=new AbortController();abort=controller;
    el('sim-run').disabled=true;message('Calculating spread and virtual sensor responses…');
    try {
      const response=await fetch('/api/simulation/run',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
        body:JSON.stringify({ignition,sensors,durationSec:Number(el('sim-duration').value),windSpeedMps:Number(el('sim-wind').value),windFromDeg:Number(el('sim-from').value)})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Simulation unavailable');
      if(token!==generation||!active)return;
      result=data;ignition=data.ignition;sensors=data.sensors.map(s=>({...s.location,profileId:s.profileId}));
      el('sim-time-slider').max=data.durationSec;el('sim-time-slider').disabled=false;el('sim-play').disabled=false;
      lastFrame=-1;draw(0);message('Calculated scenario · dry summer conditions · virtual readings.');play();
    }catch(error){if(error.name!=='AbortError'&&token===generation)message(error.message);}
    finally{if(token===generation){busy=false;el('sim-run').disabled=false;}}
  }
  async function open() {
    if(active)return;
    if(window.FireHistory?.isActive())window.FireHistory.close();
    view={center:map.getCenter(),zoom:map.getZoom()};active=true;panel.hidden=false;clock.hidden=false;
    document.body.classList.add('simulation-view');setPlaying(false,true);setPicking(false);map.closePopup();map.removeLayer(hl);
    pane.style.visibility='hidden';el('timebar').style.visibility='hidden';savedSensorVisibility=map.hasLayer(sensorGroup);map.removeLayer(sensorGroup);
    window.FireSpreadLayer?.refresh();
    try {
      if(!environment){const response=await fetch('/api/simulation/environment');if(!response.ok)throw new Error('Open this map through the updated local dashboard server to run the simulation.');environment=await response.json();}
      if(!active)return;
      if(!layer){layer=L.layerGroup();markerLayer=L.layerGroup().addTo(layer);
        terrain=L.imageOverlay(image(i=>[...palette[environment.cover[i]],170]),bounds(),{pane:'simulation',interactive:false}).addTo(layer);
        L.rectangle(bounds(),{pane:'simulation',color:'#ffd27f',weight:2,fill:false,interactive:false}).addTo(layer);
        el('sim-sources').textContent=environment.provenance.map(p=>p.attribution+' · '+p.version).join(' | ');demo();}
      layer.addTo(map);focus();
    }catch(error){message(error.message);}
  }
  function close() {
    if(!active)return;stop();generation++;abort?.abort();busy=false;el('sim-run').disabled=false;active=false;pickingMode(null);
    panel.hidden=true;clock.hidden=true;document.body.classList.remove('simulation-view');if(layer)map.removeLayer(layer);map.closePopup();
    if(savedSensorVisibility)sensorGroup.addTo(map);pane.style.visibility='';el('timebar').style.visibility='';applyOverlays();
    if(view)map.setView(view.center,view.zoom,{animate:false});window.FireSpreadLayer?.refresh();
  }
  map.on('click',event=>{
    if(!active||!environment)return;
    const point=coordinate(event.latlng),i=index(point);
    if(i<0){message('Choose a point inside the outlined Glendalough area.');return;}
    if(pick==='ignition'){
      if(!environment.burnable[i]){message('This cell is water, built or unknown terrain. Choose a burnable cell.');return;}
      invalidate();ignition=point;pickingMode(null);renderObjects();message('Ignition placed. Calculate to run the scenario.');
    }else if(pick==='sensor'){
      if(sensors.length>=8){message('Maximum 8 virtual sensors. Remove one to add another.');return;}
      invalidate();sensors.push({...point,profileId:el('sim-profile').value});pickingMode(null);renderObjects();message('Virtual sensor placed. Recalculate to see its response.');
    }else{
      const elevation=environment.elevationM[i];
      message(`${environment.cover[i]} · elevation ${elevation===null?'unknown':elevation.toFixed(0)+' m'} · ${environment.burnable[i]?'burnable':'not burnable'} in this scenario`);
    }
  });
  el('simulation-open').onclick=open;el('sim-close').onclick=close;el('sim-focus').onclick=focus;el('sim-demo').onclick=demo;
  el('sim-ignite').onclick=()=>{pickingMode(pick==='ignition'?null:'ignition');message('Click burnable terrain inside the outlined area.');};
  el('sim-sensor').onclick=()=>{pickingMode(pick==='sensor'?null:'sensor');message('Click inside the area to place a virtual sensor.');};
  el('sim-clear').onclick=()=>{invalidate();ignition=null;sensors=[];pickingMode(null);renderObjects();message('Place an ignition and virtual sensors, or choose Demo setup.');};
  el('sim-run').onclick=calculate;el('sim-play').onclick=()=>playing?stop():play();
  el('sim-time-slider').oninput=e=>{stop();draw(Number(e.target.value));};
  for(const id of ['sim-wind','sim-from','sim-duration'])el(id).oninput=()=>{el('sim-wind-value').textContent=el('sim-wind').value;invalidate();message('Scenario inputs changed. Calculate again.');};
  window.FireSimulation={open,close,isActive:()=>active,getState:()=>({active,ready:!!environment,busy,playing,
    duration:result?.durationSec||0,timeSec:lastFrame<0?0:lastFrame*30,frames:result?.frames.length||0,
    ignition,sensors:sensors.map(s=>({...s})),frame:result?.frames[Math.max(0,lastFrame)]||null,
    bounds:environment?.bounds,defaultIgnition:environment?.defaultIgnition})};
  requestAnimationFrame(tick);
})();
