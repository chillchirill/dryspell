import {test,expect,type Page} from '@playwright/test';
import type {SandboxDocument,SandboxEvent} from '@dryspell/contracts/sandbox';
import {cellCenter} from '../../packages/simulation/src/index';
import {fixture} from '../../packages/simulation/src/test-fixture';
import {fixtureWeather,imported,select,closeInspector,speed,runTo,seek} from './helpers';

// Explicit synthetic physics input, not terrain/provider or scientific validation.
// Only the real compiled browser worker computes responses and replay frames.
function grassStrip(direct=false):SandboxDocument {
  const {s,e}=fixture(25),row=12;
  e.name='Synthetic thermal QA: 25 m grass strip';
  e.warnings=['Synthetic grass strip and fixed weather; engineering regression only.'];
  e.landscape.cells.forEach((cell,i)=>{cell.burnable=Math.floor(i/25)===row&&i%25>=2&&i%25<=22;});
  e.weather.samples=[0,3600].map(timeSec=>({timeSec,temperatureC:25,humidityPct:40,windSpeedMps:4,windFromDeg:270,precipitationMm:0}));
  const provenance={provider:'Explicit synthetic thermal QA fixture',sourceUrl:'fixture://thermal-grass-strip',version:'1',retrievedAt:e.createdAt,validAt:e.createdAt,license:'Test fixture',attribution:'Synthetic controlled input; not observed conditions',checksum:'synthetic-thermal-qa',sample:true,parameters:{weatherMode:'demo'}};
  e.weather.provenance=[provenance];e.landscape.provenance=[provenance];
  s.name=e.name;s.config.durationSec=3600;
  s.ignitions=[{id:'passing-fire',location:cellCenter(e.landscape,row*25+2),timeSec:0}];
  s.sensors=[{...s.sensors[0],name:direct?'Direct exposure probe':'Thermal probe 50 m',location:cellCenter(e.landscape,(row+(direct?0:2))*25+12)}];
  return {version:1,engineVersion:'surface-grid-1.3.2',scenario:s,environment:e,cursorSec:0,computedUntilSec:0,windControl:{mode:'manual',speedMps:4,fromDeg:270},weatherSelection:{mode:'historical'}};
}

async function events(page:Page){return page.evaluate(()=>(window as unknown as {thermalEvents:SandboxEvent[]}).thermalEvents);}

for(const direct of [false,true])test(direct?'thermal response when fire crosses the sensor reaches critical heat then recovers with exact rewind':'thermal response near passing fire warms and dries then recovers with exact chart rewind',async({page})=>{
  await page.setViewportSize({width:1440,height:1100});
  // Read-only observation of the actual Worker messages, never a worker substitute.
  await page.addInitScript(()=>{
    const Native=window.Worker;
    (window as unknown as {thermalEvents:unknown[]}).thermalEvents=[];
    window.Worker=class extends Native {
      constructor(url:string|URL,options?:WorkerOptions){
        super(url,options);
        if(String(url).includes('simulation.worker'))this.addEventListener('message',event=>{
          (window as unknown as {thermalEvents:unknown[]}).thermalEvents.push(event.data);
        });
      }
    };
  });
  await fixtureWeather(page); // Labelled external startup response only.
  await page.goto('/');
  await expect(page.locator('main')).toHaveAttribute('data-frame-time','0');
  const doc=grassStrip(direct),probeName=doc.scenario.sensors[0].name,sensorCell=12*25+12;
  await imported(page,doc,'explicit-synthetic-thermal-strip.json');
  await expect(page.locator('.sb-marker-label')).toHaveCount(1);
  await speed(page,300);await runTo(page,60);
  expect(Number(await page.getByRole('slider',{name:'Simulation timeline'}).inputValue())).toBeGreaterThanOrEqual(60);

  // Declared frontier is reconstructed by the actual worker, not precomputed readings.
  doc.cursorSec=3600;doc.computedUntilSec=3600;doc.scenario.authoritativeTimeSec=3600;
  await imported(page,doc,'explicit-synthetic-thermal-frontier.json');
  await expect(page.locator('main')).toHaveAttribute('data-frame-time','3600');
  await expect(page.locator('main')).toHaveAttribute('data-reconstructing','false');
  const all=await events(page),generation=Math.max(...all.map(e=>e.generation));
  const rows=new Map(all.filter(e=>e.generation===generation).flatMap(e=>[...(e.observations??[]),...(e.observationBatch??[]),...(e.frame?.readings??[])]).filter(r=>r.sensorId===doc.scenario.sensors[0].id).map(r=>[r.simulationTimeSec!,r]));
  expect([...rows.keys()].sort((a,b)=>a-b)).toEqual(Array.from({length:721},(_,i)=>i*5));
  const initial=rows.get(0)!,end=rows.get(3600)!,peak=[...rows.values()].reduce((a,b)=>a.values.temperatureC!>b.values.temperatureC!?a:b);
  expect(peak.values.temperatureC!-initial.values.temperatureC!).toBeGreaterThan(2);
  expect(initial.values.humidityPct!-peak.values.humidityPct!).toBeGreaterThan(3);
  expect(Math.abs(end.values.temperatureC!-initial.values.temperatureC!)).toBeLessThan(1);
  expect(Math.abs(end.values.humidityPct!-initial.values.humidityPct!)).toBeLessThan(1);
  expect(peak.simulationTimeSec).toBeGreaterThan(0);expect(peak.simulationTimeSec).toBeLessThan(3000);
  if(direct){
    expect(doc.environment.landscape.cells[sensorCell].burnable).toBe(true);
    expect(doc.scenario.sensors[0].location).not.toEqual(doc.scenario.ignitions[0].location);
    expect(peak.values.temperatureC!).toBeGreaterThanOrEqual(70);
    expect(peak.values.temperatureC!).toBeLessThanOrEqual(150);
    expect(peak.values.humidityPct!).toBeLessThan(initial.values.humidityPct!/2);
  }

  await select(page,probeName);
  await page.getByText('Reading values',{exact:true}).click();
  const saved=new Map<number,{checksum:string;table:string}>();
  for(const time of [0,peak.simulationTimeSec!,3600]){
    await seek(page,time);
    const reading=rows.get(time)!;
    await expect(page.locator('.sb-channel-temperatureC strong')).toHaveText(`${reading.values.temperatureC!.toFixed(1)} °C`);
    await expect(page.locator('.sb-channel-humidityPct strong')).toHaveText(`${reading.values.humidityPct!.toFixed(1)} % RH`);
    await expect(page.getByText('Stale reading',{exact:true})).toHaveCount(0);
    await expect(page.locator('.sb-marker-label')).not.toContainText('(stale)');
    const cells=page.locator('.sb-values tbody tr').last().locator('td');
    await expect(cells.nth(1)).toHaveText(reading.values.temperatureC!.toFixed(1));
    await expect(cells.nth(2)).toHaveText(reading.values.humidityPct!.toFixed(1));
    const latest=(await events(page)).filter(e=>e.frame?.timeSec===time&&e.generation===generation).at(-1)!.frame!;
    expect(latest.engineVersion).toBe('surface-grid-1.3.2');
    expect(latest.readings[0]).toEqual(reading);
    if(direct){
      if(time===0)expect(latest.burningCells).not.toContain(sensorCell);
      else if(time===peak.simulationTimeSec){
        expect(latest.burningCells).toContain(sensorCell);
        expect(latest.combustion?.find(c=>c.cell===sensorCell)?.phase).toBe('flaming');
      }else if(time===3600){
        expect(latest.burningCells).not.toContain(sensorCell);
        expect(latest.burnedCells).toContain(sensorCell);
      }
    }
    await expect(page.locator('main')).toHaveAttribute('data-frame-checksum',latest.checksum);
    saved.set(time,{checksum:latest.checksum,table:(await page.locator('.sb-values tbody').textContent())!});
  }
  for(const channel of ['temperatureC','humidityPct']){
    const path=await page.locator(`.sb-channel-${channel} svg path`).nth(1).getAttribute('d');
    expect(path!.split('L').length).toBe(721);
  }
  await page.screenshot({path:`output/playwright/thermal-${direct?'direct':'response'}-recovered.png`});
  await seek(page,peak.simulationTimeSec!);
  await expect(page.locator('main')).toHaveAttribute('data-frame-checksum',saved.get(peak.simulationTimeSec!)!.checksum);
  await expect(page.locator('.sb-values tbody')).toHaveText(saved.get(peak.simulationTimeSec!)!.table);
  await page.screenshot({path:`output/playwright/thermal-${direct?'direct':'response'}-peak.png`});
  await seek(page,3600);
  await expect(page.locator('main')).toHaveAttribute('data-frame-checksum',saved.get(3600)!.checksum);
  await expect(page.locator('.sb-values tbody')).toHaveText(saved.get(3600)!.table);
  console.log(JSON.stringify({fixture:direct?'synthetic 25m grass strip; sensor on front path 250m from ignition':'synthetic 25m grass strip; sensor50m north',initial:initial.values,peakTimeSec:peak.simulationTimeSec,peak:peak.values,recovered:end.values,observations:rows.size}));
  await closeInspector(page);
});
