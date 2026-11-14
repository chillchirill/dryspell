import {test,expect,chromium,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {place as placeCurrent,select as selectCurrent,layers,weatherSettings,closeInspector} from './helpers';
import type {EnvironmentSnapshot,Coordinate} from '@dryspell/contracts';
import type {SandboxDocument} from '@dryspell/contracts/sandbox';

// Historical zero-object journeys explicitly import an empty saved-scene fixture.
// Fresh one-sensor behavior is independently covered in compact-review.spec.ts.
// External weather only is deterministic. Terrain, UI, worker and numerical engine are real.
async function setup(page:Page){
 const forbidden:string[]=[];
 page.on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/api/v1')||url.port==='4000')forbidden.push(request.url());});
 await page.route('**/api/sandbox/weather?**',async route=>{const startTime=new URL(route.request().url()).searchParams.get('startTime')!;
  const durationSec=Number(new URL(route.request().url()).searchParams.get('durationSec')??21600),parameters=durationSec>384*3600?{forecastEndSec:384*3600,extensionPolicy:'hold-last-conditions',extensionEndSec:durationSec}:{};
  await route.fulfill({json:{id:'review-weather-'+startTime+'-'+durationSec,validAt:startTime,issuedAt:startTime,stale:false,samples:[0,durationSec].map(timeSec=>({timeSec,temperatureC:25,humidityPct:40,windSpeedMps:4,windFromDeg:270,precipitationMm:0})),provenance:[{provider:'Open-Meteo deterministic browser response fixture',sourceUrl:'https://api.open-meteo.com/v1/forecast',version:'test-fixture',retrievedAt:startTime,validAt:startTime,license:'Test fixture',attribution:'Synthetic external response for reproducible acceptance',checksum:'fixture',sample:false,parameters}]}});
 });
 const environment=await page.request.get('/api/sandbox/environment').then(r=>r.json()) as EnvironmentSnapshot;
 const l=environment.landscape,index=l.cells.findIndex((c,i)=>c.burnable&&c.cover==='grass'&&i%l.width>l.width*.4&&i%l.width<l.width*.6&&Math.floor(i/l.width)>l.height*.4&&Math.floor(i/l.width)<l.height*.6);
 expect(index).toBeGreaterThanOrEqual(0);
 const point={longitude:l.bounds.west+(index%l.width+.5)/l.width*(l.bounds.east-l.bounds.west),latitude:l.bounds.south+(Math.floor(index/l.width)+.5)/l.height*(l.bounds.north-l.bounds.south)};
 await page.goto('/');await expect(page.getByRole('button',{name:'Add sensor',exact:true})).toBeEnabled();
 await expect(page.locator('main')).toHaveAttribute('data-frame-time','0');
 const empty=await exported(page);empty.scenario.sensors=[];empty.scenario.ignitions=[];empty.scenario.revision++;empty.scenario.authoritativeTimeSec=0;empty.cursorSec=0;empty.computedUntilSec=0;
 await page.locator('input[type=file]').setInputFiles({name:'explicit-empty-current-model-scene.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(empty))});await expect(page.locator('.sb-marker-label')).toHaveCount(0);await expect(page.locator('main')).toHaveAttribute('data-frame-time','0');
 await layers(page);return {point,forbidden};
}
async function place(page:Page,name:string,point:Coordinate){await placeCurrent(page,name,point);}
async function select(page:Page,name:string){await selectCurrent(page,name);}
async function exported(page:Page){
 await page.getByRole('button',{name:'Experiment menu',exact:true}).click();const pending=page.waitForEvent('download');
 await page.getByRole('button',{name:'Export experiment',exact:true}).click();const download=await pending;
 const document=JSON.parse(await readFile((await download.path())!,'utf8')) as SandboxDocument;
 await page.getByRole('button',{name:'Close inspector',exact:true}).click();return document;
}

test('anonymous four profiles run, inspect, pause, rewind and reload through the real browser worker',async({page})=>{
 const {point,forbidden}=await setup(page);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await expect(page.getByRole('slider',{name:'Simulation timeline'})).toHaveAttribute('max','21600');
 for(const name of ['Combined','Temperature','Humidity','Smoke','Fire'])await place(page,name,point);
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled();
 await page.locator('.sb-speed summary').click();await page.getByRole('button',{name:'60×',exact:true}).click();
 await page.getByRole('button',{name:'Run',exact:true}).click();
 await expect.poll(async()=>Number(await page.getByRole('slider',{name:'Simulation timeline'}).inputValue())).toBeGreaterThanOrEqual(30);
 await page.getByRole('button',{name:'Pause',exact:true}).click();const paused=await page.getByRole('slider',{name:'Simulation timeline'}).inputValue();
 await page.waitForTimeout(250);expect(await page.getByRole('slider',{name:'Simulation timeline'}).inputValue()).toBe(paused);
 await select(page,'Combined 1');await expect(page.locator('.sb-readings svg')).toHaveCount(3);
 await page.getByText('Reading values',{exact:true}).click();const values=page.locator('.sb-values tbody tr');await expect(values).not.toHaveCount(1);
 const first=(await values.first().innerText()),last=(await values.last().innerText());expect(first).not.toBe(last);
 for(const [name,count] of [['Temperature 2',1],['Humidity 3',1],['Smoke 4',1]] as const){await select(page,name);await expect(page.locator('.sb-readings svg')).toHaveCount(count);await expect(page.locator('.sb-readings').getByText('Not supported',{exact:true})).toHaveCount(2);}
 await page.getByRole('slider',{name:'Simulation timeline'}).fill('10');await expect(page.getByRole('status',{name:'Simulation time'})).toHaveText('0:10');
 await select(page,'Combined 1');await page.getByText('Reading values',{exact:true}).click();const atTen=await page.locator('.sb-values tbody').textContent();await expect(page.locator('.sb-values tbody tr')).toHaveCount(3);
 await page.screenshot({path:'output/playwright/compact-review-legacy-review-desktop.png'});
 await page.getByRole('button',{name:'Experiment menu',exact:true}).click();await expect(page.getByText('Saved on this device',{exact:true})).toBeVisible();await page.waitForTimeout(2200);
 await page.reload();await expect(page.getByRole('status',{name:'Simulation time'})).toHaveText('0:10');await select(page,'Combined 1');await page.getByText('Reading values',{exact:true}).click();await expect(page.locator('.sb-values tbody')).toHaveText(atTen!);
 await page.getByRole('button',{name:'Rewind to start',exact:true}).click();await expect(page.getByRole('status',{name:'Simulation time'})).toHaveText('0:00');await expect(page.locator('.sb-values tbody tr')).toHaveCount(1);
 const d=await exported(page);expect(d.scenario.sensors.map(s=>s.capabilities.length)).toEqual([3,1,1,1]);expect(d.scenario.ignitions).toHaveLength(1);expect(d.cursorSec).toBe(0);expect(d.computedUntilSec).toBeGreaterThanOrEqual(30);
 expect(forbidden).toEqual([]);expect(errors).toEqual([]);
});

test('palette drag, movement, cancel and undo stay local',async({page})=>{
 const {point,forbidden}=await setup(page);await place(page,'Combined',point);const before=await exported(page);
 const marker=page.getByRole('button',{name:/^Combined 1(?:[: ]|$)/});const target=await marker.boundingBox(),palette=await page.getByRole('button',{name:'Add sensor',exact:true}).boundingBox();expect(target&&palette).toBeTruthy();
 await page.mouse.move(palette!.x+palette!.width/2,palette!.y+palette!.height/2);await page.mouse.down();await page.mouse.move(target!.x+target!.width/2,target!.y+target!.height/2,{steps:15});await page.mouse.up();
 await expect(page.getByRole('button',{name:/^Combined 2(?:[: ]|$)/})).toBeVisible();
 await page.getByRole('button',{name:'Add sensor',exact:true}).click();await page.getByRole('button',{name:'Cancel placement',exact:true}).click();expect((await exported(page)).scenario.sensors).toHaveLength(2);
 await page.getByRole('button',{name:'Undo last edit',exact:true}).click();await expect(page.getByRole('button',{name:/^Combined 2(?:[: ]|$)/})).toHaveCount(0);
 const box=await marker.boundingBox();await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await page.mouse.down();await page.mouse.move(box!.x+box!.width/2+12,box!.y+box!.height/2,{steps:10});await page.mouse.up();
 const moved=await exported(page);expect(moved.scenario.sensors[0].location).not.toEqual(before.scenario.sensors[0].location);
 await page.getByRole('button',{name:'Undo last edit',exact:true}).click();expect((await exported(page)).scenario.sensors[0].location).toEqual(before.scenario.sensors[0].location);expect(forbidden).toEqual([]);
});

test('mobile touch places, runs, pauses and rewinds',async({browser})=>{
 const context=await browser.newContext({baseURL:'http://127.0.0.1:4001',viewport:{width:390,height:844},hasTouch:true,isMobile:true});const page=await context.newPage();
 try{const {point,forbidden}=await setup(page);
 for(const name of ['Land cover','Ecological zones','Zoom in','Zoom out']){const button=page.getByRole('button',{name,exact:true});expect(await button.evaluate(element=>{const b=element.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('button')===element;})).toBe(true);}
 const attribution=page.locator('details.maplibregl-ctrl-attrib');if(!(await attribution.getAttribute('open'))&&!(await attribution.evaluate(e=>(e as HTMLDetailsElement).open)))await attribution.locator('summary').tap();
 const attributionBox=await attribution.boundingBox(),transportBox=await page.locator('.sb-bottom').boundingBox();expect(transportBox!.y+transportBox!.height).toBeLessThanOrEqual(attributionBox!.y);
 await place(page,'Combined',point);await place(page,'Fire',point);
 await page.getByRole('button',{name:'Run',exact:true}).tap();await expect.poll(async()=>Number(await page.getByRole('slider',{name:'Simulation timeline'}).inputValue())).toBeGreaterThanOrEqual(10);await page.getByRole('button',{name:'Pause',exact:true}).tap();await select(page,'Combined 1');await page.getByRole('button',{name:'Rewind to start',exact:true}).tap();await expect(page.getByRole('status',{name:'Simulation time'})).toHaveText('0:00');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'output/playwright/compact-review-legacy-review-mobile.png'});expect(forbidden).toEqual([]);
 }finally{await context.close();}
});

test('native Chrome 200 percent zoom keeps placement and inspection reachable',async({},testInfo)=>{
 const context=await chromium.launchPersistentContext(testInfo.outputPath('chrome-profile'),{channel:'chrome',headless:true,baseURL:'http://127.0.0.1:4001',viewport:{width:1440,height:900},args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{const page=await context.newPage();await page.goto('chrome://settings/appearance');await page.evaluate(()=>new Promise<void>(resolve=>(window as any).chrome.settingsPrivate.setDefaultZoom(2,resolve)));
 const {point,forbidden}=await setup(page);expect(await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio}))).toEqual({width:720,dpr:2});
 for(const name of ['Add sensor','Fire','Weather settings','Land cover','Ecological zones']){const button=page.getByRole('button',{name,exact:true});await expect(button).toBeVisible();expect(await button.evaluate(element=>{const b=element.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('button')===element;})).toBe(true);}
 if(!(await page.locator('.sb-map-legend').evaluate(e=>(e as HTMLDetailsElement).open)))await page.locator('.sb-map-legend>summary').click();
 const fireLegend=page.getByRole('group',{name:'Simulated fire states'});await fireLegend.scrollIntoViewIfNeeded();await expect(fireLegend.getByText('Burned',{exact:true})).toBeVisible();const fireLegendBox=await fireLegend.boundingBox(),firePanel=await page.locator('.sb-map-layers').boundingBox();expect(fireLegendBox!.y).toBeGreaterThanOrEqual(firePanel!.y);expect(fireLegendBox!.y+fireLegendBox!.height).toBeLessThanOrEqual(firePanel!.y+firePanel!.height);await expect(page.locator('.sb-fire-key')).toBeHidden();
 const layerPanel=page.locator('.sb-map-layers'),legendText=page.locator('.sb-map-legend p');await legendText.scrollIntoViewIfNeeded();const layerBox=await layerPanel.boundingBox(),toolsBox=await page.locator('.sb-palette').boundingBox(),legendBox=await legendText.boundingBox();expect(layerBox!.y+layerBox!.height).toBeLessThanOrEqual(toolsBox!.y);expect(legendBox!.y).toBeGreaterThanOrEqual(layerBox!.y);expect(legendBox!.y+legendBox!.height).toBeLessThanOrEqual(layerBox!.y+layerBox!.height);
 await place(page,'Combined',point);await select(page,'Combined 1');await page.screenshot({path:'output/playwright/compact-review-legacy-review-native-zoom.png'});await page.getByRole('button',{name:'Close inspector',exact:true}).click();expect(forbidden).toEqual([]);
 }finally{await context.close();}
});

test('late weather failure cannot replace an imported frozen experiment',async({page})=>{
 const {point}=await setup(page);const frozen=await exported(page);let release!:()=>void,requested!:()=>void,count=0;
 const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>requested=resolve);
 await page.route('**/api/sandbox/weather?**',async route=>{
  if(++count===1){requested();await gate;await route.fulfill({status:503,json:{error:'Old experiment weather failure'}});}else await route.fallback();
 });
 try{
  await page.getByRole('button',{name:'Experiment menu',exact:true}).click();await page.getByRole('button',{name:'New experiment',exact:true}).click();await started;
  await page.locator('input[type=file]').setInputFiles({name:'frozen.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(frozen))});
  await expect(page.getByText('Getting weather…',{exact:true})).toHaveCount(0);
  release();await page.waitForTimeout(200);await expect(page.getByText(/Old experiment weather failure/)).toHaveCount(0);
  await place(page,'Combined',point);await place(page,'Fire',point);await page.getByRole('button',{name:'Run',exact:true}).click();await expect.poll(async()=>Number(await page.getByRole('slider',{name:'Simulation timeline'}).inputValue())).toBeGreaterThanOrEqual(5);await page.getByRole('button',{name:'Pause',exact:true}).click();
 }finally{release();}
});

test('custom numeric hours and legacy thirty-minute model migration remain explicit',async({page})=>{
 const {point}=await setup(page);await place(page,'Combined',point);await place(page,'Fire',point);const original=await exported(page);
 expect(original.scenario.config.durationSec).toBe(21600);expect(original.engineVersion).toBe('surface-grid-1.3.0');
 for(const hours of [1,3,6,12.5,48,1000]){await page.getByRole('button',{name:'Experiment menu',exact:true}).click();await page.getByRole('spinbutton',{name:'Duration in hours',exact:true}).fill(String(hours));await page.getByRole('spinbutton',{name:'Duration in hours',exact:true}).press('Enter');await expect(page.getByRole('slider',{name:'Simulation timeline'})).toHaveAttribute('max',String(hours*3600));await expect(page.getByRole('button',{name:'Close inspector',exact:true})).toHaveCount(0);}
 await weatherSettings(page);await expect(page.getByText('Hold last weather after 384:00:00',{exact:true})).toBeVisible();await closeInspector(page);
 const legacy={...original,engineVersion:'surface-grid-1.1.2',cursorSec:10,computedUntilSec:30,scenario:{...original.scenario,authoritativeTimeSec:30,config:{...original.scenario.config,durationSec:1800}}};
 await page.locator('input[type=file]').setInputFiles({name:'legacy-thirty-minute.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
 await expect(page.getByText('Model updated; run again.',{exact:true})).toBeVisible();await expect(page.getByRole('slider',{name:'Simulation timeline'})).toHaveAttribute('max','1800');await expect(page.locator('main')).toHaveAttribute('data-frame-time','0');
 const migrated=await exported(page);expect(migrated.scenario.config.durationSec).toBe(1800);expect(migrated.engineVersion).toBe('surface-grid-1.3.0');expect(migrated.cursorSec).toBe(0);expect(migrated.computedUntilSec).toBe(0);expect(migrated.scenario.sensors).toEqual(original.scenario.sensors);expect(migrated.environment.landscape.cells[0].sourceClassCode).toBe(original.environment.landscape.cells[0].sourceClassCode);
 await page.getByRole('button',{name:'Experiment menu',exact:true}).click();await expect(page.getByRole('spinbutton',{name:'Duration in hours',exact:true})).toHaveValue('0.5');await page.getByRole('spinbutton',{name:'Duration in hours',exact:true}).fill('12.5');await page.getByRole('spinbutton',{name:'Duration in hours',exact:true}).press('Enter');await expect(page.getByRole('slider',{name:'Simulation timeline'})).toHaveAttribute('max','45000');
});

test('north-up wind and actual map layers preserve the worker checksum',async({page})=>{
 const {point}=await setup(page);await place(page,'Combined',point);await place(page,'Fire',point);
 await page.getByRole('button',{name:'Run',exact:true}).click();await expect.poll(async()=>Number(await page.getByRole('slider',{name:'Simulation timeline'}).inputValue())).toBeGreaterThanOrEqual(10);await page.getByRole('button',{name:'Pause',exact:true}).click();await page.getByRole('slider',{name:'Simulation timeline'}).fill('10');await expect(page.locator('main')).toHaveAttribute('data-frame-time','10');
 const checksum=await page.locator('main').getAttribute('data-frame-checksum');expect(checksum).toMatch(/^[a-f0-9]{64}$/);const before=await exported(page);
 await weatherSettings(page);await expect(page.locator('.sb-wind-panel>p')).toContainText('from W to E');await closeInspector(page);const arrow=await page.locator('.sb-weather-summary .sb-wind').evaluate(element=>{const m=new DOMMatrix(getComputedStyle(element).transform);return {a:m.a,b:m.b};});expect(arrow.a).toBeCloseTo(0,6);expect(arrow.b).toBeCloseTo(1,6);
 const marker=page.getByRole('button',{name:/^Combined 1(?:[: ]|$)/}),position=await marker.boundingBox();await page.locator('.maplibregl-canvas').focus();await page.keyboard.press('Shift+ArrowRight');await page.waitForTimeout(500);const afterPosition=await marker.boundingBox();expect(afterPosition!.x).toBeCloseTo(position!.x,1);expect(afterPosition!.y).toBeCloseTo(position!.y,1);
 if(!(await page.locator('.sb-map-legend').evaluate(e=>(e as HTMLDetailsElement).open)))await page.locator('.sb-map-legend>summary').click();
 await page.getByRole('button',{name:'Ecological zones',exact:true}).click();await expect(page.getByText(/RESOLVE 2017 regional context/)).toBeVisible();await expect(page.locator('main')).toHaveAttribute('data-frame-checksum',checksum!);await page.screenshot({path:'output/playwright/compact-review-legacy-sixhour-ecoregions.png'});
 await page.getByRole('button',{name:'Land cover',exact:true}).click();await expect(page.getByText('Cropland',{exact:true})).toBeVisible();await expect(page.getByText('Built-up',{exact:true})).toBeVisible();await expect(page.locator('main')).toHaveAttribute('data-frame-checksum',checksum!);const after=await exported(page);expect(after.environment).toEqual(before.environment);expect(after.scenario).toEqual(before.scenario);await page.screenshot({path:'output/playwright/compact-review-legacy-sixhour-landcover.png'});
});

test('current-model six-hour saved frontier reconstructs and deterministically rewinds in the real worker',async({page})=>{
 test.setTimeout(600000);const {point}=await setup(page);await place(page,'Combined',point);await place(page,'Fire',point);const current=await exported(page);
 // A declared saved-frontier fixture exercises reconstruction, not six wall-clock hours of playback.
 current.cursorSec=21600;current.computedUntilSec=21600;current.scenario.authoritativeTimeSec=21600;const reconstructionStarted=Date.now();
 await page.locator('input[type=file]').setInputFiles({name:'six-hour-frontier-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(current))});
 await expect(page.locator('main')).toHaveAttribute('data-frame-time','21600',{timeout:240000});console.log('Six-hour reconstruction elapsed ms:',Date.now()-reconstructionStarted);await expect(page.getByRole('status',{name:'Simulation time'})).toHaveText('6:00:00');const finalChecksum=await page.locator('main').getAttribute('data-frame-checksum');
 // Persist the real completed frontier. CPU throttling is only for the pending-save/cancel race; the elapsed measurement above is unthrottled.
 await page.waitForTimeout(2400);const cpu=await page.context().newCDPSession(page);await cpu.send('Emulation.setCPUThrottlingRate',{rate:8});await page.reload();await expect(page.locator('main')).toHaveAttribute('data-reconstructing','true');await expect(page.getByRole('button',{name:'Run',exact:true})).toBeDisabled();await page.waitForTimeout(2400);await expect(page.locator('main')).toHaveAttribute('data-reconstructing','true');await page.reload();await expect(page.locator('main')).toHaveAttribute('data-reconstructing','true');await expect(page.locator('main')).toHaveAttribute('data-frame-checksum',finalChecksum!,{timeout:240000});
 await select(page,'Combined 1');await page.getByText('Reading values',{exact:true}).click();await expect(page.locator('.sb-values tbody tr')).toHaveCount(200);await expect(page.locator('.sb-values tbody tr').last().locator('td').first()).toHaveText('6:00:00');
 await page.getByRole('slider',{name:'Simulation timeline'}).fill('10');await expect(page.locator('main')).toHaveAttribute('data-frame-time','10');await expect(page.locator('.sb-values tbody tr')).toHaveCount(3);const earlier=await page.locator('main').getAttribute('data-frame-checksum');
 // A new worker at t=10 retains the saved six-hour frontier but has no six-hour history cache.
 await page.waitForTimeout(2400);await page.reload();await expect(page.locator('main')).toHaveAttribute('data-frame-checksum',earlier!);await select(page,'Combined 1');await page.getByText('Reading values',{exact:true}).click();
 await page.getByRole('slider',{name:'Simulation timeline'}).fill('21600');await expect(page.getByRole('button',{name:'Cancel reconstruction',exact:true})).toBeVisible();await page.getByRole('button',{name:'Cancel reconstruction',exact:true}).click();await expect(page.locator('main')).toHaveAttribute('data-reconstructing','false');await expect(page.locator('main')).toHaveAttribute('data-frame-checksum',earlier!);await cpu.send('Emulation.setCPUThrottlingRate',{rate:1});await page.getByRole('slider',{name:'Simulation timeline'}).fill('21600');await expect(page.locator('main')).toHaveAttribute('data-frame-checksum',finalChecksum!,{timeout:240000});await page.getByRole('slider',{name:'Simulation timeline'}).fill('10');await expect(page.locator('main')).toHaveAttribute('data-frame-checksum',earlier!);await page.screenshot({path:'output/playwright/compact-review-legacy-sixhour-rewind.png'});
});

test('weather retry after an hour commits a new aligned start time',async({page})=>{
 const {point}=await setup(page);let calls=0;await page.route('**/api/sandbox/weather?**',async route=>{if(++calls===1)await route.fulfill({status:503,json:{error:'Temporary weather outage'}});else await route.fallback();});
 await page.getByRole('button',{name:'Experiment menu',exact:true}).click();await page.getByRole('button',{name:'New experiment',exact:true}).click();await expect(page.getByText(/Temporary weather outage/)).toBeVisible();
 await place(page,'Combined',point);await place(page,'Fire',point);const future=new Date(Date.now()+2*3600000);await page.clock.setFixedTime(future);
 await weatherSettings(page);await page.getByRole('button',{name:'Use API wind',exact:true}).click();await expect(page.getByText(/Temporary weather outage/)).toHaveCount(0);await expect(page.locator('main')).toHaveAttribute('data-frame-time','0');await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled();
 const d=await exported(page);expect(d.scenario.startTime).toBe(d.environment.weather.validAt);expect(Date.parse(d.scenario.startTime)).toBe(future.getTime());await page.getByRole('button',{name:'Run',exact:true}).click();await expect.poll(async()=>Number(await page.getByRole('slider',{name:'Simulation timeline'}).inputValue())).toBeGreaterThanOrEqual(5);await page.getByRole('button',{name:'Pause',exact:true}).click();
});

test('undo during pending new-experiment weather restores a runnable frozen experiment',async({page})=>{
 const {point}=await setup(page);await place(page,'Combined',point);await place(page,'Fire',point);
 let release!:()=>void,requested!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>requested=resolve);
 let intercepted=false;await page.route('**/api/sandbox/weather?**',async route=>{if(intercepted){await route.fallback();return;}intercepted=true;requested();await gate;await route.fulfill({status:503,json:{error:'Discarded weather request'}});});
 try{await page.getByRole('button',{name:'Experiment menu',exact:true}).click();await page.getByRole('button',{name:'New experiment',exact:true}).click();await started;await page.getByRole('button',{name:'Undo last edit',exact:true}).click();release();await page.waitForTimeout(150);await expect(page.getByText(/Discarded weather request/)).toHaveCount(0);await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Run',exact:true}).click();await expect.poll(async()=>Number(await page.getByRole('slider',{name:'Simulation timeline'}).inputValue())).toBeGreaterThanOrEqual(5);await page.getByRole('button',{name:'Pause',exact:true}).click();const d=await exported(page);expect(d.scenario.sensors).toHaveLength(1);expect(d.scenario.ignitions).toHaveLength(1);
 }finally{release();}
});

test('ten-minute browser-worker fire remains visible after public map zoom',async({page})=>{
 const {point,forbidden}=await setup(page);await place(page,'Fire',point);await page.locator('.sb-speed summary').click();await page.getByRole('button',{name:'60×',exact:true}).click();await page.getByRole('button',{name:'Run',exact:true}).click();
 await expect.poll(async()=>Number(await page.getByRole('slider',{name:'Simulation timeline'}).inputValue()),{timeout:45000}).toBeGreaterThanOrEqual(600);await page.getByRole('button',{name:'Pause',exact:true}).click();
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();await page.getByRole('button',{name:'Zoom in',exact:true}).click();await page.waitForTimeout(500);await page.screenshot({path:'output/playwright/compact-review-legacy-review-fire.png'});
 expect(forbidden).toEqual([]);
});

test('real arbitrary area prepares through HTTP then runs four profiles and reconstructs twelve-and-a-half hours',async({page})=>{
 test.setTimeout(240000);const {point:oldPoint,forbidden}=await setup(page);await place(page,'Combined',oldPoint);
 await page.getByRole('button',{name:'Experiment menu',exact:true}).click();await page.getByRole('spinbutton',{name:'Duration in hours',exact:true}).fill('12.5');await page.getByRole('spinbutton',{name:'Duration in hours',exact:true}).press('Enter');await expect(page.getByRole('slider',{name:'Simulation timeline'})).toHaveAttribute('max','45000');
 await page.getByRole('button',{name:'Experiment menu',exact:true}).click();await page.getByText('Choose another area',{exact:true}).click();await page.getByRole('spinbutton',{name:'Area latitude',exact:true}).fill('48.4');await page.getByRole('spinbutton',{name:'Area longitude',exact:true}).fill('24.5');await page.getByRole('spinbutton',{name:'Area width in km',exact:true}).fill('1');
 await page.unroute('**/api/sandbox/weather?**'); // Subsequent weather requests use the actual backend; fresh Run may reuse this prepared snapshot.
 // No route interception for this POST: real backend, raster providers and server-side weather.
 const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/sandbox/environment/prepare')&&r.request().method()==='POST',{timeout:90000});await page.getByRole('button',{name:'Prepare this area',exact:true}).click();const response=await responsePromise;expect(response.status()).toBe(200);const environment=await response.json() as EnvironmentSnapshot;
 expect(environment.landscape.cells).toHaveLength(1600);expect(environment.landscape.provenance.every(p=>!p.sample)).toBe(true);expect(environment.weather.provenance.some(p=>p.provider==='Open-Meteo')).toBe(true);expect(environment.weather.samples.at(-1)!.timeSec).toBeGreaterThanOrEqual(45000);
 await expect(page.getByRole('button',{name:'Close inspector',exact:true})).toHaveCount(0);await expect(page.locator('.sb-marker-label')).toHaveCount(1);
 // Keep this historical four-profile journey explicit; the product fresh-area count is asserted above.
 const emptyArea=await exported(page);emptyArea.scenario.sensors=[];emptyArea.scenario.revision++;await page.locator('input[type=file]').setInputFiles({name:'explicit-empty-real-area-scene.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(emptyArea))});await expect(page.locator('.sb-marker-label')).toHaveCount(0);
 const grid=environment.landscape,index=grid.cells.findIndex((c,i)=>c.burnable&&i%grid.width>=grid.width*.35&&i%grid.width<=grid.width*.65&&Math.floor(i/grid.width)>=grid.height*.35&&Math.floor(i/grid.width)<=grid.height*.65);expect(index).toBeGreaterThanOrEqual(0);
 const point={longitude:grid.bounds.west+(index%grid.width+.5)/grid.width*(grid.bounds.east-grid.bounds.west),latitude:grid.bounds.south+(Math.floor(index/grid.width)+.5)/grid.height*(grid.bounds.north-grid.bounds.south)};
 for(const name of ['Combined','Temperature','Humidity','Smoke'])await place(page,name,point);await place(page,'Fire',point);await page.getByRole('button',{name:'Run',exact:true}).click();await expect.poll(async()=>Number(await page.getByRole('slider',{name:'Simulation timeline'}).inputValue())).toBeGreaterThanOrEqual(10);await page.getByRole('button',{name:'Pause',exact:true}).click();await page.getByRole('slider',{name:'Simulation timeline'}).fill('10');await expect(page.locator('main')).toHaveAttribute('data-frame-time','10');const early=await page.locator('main').getAttribute('data-frame-checksum');
 await select(page,'Combined 1');await page.getByText('Reading values',{exact:true}).click();await expect(page.locator('.sb-values tbody tr')).toHaveCount(3);const readings=await page.locator('.sb-values tbody').textContent();await page.waitForTimeout(2200);await page.reload();await expect(page.locator('main')).toHaveAttribute('data-frame-checksum',early!);await select(page,'Combined 1');await page.getByText('Reading values',{exact:true}).click();await expect(page.locator('.sb-values tbody')).toHaveText(readings!);await page.screenshot({path:'output/playwright/compact-review-legacy-arbitrary-area-live.png'});
 const current=await exported(page);expect(current.environment.landscape).toEqual(environment.landscape);expect(current.environment.weather.provenance.some(p=>p.provider==='Open-Meteo'&&!p.sample)).toBe(true);expect(current.scenario.sensors.map(s=>s.capabilities.length)).toEqual([3,1,1,1]);
 // Explicit saved-frontier input fixture; actual worker computes every required state.
 current.cursorSec=45000;current.computedUntilSec=45000;current.scenario.authoritativeTimeSec=45000;await page.locator('input[type=file]').setInputFiles({name:'real-area-twelve-hour-frontier.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(current))});await expect(page.locator('main')).toHaveAttribute('data-frame-time','45000',{timeout:90000});const endChecksum=await page.locator('main').getAttribute('data-frame-checksum');await select(page,'Combined 1');await expect(page.locator('.sb-history-note')).toHaveCount(0);await page.getByText('Reading values',{exact:true}).click();await expect(page.locator('.sb-values tbody tr')).toHaveCount(200);await expect(page.locator('.sb-values tbody tr').last().locator('td').first()).toHaveText('12:30:00');await expect(page.getByRole('img',{name:/Temperature received through/})).toContainText('0:00');await page.screenshot({path:'output/playwright/compact-review-legacy-twelve-hour-history.png'});
 await page.getByRole('slider',{name:'Simulation timeline'}).fill('10');await expect(page.locator('main')).toHaveAttribute('data-frame-checksum',early!);await expect(page.locator('.sb-values tbody tr')).toHaveCount(3);await expect(page.getByText(/Recent readings received from/)).toHaveCount(0);await page.getByRole('slider',{name:'Simulation timeline'}).fill('45000');await expect(page.locator('main')).toHaveAttribute('data-frame-checksum',endChecksum!);expect(forbidden).toEqual([]);
});

test('cancelled and failed area preparation retain the current scenario',async({page})=>{
 const {point}=await setup(page);await place(page,'Combined',point);await place(page,'Fire',point);const before=await exported(page);let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>release=r),requested=new Promise<void>(r=>started=r);
 // Explicit failure fixture, never presented as successful internal integration.
 await page.route('**/api/sandbox/environment/prepare',async route=>{started();await gate;await route.fulfill({status:503,json:{error:'Controlled provider outage'}}).catch(()=>{});});
 try{await page.getByRole('region',{name:'Terrain map',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('dialog',{name:'Choose simulation region'}).getByRole('button',{name:'Confirm',exact:true}).click();await requested;await page.locator('.sb-notice').getByRole('button',{name:'Cancel',exact:true}).click();release();await page.waitForTimeout(100);const cancelled=await exported(page);expect(cancelled.environment).toEqual(before.environment);expect(cancelled.scenario).toEqual(before.scenario);await expect(page.getByText(/Controlled provider outage/)).toHaveCount(0);
 await page.getByRole('region',{name:'Terrain map',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('dialog',{name:'Choose simulation region'}).getByRole('button',{name:'Confirm',exact:true}).click();await expect(page.getByText(/Area preparation failed.*Controlled provider outage/)).toBeVisible();const failed=await exported(page);expect(failed.environment).toEqual(before.environment);expect(failed.scenario).toEqual(before.scenario);await page.getByRole('button',{name:'Run',exact:true}).click();await expect.poll(async()=>Number(await page.getByRole('slider',{name:'Simulation timeline'}).inputValue())).toBeGreaterThanOrEqual(5);await page.getByRole('button',{name:'Pause',exact:true}).click();
 }finally{release();}
});

test('320px narrow workspace exposes area and numeric-duration controls',async({browser})=>{
 const context=await browser.newContext({baseURL:'http://127.0.0.1:4001',viewport:{width:320,height:740},hasTouch:true,isMobile:true});const page=await context.newPage();try{await setup(page);for(const name of ['Weather settings','Land cover','Ecological zones','Zoom in']){const button=page.getByRole('button',{name,exact:true});await expect(button).toBeVisible();expect(await button.evaluate(e=>{const b=e.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('button')===e;})).toBe(true);}await page.getByRole('button',{name:'Experiment menu',exact:true}).tap();await page.getByRole('spinbutton',{name:'Duration in hours',exact:true}).fill('12.5');await page.getByRole('spinbutton',{name:'Duration in hours',exact:true}).press('Enter');await expect(page.getByRole('slider',{name:'Simulation timeline'})).toHaveAttribute('max','45000');await page.getByRole('button',{name:'Experiment menu',exact:true}).tap();await page.getByText('Choose another area',{exact:true}).tap();for(const [name,value] of [['Area latitude','48.4'],['Area longitude','24.5'],['Area width in km','1']]){const input=page.getByRole('spinbutton',{name,exact:true});await input.fill(value);await expect(input).toHaveValue(value);}const prepare=page.getByRole('button',{name:'Prepare this area',exact:true});await prepare.scrollIntoViewIfNeeded();expect(await prepare.evaluate(e=>{const b=e.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('button')===e;})).toBe(true);await page.screenshot({path:'output/playwright/compact-review-legacy-area-mobile-320.png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}finally{await context.close();}
});

test('regional tile failure can retry real upstream without changing simulation inputs',async({page})=>{
 let fail=true,recovered=0;await page.route('**/api/sandbox/map/tiles/landcover/**',async route=>{if(fail)await route.fulfill({status:503,json:{error:'Controlled tile outage'}});else await route.fallback();});page.on('response',response=>{if(!fail&&response.url().includes('/api/sandbox/map/tiles/landcover/')&&response.status()===200)recovered++;});
 await setup(page);await expect(page.getByRole('button',{name:'Retry layer',exact:true})).toBeVisible();await expect(page.locator('main')).toHaveAttribute('data-frame-time','0');const checksum=await page.locator('main').getAttribute('data-frame-checksum');const before=await exported(page);fail=false;await page.getByRole('button',{name:'Retry layer',exact:true}).click();await expect.poll(()=>recovered,{timeout:30000}).toBeGreaterThan(0);await expect(page.getByRole('button',{name:'Retry layer',exact:true})).toHaveCount(0);await expect(page.locator('main')).toHaveAttribute('data-frame-checksum',checksum!);const after=await exported(page);expect(after.environment).toEqual(before.environment);await page.screenshot({path:'output/playwright/compact-review-legacy-tile-recovery.png'});
});
