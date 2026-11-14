import {mountSensors,parseSensorPosition} from './sensors.js';
import {RequestPool,managedTileLayer,releaseTile} from './tiles.js';
import {configureApi,apiUrl} from './api.js';
import {TileImageCache} from './tile-cache.js';
const $=selector=>document.querySelector(selector);
const labels={base:'Reference map',landcover:'Land cover',ecoregions:'Ecological zones'};
const legends={
  base:[],
  landcover:[['#006400','Tree cover'],['#0064c8','Water'],['#ffff4c','Grassland'],['#f096ff','Cropland'],['#ff0000','Built-up'],['#ffbb22','Shrubland']],
  ecoregions:[['#d6b76e','Steppe'],['#9daf63','Forest-steppe'],['#4c8258','Forest regions'],['#bdd180','Other grasslands'],['#b4b6a2','Other regions']]
};
const presets={cherkasy:{center:[49.44,32.06],zoom:11,title:'Cherkasy, Ukraine'},askania:{center:[46.45,33.87],zoom:12,title:'Askania-Nova, Ukraine'},glendalough:{center:[53.005,-6.344],zoom:13,title:'Glendalough, Ireland'}};
const coordinates=c=>`${Math.abs(c.lat).toFixed(4)}° ${c.lat<0?'S':'N'} · ${Math.abs(c.lng).toFixed(4)}° ${c.lng<0?'W':'E'}`;
async function boot(){
  if(!window.L)throw new Error('Map library unavailable. Check the local server.');
  await configureApi();
  const response=await fetch(apiUrl('/api/world'),{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(`Map server HTTP ${response.status}`);
  const world=await response.json(),L=window.L;
  if(world.synthetic)throw new Error('The old synthetic server is still running. Restart this map service to load real geodata.');
  const map=L.map('map',{zoomControl:false,preferCanvas:true,minZoom:world.minZoom,maxZoom:world.maxZoom,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false,wheelDebounceTime:140,maxBounds:[[-85,-180],[85,180]],maxBoundsViscosity:1}).setView(world.center,world.zoom);
  L.control.zoom({position:'topright',zoomInTitle:'Zoom in',zoomOutTitle:'Zoom out'}).addTo(map);
  L.control.scale({position:'bottomleft',imperial:false,maxWidth:110}).addTo(map);
  const base=L.tileLayer(world.basemapUrl,{minZoom:3,maxZoom:19,keepBuffer:0,updateWhenIdle:true,updateWhenZooming:false,noWrap:true,
    attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'}).addTo(map);
  const pool=new RequestPool(),images=new TileImageCache(),stats={loaded:0,aborted:0,errors:0,previews:0,cacheHits:0};
  let overlay,activeLayer='landcover',inspecting=false,inspectController,inspectionMarker,lastSelected=null;
  const status=$('#loading-state');
  function showStatus(text,error=false){status.textContent=text;status.className=`loading-state${error?' error':''}`;}
  function updateStats(){$('#tile-count').textContent=`${document.querySelectorAll('#map .leaflet-tile').length} tiles`;$('#zoom-level').textContent=`Z${map.getZoom()}`;}
  const retry=$('#retry-layer');
  const TileLayer=managedTileLayer(L,pool,stats,updateStats,()=>{showStatus('Some details are unavailable. Cached map retained.',true);retry.hidden=false;},images);
  retry.addEventListener('click',()=>setLayer(activeLayer));
  function updateCoverage(){
    const z=map.getZoom();
    $('#dataset-note').textContent=activeLayer==='landcover'?(z<6?'Zoom in to level 6 to view ESA land cover.':z>14?'Overzoomed 10 m source pixels. Extra zoom does not add detail.':'2021 historical land cover. Classes may differ from today’s landscape.'):
      activeLayer==='ecoregions'?'Regional ecological context, not current field cover. Boundaries are approximate.':'OpenStreetMap geographic reference. Local map labels follow the source language.';
    if(activeLayer==='landcover'&&z<6){showStatus('Zoom in to view land cover');}
    else if(!overlay||!overlay.isLoading())status.className='loading-state ready';
  }
  function setLayer(name){
    if(!Object.hasOwn(labels,name))return;
    retry.hidden=true;
    if(overlay){map.removeLayer(overlay);overlay=null;}
    activeLayer=name;
    if(name!=='base'){
      const config=world.layers.find(layer=>layer.id===name);
      overlay=new TileLayer(apiUrl(`/api/tiles/${name}/{z}/{x}/{y}.png?v=${encodeURIComponent(config.cacheVersion||world.id)}`),{dataLayer:name,minZoom:config.minZoom,maxZoom:19,maxNativeZoom:config.maxNativeZoom,bounds:config.bounds,tileSize:256,keepBuffer:0,updateWhenIdle:true,updateWhenZooming:false,noWrap:true,opacity:Number($('#overlay-opacity').value)/100,
        attribution:name==='landcover'?'<a href="https://esa-worldcover.org/en/data-access" target="_blank">ESA WorldCover 2021</a> / Terrascope · CC BY 4.0':'<a href="https://developers.google.com/earth-engine/datasets/catalog/RESOLVE_ECOREGIONS_2017" target="_blank">RESOLVE 2017</a> · CC BY 4.0'});
      overlay.on('tileunload tileabort',releaseTile);
      overlay.on('loading',()=>showStatus('Updating map details…'));
      overlay.on('load',()=>{if(!document.querySelector('#map [data-failed]')){status.textContent='Map ready';status.className='loading-state ready';retry.hidden=true;}updateStats();});
      overlay.addTo(map);
    }
    $('#map-title').textContent=labels[name];$('#map-subtitle').textContent=name==='base'?'OpenStreetMap · geographic reference':name==='landcover'?'ESA WorldCover · 2021 · 10 m':'RESOLVE · 2017 · regional ecosystems';
    $('#overlay-opacity').disabled=name==='base';
    $('#legend').replaceChildren(...legends[name].map(([color,label])=>{const span=document.createElement('span'),dot=document.createElement('i');dot.style.background=color;span.append(dot,label);return span;}));
    $('#legend').hidden=name==='base';
    document.querySelectorAll('[data-layer]').forEach(button=>{const active=button.dataset.layer===name;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});updateCoverage();
  }
  document.querySelectorAll('[data-layer]').forEach(button=>button.addEventListener('click',()=>setLayer(button.dataset.layer)));
  $('#overlay-opacity').addEventListener('input',event=>{const value=Number(event.target.value);$('#opacity-value').textContent=`${value}%`;overlay?.setOpacity(value/100);});
  function togglePanel(force){
    const mobile=matchMedia('(max-width:650px)').matches;
    const isOpen=mobile?$('#sidebar').classList.contains('open'):!$('.workspace').classList.contains('tools-hidden');
    const open=force??!isOpen;
    $('#sidebar').classList.toggle('open',open);$('.workspace').classList.toggle('tools-hidden',!open&&!mobile);$('#toggle-panel').setAttribute('aria-expanded',String(open));
    requestAnimationFrame(()=>map.invalidateSize({pan:false}));
  }
  $('#toggle-panel').addEventListener('click',()=>togglePanel());
  if(matchMedia('(max-width:650px)').matches)$('#toggle-panel').setAttribute('aria-expanded','false');
  function inspectMode(value){inspecting=value;$('#inspect-ground').setAttribute('aria-pressed',String(value));map.getContainer().classList.toggle('ground-inspection-active',value);if(value)showStatus('Click the map to inspect actual land cover. Esc cancels.');}
  const sensors=mountSensors({map,L,container:$('#sensor-tools'),onChange:({count,placing,moving,selectedId})=>{
    $('#sensor-count').textContent=`${count} sensor${count===1?'':'s'}`;
    $('#quick-add-sensor').textContent=placing?'× Cancel placement':'＋ Add sensor';$('#quick-add-sensor').setAttribute('aria-pressed',String(placing));
    $('#quick-add-sensor').disabled=count>=500;
    if(placing||moving)inspectMode(false);
    if(placing){inspectController?.abort();$('#ground-card').hidden=true;}
    if(placing&&matchMedia('(max-width:650px)').matches)togglePanel(false);
    if(selectedId&&selectedId!==lastSelected&&!placing&&matchMedia('(max-width:650px)').matches)togglePanel(true);
    lastSelected=selectedId;
  }});
  $('#quick-add-sensor').addEventListener('click',()=>sensors.setPlacement(!sensors.getState().placing));
  $('#inspect-ground').addEventListener('click',()=>{const next=!inspecting;sensors.setPlacement(false);sensors.selectSensor(null);inspectMode(next);if(next&&matchMedia('(max-width:650px)').matches)togglePanel(false);});
  async function inspectPoint(latlng){
    inspectController?.abort();inspectController=new AbortController();const controller=inspectController;
    $('#ground-card').hidden=false;$('#ground-coordinates').textContent=coordinates(latlng);$('#ground-content').textContent='Reading source data…';
    inspectionMarker?.remove();inspectionMarker=L.circleMarker(latlng,{radius:7,color:'#153c41',weight:2,fillColor:'#aff5e1',fillOpacity:1,interactive:false}).addTo(map);
    try{
      const result=await fetch(apiUrl(`/api/sample?lat=${latlng.lat}&lng=${latlng.lng}`),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
      if(!result.ok)throw new Error(`Source request HTTP ${result.status}`);
      const sample=await result.json();if(controller.signal.aborted)return;
      const fields=[['Land cover',sample.landCover?.className||'Unavailable'],['Ecological zone',sample.ecoregion?.zone?.replaceAll('-',' ')||'Not classified'],['Ecoregion',sample.ecoregion?.name||'No regional data'],['Land-cover source','ESA WorldCover 2021 · 10 m'],['Regional source','RESOLVE 2017 · approximate boundaries']];
      if(sample.weather)fields.push(['Forecast baseline',`${sample.weather.temperatureC??'—'} °C · ${sample.weather.windSpeedMs??'—'} m/s`],['Weather valid at',sample.weather.validAt]);
      else fields.push(['Weather','Unavailable — no value substituted']);
      const dl=document.createElement('dl');for(const[label,value]of fields){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;dl.append(dt,dd);}$('#ground-content').replaceChildren(dl);
      const note=document.createElement('p');note.className='ground-note';note.textContent='Current land cover and regional ecology are separate. Forecast values are not sensor observations.';$('#ground-content').append(note);
    }catch(error){if(!controller.signal.aborted)$('#ground-content').textContent=`Source data unavailable: ${error.message}`;}
  }
  map.on('click',event=>{if(inspecting)inspectPoint(event.latlng);});
  $('#close-ground').addEventListener('click',()=>{inspectController?.abort();$('#ground-card').hidden=true;inspectionMarker?.remove();inspectMode(false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')inspectMode(false);});
  function goTo(preset){map.setView(preset.center,preset.zoom);$('#location-title').textContent=preset.title;$('#go-lat').value=preset.center[0];$('#go-lng').value=preset.center[1];}
  $('#location-preset').addEventListener('change',event=>{if(presets[event.target.value])goTo(presets[event.target.value]);});
  $('#coordinates-form').addEventListener('submit',event=>{event.preventDefault();try{const p=parseSensorPosition($('#go-lat').value,$('#go-lng').value);goTo({center:[p.lat,p.lng],zoom:Math.max(10,map.getZoom()),title:'Custom location'});$('#location-preset').value='custom';}catch(error){showStatus(error.message,true);}});
  $('#home-view').addEventListener('click',()=>{goTo(presets.cherkasy);$('#location-preset').value='cherkasy';});
  map.on('moveend zoomend',()=>{const center=map.getCenter();$('#coordinates').textContent=coordinates(center);const nearby=Object.entries(presets).find(([,preset])=>map.distance(center,preset.center)<20000);$('#location-title').textContent=nearby?nearby[1].title:'Custom location';$('#location-preset').value=nearby?nearby[0]:'custom';updateStats();updateCoverage();});
  base.on('load',updateStats);base.on('tileerror',()=>showStatus('Reference-map tiles unavailable; analytical layers remain separate.',true));
  const sourceLink=document.querySelector('.sources-details a[href="/api/sources"]');if(sourceLink)sourceLink.href=apiUrl('/api/sources');
  setLayer('landcover');updateStats();
  window.dryspellMap={map,base,sensors,setLayer,inspectPoint,getDiagnostics:()=>({...stats,version:world.id,apiOrigin:apiUrl(''),imageCache:images.stats(),activeRequests:pool.active,queuedRequests:pool.queue.length,tileElements:document.querySelectorAll('#map .leaflet-tile').length,sensorState:sensors.getState(),layer:activeLayer,realGeodata:true})};
  window.addEventListener('pagehide',()=>{inspectController?.abort();sensors.destroy();map.remove();images.clear();},{once:true});
}
boot().catch(error=>{$('#fatal-error').hidden=false;$('#error-message').textContent=error.message;$('#loading-state').textContent='Map unavailable';console.error(error);});
