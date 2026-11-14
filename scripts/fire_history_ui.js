/* Embedded by fire_dashboard.py. No third-party dependencies beyond the existing Leaflet map. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const payload = JSON.parse(byId('history-payload').textContent);
  if (!payload.metadata || !Array.isArray(payload.countries)) return;
  const meta = payload.metadata;
  const ui = {panel:byId('history-panel'),country:byId('history-country'),metric:byId('history-metric'),
    from:byId('history-from'),to:byId('history-to'),calendar:byId('history-calendar'),
    status:byId('history-status'),detail:byId('history-detail'),method:byId('history-method')};
  let active=false,month=meta.last_month,savedView=null;
  const historyPane=map.createPane('historyCells');historyPane.style.zIndex=440;
  const renderer=L.canvas({pane:'historyCells'}),layer=L.layerGroup();
  const country=()=>payload.countries.find(c=>c.name===ui.country.value);
  const number=v=>v===null||v===undefined?'Unavailable':v.toLocaleString('en-GB',{maximumFractionDigits:1});
  const label=m=>new Date(m+'-01T00:00:00Z').toLocaleDateString('en-GB',{month:'short',year:'numeric',timeZone:'UTC'});
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const selectedRows=()=>country().months.filter(r=>r.month>=ui.from.value&&r.month<=ui.to.value);
  function focus() {
    map.fitBounds(country().bounds,{paddingTopLeft:phone.matches?[15,15]:[510,30],
      paddingBottomRight:phone.matches?[15,Math.round(map.getSize().y*.60)]:[30,30],maxZoom:8,animate:false});
  }
  function setActive(value) {
    if(value && window.FireSimulation?.isActive()) window.FireSimulation.close();
    active=value;ui.panel.hidden=!value;byId('panel').hidden=value;
    document.body.classList.toggle('history-view',value);
    pane.style.visibility=value?'hidden':'';byId('timebar').style.visibility=value?'hidden':'';
    if(value) {
      savedView={center:map.getCenter(),zoom:map.getZoom()};setPlaying(false,true);map.closePopup();
      map.removeLayer(hl);
      pane.style.opacity=0;layer.addTo(map);focus();render();
    } else {
      map.closePopup();map.removeLayer(layer);applyOverlays();
      if(savedView)map.setView(savedView.center,savedView.zoom,{animate:false});
    }
    window.FireSpreadLayer?.refresh();
  }
  function drawCells(record) {
    layer.clearLayers();
    if(!active||!record||record[ui.metric.value]===null)return;
    const factor=country().calibration.factor;
    for(const [cell,modis,viirs,unknown] of record.cells) {
      const value=ui.metric.value==='modis'?modis:ui.metric.value==='viirs'?viirs:viirs===null||factor===null?null:viirs*factor;
      if(value===null||value<=0)continue;
      const lat=-90+(Math.floor(cell/1440)+.5)*.25,lon=-180+(cell%1440+.5)*.25;
      const opacity=.2+.7*Math.min(value/31,1);
      L.rectangle([[lat-.125,lon-.125],[lat+.125,lon+.125]],{pane:'historyCells',renderer,
        color:'#5ac8fa',weight:1,fillColor:'#168ac7',fillOpacity:opacity,bubblingMouseEvents:false})
        .bindPopup(`<b>${esc(label(record.month))} | ${esc(country().name)}</b><br>MODIS: ${number(modis)} detected days<br>VIIRS: ${number(viirs)} detected days<br>VIIRS days with unknown type: ${number(unknown)}<br><small>One 0.25° cell. No retained detections does not prove absence of fire.</small>`).addTo(layer);
    }
  }
  function render() {
    const c=country(),rows=selectedRows(),metric=ui.metric.value;
    byId('history-legend').textContent=metric==='adjusted'
      ?'Stronger blue = higher adjusted index; stripes = unavailable. This is not a literal count of days or fires. Cell-level adjustment is illustrative; map colour scale is 0–31.'
      :'Stronger blue = more activity; stripes = unavailable. Values count detected grid-cell days, not separate fires. Map cells use a 0–31 day colour scale.';
    ui.calendar.replaceChildren();
    if(!rows.length) {
      ui.status.textContent='Choose a valid month range within '+meta.first_month+' to '+meta.last_month+'.';
      ui.detail.textContent='';layer.clearLayers();return;
    }
    if(!rows.some(r=>r.month===month))month=rows[rows.length-1].month;
    const max=Math.max(1,...c.months.map(r=>r[metric]||0));
    for(const record of rows) {
      const value=record[metric],button=document.createElement('button');button.type='button';button.className='history-month';
      button.dataset.month=record.month;button.setAttribute('aria-pressed',String(record.month===month));
      button.setAttribute('aria-label',label(record.month)+': '+number(value));
      if(value===null)button.classList.add('missing');
      button.style.background=`rgba(20,130,190,${value===null?0:.08+.72*Math.log1p(value)/Math.log1p(max)})`;
      button.innerHTML=`<span>${esc(label(record.month))}</span><strong>${value===null?'—':number(value)}</strong>`;
      button.onclick=()=>{month=record.month;render();};ui.calendar.append(button);
    }
    const r=rows.find(r=>r.month===month),cal=c.calibration;
    ui.status.textContent=`${rows.length} months | ${c.grid_cells} comparable interior cells | ${meta.first_month} to ${meta.last_month}`;
    const previous=c.months.find(x=>x.month===String(Number(month.slice(0,4))-1)+month.slice(4));
    const changedFilter=previous && previous.viirs_type_filter!==r.viirs_type_filter && metric!=='modis';
    const comparison=previous&&previous[metric]!==null&&r[metric]!==null
      ?`${number(previous[metric])} in ${label(previous.month)}${changedFilter?' — VIIRS type filtering changed; direct comparison is limited.':''}`:'No same-month comparison in this two-year window.';
    ui.detail.innerHTML=`<h3>${esc(label(month))}</h3><table>
      <tr><td>MODIS detected cell-days</td><td>${number(r.modis)}</td></tr>
      <tr><td>VIIRS detected cell-days</td><td>${number(r.viirs)}</td></tr>
      <tr><td>Adjusted VIIRS index</td><td>${number(r.adjusted)}</td></tr></table>
      <div class="hint">Same month, previous year: ${esc(comparison)}</div>
      ${r.modis===null?'<p class="history-notice">MODIS is not supplied for this month. It is not zero.</p>':''}
      ${r.viirs_type_filter.startsWith('NRT')?`<p class="history-notice">VIIRS NRT has no type classification. ${number(r.unknown)} retained cell-days include unknown-type detections; adjusted values are provisional.</p>`:''}
      <div class="hint">Zero means no retained detections. Cloud-free observation coverage is unknown. This view excludes coastal and boundary cells.</div>`;
    ui.method.innerHTML=`<p>Monthly aggregate alignment prototype. MODIS dates use a January 2000 epoch; VIIRS dates are rebuilt from the raw points. Both use the same 0.25° grid, interior-cell boundary rule and supplied static-source mask.</p>
      <p>One cell seen by both VIIRS satellites on the same day counts once. Confidence: MODIS ≥30 upstream; VIIRS nominal/high. Type 0 where known; unknown NRT types are marked.</p>
      ${cal.factor===null?`<p>${esc(cal.reason)}</p>`:`<p>Exploratory country scale: VIIRS × ${cal.factor.toFixed(3)}. Fitted on ${cal.train_first}–${cal.train_last}; tested on ${cal.test_first}–${cal.test_last} (${cal.test_months} months).</p><p>Held-out monthly mean absolute difference from MODIS: ${number(cal.test_mae_raw)} raw → ${number(cal.test_mae_adjusted)} adjusted cell-days. ${cal.improved_on_test?'Lower in this test.':'No improvement in this test.'} This is sensor agreement, not fire-prediction accuracy. The fixed mask is shared across all months.</p>`}
      <p>Adjustment is checked at country-total level, not at individual cells. No raw MODIS event matching, FRP comparison or long-term climate trend is claimed. Country boundaries follow the delivered subset; Ireland here is the Republic, while Northern Ireland is in United Kingdom.</p>`;
    drawCells(r);
  }
  function download(text,name,type) {
    const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');
    link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  byId('history-csv').onclick=()=>{
    const fields=['country','month','modis_cell_days','viirs_cell_days','adjusted_viirs_index','unknown_type_cell_days','viirs_type_filter'];
    const rows=selectedRows().map(r=>[country().name,r.month,r.modis??'',r.viirs??'',r.adjusted??'',r.unknown,r.viirs_type_filter]);
    const csv=[fields,...rows].map(row=>row.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join('\r\n');
    download(csv,'fire_history_'+ui.country.value.replaceAll(' ','_')+'.csv','text/csv;charset=utf-8');
  };
  byId('history-points').onclick=async()=>{
    const status=byId('history-download-status');status.textContent='Preparing VIIRS CSV...';
    try {
      const query=new URLSearchParams({country:ui.country.value,start:ui.from.value,end:ui.to.value});
      const response=await fetch('/api/history/detections?'+query);
      if(!response.ok)throw new Error();
      download(await response.text(),'viirs_'+ui.country.value.replaceAll(' ','_')+'.csv','text/csv;charset=utf-8');
      status.textContent='Downloaded raw VIIRS points, including a calendar_included flag. MODIS raw points are not in this package.';
    }catch(error){status.textContent='Points export needs the updated local dashboard server. The monthly CSV works in the saved map.';}
  };
  for(const c of payload.countries) {
    const option=document.createElement('option');option.value=c.name;option.textContent=c.name==='Ireland'?'Ireland (Republic)':c.name;ui.country.append(option);
  }
  ui.from.min=ui.to.min=meta.first_month;ui.from.max=ui.to.max=meta.last_month;
  ui.from.value=meta.first_month;ui.to.value=meta.last_month;
  ui.country.onchange=()=>{render();if(active)focus();};ui.metric.onchange=render;
  ui.from.onchange=ui.to.onchange=render;
  byId('history-open').disabled=false;byId('history-open').onclick=()=>setActive(true);
  byId('history-close').onclick=()=>setActive(false);
  window.FireHistory={isActive:()=>active,getState:()=>({active,country:country().name,month,metric:ui.metric.value,
    visibleCells:layer.getLayers().length,months:ui.calendar.children.length}),open:()=>setActive(true),close:()=>setActive(false)};
})();
