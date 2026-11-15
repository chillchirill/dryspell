/* Offline historical calendar. Embedded by fire_dashboard.py; uses existing Leaflet. */
(() => {
  'use strict';
  const byId=id=>document.getElementById(id),payload=JSON.parse(byId('history-payload').textContent);
  if(!payload.metadata||payload.metadata.schema_version!==2||!Array.isArray(payload.countries))return;
  const meta=payload.metadata;
  const ui={panel:byId('history-panel'),country:byId('history-country'),metric:byId('history-metric'),
    from:byId('history-from'),to:byId('history-to'),calendar:byId('history-calendar'),
    status:byId('history-status'),detail:byId('history-detail'),method:byId('history-method')};
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const titles={harmonized:'Harmonized activity (MODIS-scale index)',modis:'MODIS detected cell-days',
    viirs:'VIIRS detected cell-days',adjusted:'Adjusted VIIRS index'};
  let active=false,month=meta.last_month,savedView=null;
  const historyPane=map.createPane('historyCells');historyPane.style.zIndex=440;
  const renderer=L.canvas({pane:'historyCells'}),layer=L.layerGroup();
  const country=()=>payload.countries.find(c=>c.name===ui.country.value);
  const number=v=>v===null||v===undefined?'Unavailable':v.toLocaleString('en-GB',{maximumFractionDigits:1});
  const label=m=>new Date(m+'-01T00:00:00Z').toLocaleDateString('en-GB',{month:'short',year:'numeric',timeZone:'UTC'});
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const selectedRows=()=>country().months.filter(r=>r.month>=ui.from.value&&r.month<=ui.to.value);
  const flag=(r,name)=>r.quality_flags.includes(name);
  const color=(value,max)=>value===null?'#6b728033':`rgba(20,130,190,${.08+.72*Math.log1p(value)/Math.log1p(max)})`;
  function focus(){map.fitBounds(country().bounds,{paddingTopLeft:phone.matches?[15,15]:[690,30],
    paddingBottomRight:phone.matches?[15,Math.round(map.getSize().y*.60)]:[30,30],maxZoom:8,animate:false});}
  function setActive(value){
    if(active===value)return;
    if(value&&window.FireSimulation?.isActive())window.FireSimulation.close();
    active=value;ui.panel.hidden=!value;byId('panel').hidden=value;
    document.body.classList.toggle('history-view',value);
    pane.style.visibility=value?'hidden':'';byId('timebar').style.visibility=value?'hidden':'';
    if(value){
      savedView={center:map.getCenter(),zoom:map.getZoom()};setPlaying(false,true);map.closePopup();map.removeLayer(hl);
      pane.style.opacity=0;layer.addTo(map);focus();render();
      requestAnimationFrame(()=>{const scroll=ui.calendar.parentElement;const cell=ui.calendar.querySelector('[aria-pressed="true"]');if(cell)scroll.scrollTop=Math.max(0,cell.offsetTop-ui.calendar.offsetTop-100);});
    }else{
      map.closePopup();map.removeLayer(layer);applyOverlays();
      if(savedView)map.setView(savedView.center,savedView.zoom,{animate:false});
    }
    window.FireSpreadLayer?.refresh();
  }
  function drawCells(record){
    layer.clearLayers();if(!active||!record||record[ui.metric.value]===null)return;
    const factor=country().calibration.factor;
    const metric=ui.metric.value==='harmonized'?(record.harmonized_source==='MODIS'?'modis':'adjusted'):ui.metric.value;
    for(const [cell,modis,viirs,unknown] of record.cells){
      const value=metric==='modis'?modis:metric==='viirs'?viirs:viirs===null||factor===null?null:viirs*factor;
      if(value===null||value<=0)continue;
      const lat=-90+(Math.floor(cell/1440)+.5)*.25,lon=-180+(cell%1440+.5)*.25;
      L.rectangle([[lat-.125,lon-.125],[lat+.125,lon+.125]],{pane:'historyCells',renderer,
        color:'#5ac8fa',weight:1,fillColor:'#168ac7',fillOpacity:.2+.7*Math.min(value/31,1),bubblingMouseEvents:false})
        .bindPopup(`<b>${esc(label(record.month))} | ${esc(country().name)}</b><br>Displayed: ${number(value)} ${metric==='adjusted'?'index units':'detected days'}<br>MODIS: ${number(modis)} detected days<br>VIIRS: ${number(viirs)} detected days<br>VIIRS days with unknown type: ${number(unknown)}<br><small>0.25\u00b0 interior cell. The adjustment is validated only for country totals; cell-level scaling is illustrative. Zero detections does not prove absence of fire.</small>`).addTo(layer);
    }
  }
  function validationSvg(){
    const c=country(),cal=c.calibration;
    if(cal.factor===null)return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 90" class="history-chart" role="img" aria-label="Calibration unavailable"><rect width="620" height="90" fill="#fff"/><text x="20" y="45" fill="#17212b">${esc(cal.reason)}</text></svg>`;
    const rows=c.months.filter(r=>r.month>=cal.train_first&&r.month<=cal.test_last&&r.modis!==null&&r.viirs!==null&&!r.unknown);
    const max=Math.max(1,...rows.flatMap(r=>[r.modis,r.viirs,r.adjusted]));
    const x=i=>60+i/(rows.length-1)*530,y=v=>220-140*v/max;
    const test=rows.findIndex(r=>r.month===cal.test_first),divider=(x(test-1)+x(test))/2;
    let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 345" class="history-chart" role="img" aria-label="${esc(c.name)}: MODIS, raw VIIRS and adjusted VIIRS; held-out months shaded"><rect width="620" height="345" fill="#fff"/><g font-family="Arial,sans-serif" font-size="11" fill="#17212b"><text x="20" y="22" font-size="15">${esc(c.name)} \u00b7 sensor agreement</text><text x="20" y="43">Country totals: detected cell-days / MODIS-scale index</text><rect x="${divider}" y="60" width="${600-divider}" height="160" fill="#e9edf8"/><text x="65" y="72">Fit: ${cal.train_months} months</text><text x="${divider+8}" y="72">Held out: ${cal.test_months}</text>`;
    for(const f of [0,.5,1])svg+=`<line x1="60" y1="${y(max*f)}" x2="590" y2="${y(max*f)}" stroke="#d4d9df"/><text x="53" y="${y(max*f)+4}" text-anchor="end">${number(max*f)}</text>`;
    for(const [metric,stroke,dash] of [['viirs','#71717a','5 3'],['modis','#9c5700',''],['adjusted','#007e9c','']]){
      svg+=`<polyline fill="none" stroke="${stroke}" stroke-width="2" stroke-dasharray="${dash}" points="${rows.map((r,i)=>`${x(i)},${y(r[metric])}`).join(' ')}"/>`;
      rows.forEach((r,i)=>svg+=`<circle cx="${x(i)}" cy="${y(r[metric])}" r="2.5" fill="${stroke}"/>`);
    }
    for(const i of [0,test,rows.length-1])svg+=`<text x="${x(i)}" y="240" text-anchor="middle">${rows[i].month}</text>`;
    svg+=`<text x="20" y="264" fill="#9c5700">MODIS reference</text><text x="190" y="264" fill="#71717a">Raw VIIRS (dashed)</text><text x="390" y="264" fill="#007e9c">Adjusted VIIRS</text><text x="20" y="288">Held-out MAE: ${number(cal.test_mae_raw)} raw \u2192 ${number(cal.test_mae_adjusted)} adjusted</text><text x="20" y="309">Frozen factor ${cal.factor.toFixed(3)}; no fitting on the shaded test months.</text><text x="20" y="330">Sensor agreement, not fire-prediction accuracy. Short overlap; coverage unknown.</text></g></svg>`;
    return svg;
  }
  function calendarSvg(){
    const rows=selectedRows(),metric=ui.metric.value,c=country(),years=[...new Set(rows.map(r=>r.month.slice(0,4)))];
    const max=Math.max(1,...c.months.map(r=>r[metric]||0)),height=190+years.length*30;
    let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="920" height="${height}" viewBox="0 0 920 ${height}" role="img" aria-label="Fire activity calendar"><rect width="920" height="${height}" fill="#fff"/><g font-family="Arial,sans-serif" fill="#17212b"><text x="20" y="28" font-size="19">${esc(c.name)} \u00b7 ${esc(titles[metric])}</text><text x="20" y="52" font-size="12">${esc(ui.from.value)} to ${esc(ui.to.value)} \u00b7 0.25\u00b0 interior cells \u00b7 not a count of fires</text>`;
    months.forEach((m,i)=>svg+=`<text x="${91+i*68}" y="82" font-size="12">${m}</text>`);
    years.forEach((year,j)=>{
      const top=92+j*30;svg+=`<text x="20" y="${top+18}" font-size="12">${year}</text>`;
      for(let m=1;m<=12;m++){
        const r=rows.find(r=>r.month===year+'-'+String(m).padStart(2,'0'));if(!r)continue;
        const v=r[metric],x=80+(m-1)*68;
        const provisional=metric==='harmonized'&&flag(r,'unknown_type_provisional');
        const early=metric==='harmonized'&&flag(r,'early_satellite_coverage');
        svg+=`<rect x="${x}" y="${top}" width="64" height="26" fill="${color(v,max)}" stroke="${provisional?'#b87500':early?'#71717a':'#ccd3da'}"/><text x="${x+32}" y="${top+17}" text-anchor="middle" font-size="11">${v===null?'\u2014':number(v)}</text>`;
      }
    });
    svg+=`<text x="20" y="${height-58}" font-size="12">\u2014 unavailable; amber border: provisional unknown-type VIIRS; grey border: early coverage.</text><text x="20" y="${height-38}" font-size="12">MODIS is used where available; adjusted VIIRS extends it. Overlapping sensors are never added.</text><text x="20" y="${height-18}" font-size="12">NASA FIRMS \u00b7 latest complete month ${meta.last_month}; no raw MODIS events supplied. Coverage uncertainty remains.</text></g></svg>`;
    return svg;
  }
  function render(){
    const c=country(),rows=selectedRows(),metric=ui.metric.value;
    ui.calendar.replaceChildren();
    byId('history-validation').innerHTML=validationSvg();
    byId('history-image').disabled=byId('history-csv').disabled=!rows.length;
    if(!rows.length){ui.status.textContent='Choose a valid range within '+meta.first_month+' to '+meta.last_month+'.';ui.detail.textContent='';byId('history-summary').textContent='';byId('history-points').disabled=true;layer.clearLayers();return;}
    if(!rows.some(r=>r.month===month))month=rows.at(-1).month;
    const max=Math.max(1,...c.months.map(r=>r[metric]||0));
    for(const heading of ['Year',...months]){const node=document.createElement('div');node.className='history-month-label';node.textContent=heading;ui.calendar.append(node);}
    for(const year of [...new Set(rows.map(r=>r.month.slice(0,4)))]){
      const heading=document.createElement('div');heading.className='history-year';heading.textContent=year;ui.calendar.append(heading);
      for(let m=1;m<=12;m++){
        const record=rows.find(r=>r.month===year+'-'+String(m).padStart(2,'0'));
        if(!record){ui.calendar.append(document.createElement('span'));continue;}
        const value=record[metric],button=document.createElement('button');button.type='button';button.className='history-month';button.dataset.month=record.month;
        button.setAttribute('aria-pressed',String(record.month===month));
        button.setAttribute('aria-label',label(record.month)+': '+number(value)+'; '+(record.harmonized_source||'unavailable'));
        button.title=label(record.month)+' \u00b7 '+number(value)+' \u00b7 '+record.quality_flags.join(', ');
        if(value===null)button.classList.add('missing');
        if(metric==='harmonized'&&flag(record,'unknown_type_provisional'))button.classList.add('provisional');
        if(metric==='harmonized'&&flag(record,'early_satellite_coverage'))button.classList.add('early');
        button.style.background=color(value,max);button.innerHTML=`<strong>${value===null?'\u2014':number(value)}</strong>`;
        button.onclick=()=>{month=record.month;render();};ui.calendar.append(button);
      }
    }
    const r=rows.find(r=>r.month===month),cal=c.calibration;
    const available=rows.filter(r=>r[metric]!==null),peak=available.reduce((best,r)=>!best||r[metric]>best[metric]?r:best,null);
    const annual=[...new Set(rows.map(r=>r.month.slice(0,4)))].map(year=>({year,rows:available.filter(r=>r.month.startsWith(year))})).filter(y=>y.rows.length===12&&Number(y.year)>=2003).map(y=>({year:y.year,total:y.rows.reduce((s,r)=>s+r[metric],0)})).sort((a,b)=>b.total-a.total);
    byId('history-summary').textContent=`Selected period: ${available.length}/${rows.length} months available. `+(peak?`Highest month: ${label(peak.month)} (${number(peak[metric])}). `:'')+(annual.length?`Highest complete year since 2003 in selection: ${annual[0].year} (${number(annual[0].total)}).`:'No complete year since 2003 in this selection.');
    ui.status.textContent=`${rows.length} months \u00b7 ${c.grid_cells} comparable interior cells \u00b7 latest complete month ${meta.last_month}. ${meta.excluded_partial_month} is partial and excluded.`;
    byId('history-legend').textContent='Stronger blue = higher activity; stripes = unavailable. Calendar colours are scaled within the selected country and metric. Amber underline = provisional VIIRS; dotted underline = early satellite coverage. Counts are cell-days; harmonized values are an index, not separate fires. Map cells use a 0\u201331 scale.';
    const baseline=r.baseline_median===null?`Historical comparison unavailable: ${r.baseline_years} earlier reference years; at least 5 required.`:
      `Historical median ${number(r.baseline_median)}; usual 10\u201390% range ${number(r.baseline_p10)}\u2013${number(r.baseline_p90)}. Same month in ${r.baseline_years} past years (${r.baseline_first}\u2013${r.baseline_last}).`;
    const anomaly=r.anomaly_absolute===null?'No comparable anomaly available.':`${{above_reference:'Above',below_reference:'Below',within_reference:'Within'}[r.anomaly_status]} the historical range. Difference from median: ${number(r.anomaly_absolute)} index units${r.anomaly_pct===null?'; percentage undefined because the median is zero':` (${number(r.anomaly_pct)}%)`}.`;
    ui.detail.innerHTML=`<h3>${esc(label(month))}</h3><table><tr><td>Harmonized activity index</td><td>${number(r.harmonized)}</td></tr><tr><td>Selected source</td><td>${esc(r.harmonized_source||'Unavailable')}</td></tr><tr><td>MODIS detected cell-days</td><td>${number(r.modis)}</td></tr><tr><td>VIIRS detected cell-days</td><td>${number(r.viirs)}</td></tr><tr><td>Adjusted VIIRS index</td><td>${number(r.adjusted)}</td></tr></table><h3>Same month against history</h3><p>${esc(baseline)}</p><p>${esc(anomaly)}</p><div class="hint">Comparison always uses the harmonized country-total index. The historical band describes detections, not a fire probability or forecast interval.</div>
      ${flag(r,'early_satellite_coverage')?'<p class="history-notice">Early MODIS satellite coverage differs. These years are excluded from the historical reference.</p>':''}
      ${flag(r,'unknown_type_provisional')?'<p class="history-notice">Provisional: VIIRS NRT has no source-type classification. The continuation and its anomaly may include non-vegetation heat sources.</p>':''}
      ${flag(r,'no_held_out_improvement')?'<p class="history-notice">This country adjustment did not improve held-out agreement. Interpret the continuation cautiously.</p>':''}
      ${r.modis===null?'<p class="history-notice">MODIS is not supplied for this month. It is not zero.</p>':''}
      <div class="hint">Zero means no retained detections. Cloud-free observation coverage is unknown; coastal and boundary cells are excluded.</div>`;
    ui.method.innerHTML=`<p>One historical series on the MODIS scale: MODIS when supplied, otherwise VIIRS multiplied by the frozen country factor. Sensors are never added together. Original records remain available in the display selector and CSV.</p><p>Both instruments use the same 0.25\u00b0 grid, interior-cell boundary rule and static-source mask. VIIRS duplicates are collapsed to one cell-day across satellites. MODIS confidence \u226530 upstream; VIIRS nominal/high. Type 0 where known; unknown types remain provisional.</p>
      ${cal.factor===null?`<p>${esc(cal.reason)}</p>`:`<p>Factor ${cal.factor.toFixed(3)} fitted on ${cal.train_first}\u2013${cal.train_last}; held out ${cal.test_first}\u2013${cal.test_last}. MAE ${number(cal.test_mae_raw)} \u2192 ${number(cal.test_mae_adjusted)}; signed bias ${number(cal.test_bias_raw)} \u2192 ${number(cal.test_bias_adjusted)}. ${cal.improved_on_test?'Agreement improved on this test.':'Agreement did not improve on this test.'}</p><p>Only ${cal.test_months} held-out months: this does not establish year-round equivalence. This is sensor agreement, not fire-prediction accuracy. The fixed mask is retrospective. No fitting or parameter selection uses the test months.</p>`}
      <p>${esc(meta.baseline_rule)}</p><p>Raw MODIS events and FRP are absent. This is monthly aggregate harmonization, not event matching or a climate-trend estimate. Cell-level adjustment is illustrative; validation is at country-total level. Ireland means the Republic; Northern Ireland is included in United Kingdom.</p>`;
    byId('history-points').disabled=ui.to.value<meta.points_first_date.slice(0,7)||ui.from.value>meta.points_last_date.slice(0,7);
    byId('history-download-status').textContent=`Raw VIIRS available ${meta.points_first_date}\u2013${meta.points_last_date}. Raw MODIS points are not supplied.`;
    drawCells(r);
  }
  function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  byId('history-csv').onclick=()=>{
    const fields=['country','month','harmonized','harmonized_source','modis','viirs','adjusted','quality_flags','baseline_years','baseline_first','baseline_last','baseline_median','baseline_p10','baseline_p90','anomaly_absolute','anomaly_pct','anomaly_status','unknown','viirs_type_filter'];
    const rows=selectedRows().map(r=>fields.map(k=>k==='country'?country().name:Array.isArray(r[k])?r[k].join('; '):r[k]??''));
    download([fields,...rows].map(row=>row.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(',')).join('\r\n'),'fire_history_'+country().name.replaceAll(' ','_')+'.csv','text/csv;charset=utf-8');
  };
  byId('history-image').onclick=()=>download(calendarSvg(),'fire_calendar_'+country().name.replaceAll(' ','_')+'.svg','image/svg+xml');
  byId('history-validation-image').onclick=()=>download(validationSvg(),'sensor_agreement_'+country().name.replaceAll(' ','_')+'.svg','image/svg+xml');
  byId('history-points').onclick=async()=>{
    const status=byId('history-download-status');status.textContent='Preparing supplied VIIRS points\u2026';
    try{const query=new URLSearchParams({country:ui.country.value,start:ui.from.value,end:ui.to.value});const response=await fetch('/api/history/detections?'+query);if(!response.ok)throw new Error();download(await response.text(),'viirs_'+country().name.replaceAll(' ','_')+'.csv','text/csv;charset=utf-8');status.textContent='Downloaded available VIIRS rows with calendar_included flag. Missing MODIS points were not reconstructed.';}
    catch(error){status.textContent='Points export needs the updated local server. Monthly CSV and SVG work in the saved map.';}
  };
  for(const c of payload.countries){const option=document.createElement('option');option.value=c.name;option.textContent=c.name==='Ireland'?'Ireland (Republic)':c.name;ui.country.append(option);}
  ui.from.min=ui.to.min=meta.first_month;ui.from.max=ui.to.max=meta.last_month;ui.from.value=meta.first_month;ui.to.value=meta.last_month;
  ui.country.onchange=()=>{render();if(active)focus();};ui.metric.onchange=render;ui.from.onchange=ui.to.onchange=render;
  byId('history-open').disabled=false;byId('history-open').onclick=()=>setActive(true);byId('history-close').onclick=()=>setActive(false);
  window.FireHistory={isActive:()=>active,getState:()=>({active,country:country().name,month,metric:ui.metric.value,visibleCells:layer.getLayers().length,months:ui.calendar.querySelectorAll('button').length}),open:()=>setActive(true),close:()=>setActive(false)};
  if(new URLSearchParams(location.search).get('view')!=='forecast')requestAnimationFrame(()=>setActive(true));
})();
