import {test,expect,type Page} from '@playwright/test';
import dotenv from 'dotenv';
import type {EnvironmentSnapshot,Scenario} from '@dryspell/contracts';
dotenv.config({path:'.env.test',quiet:true});
async function login(page:Page){
  await page.getByRole('button',{name:'Add sensor',exact:true}).click();
  await page.getByLabel('Username',{exact:true}).fill(process.env.DRYSPELL_TEST_USERNAME||'admin');
  await page.getByLabel('Password',{exact:true}).fill(process.env.DRYSPELL_TEST_PASSWORD!);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function closePanel(page:Page){const button=page.getByRole('button',{name:'Close inspector',exact:true});if(await button.isVisible())await button.click();}
test('map placement, actual persisted run, capability inspection and deterministic rewind',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByTestId('terrain-map')).toBeVisible();
  await expect(page.getByLabel('Workspace context')).toHaveValue('simulation');
  await login(page);
  const session=await page.request.get('/api/v1/auth/session').then(r=>r.json());
  const environment=await page.request.get('/api/v1/environment').then(r=>r.json()) as EnvironmentSnapshot;
  const created=await page.request.post('/api/v1/scenarios',{headers:{'X-CSRF-Token':session.csrfToken},data:{name:'Browser acceptance '+Date.now(),sensors:[],ignitions:[]}});expect(created.ok()).toBe(true);let scenario=await created.json() as Scenario;
  await page.goto('/?scenario='+scenario.id);
  await expect(page.getByTitle(scenario.name,{exact:true})).toBeVisible();
  await page.screenshot({path:'output/playwright/01-empty-map.png'});
  // Actual map click for first sensor. No internal APIs or storage are mocked.
  await page.getByRole('button',{name:'Add sensor',exact:true}).click();
  await page.getByRole('group',{name:'Sensor profile',exact:true}).getByRole('button',{name:'Combined',exact:true}).click();
  await page.getByTestId('terrain-map').click({position:{x:660,y:440}});
  await expect.poll(async()=>{const s=await page.request.get('/api/v1/scenarios/'+scenario.id).then(r=>r.json());return s.sensors.length;}).toBe(1);
  await closePanel(page);
  // Keyboard/numeric alternatives use the same persisted placement operation.
  const g=environment.landscape;
  let index=g.cells.findIndex((c,i)=>c.burnable&&c.cover==='grass'&&i%g.width>g.width*.3&&i%g.width<g.width*.7&&Math.floor(i/g.width)>g.height*.3&&Math.floor(i/g.width)<g.height*.7);
  if(index<0)index=g.cells.findIndex(c=>c.burnable);
  const coordinate={longitude:g.bounds.west+(index%g.width+.5)/g.width*(g.bounds.east-g.bounds.west),latitude:g.bounds.south+(Math.floor(index/g.width)+.5)/g.height*(g.bounds.north-g.bounds.south)};
  for(const profile of ['Temperature','Humidity','Smoke']){
    await page.getByRole('button',{name:'Add sensor',exact:true}).click();
    await page.getByRole('group',{name:'Sensor profile',exact:true}).getByRole('button',{name:profile,exact:true}).click();
    await page.getByRole('button',{name:'Coordinates',exact:true}).click();
    await page.getByLabel('Latitude',{exact:true}).fill(String(coordinate.latitude));
    await page.getByLabel('Longitude',{exact:true}).fill(String(coordinate.longitude));
    await page.getByRole('button',{name:'Place object',exact:true}).click();
    await expect(page.getByRole('heading',{name:new RegExp('^'+profile+' ')})).toBeVisible();
    await closePanel(page);
  }
  await page.reload();
  await expect(page.getByTitle(scenario.name,{exact:true})).toBeVisible();
  await expect.poll(async()=>{scenario=await page.request.get('/api/v1/scenarios/'+scenario.id).then(r=>r.json());return scenario.sensors.length;}).toBe(4);
  expect(new Set(scenario.sensors.map(s=>s.profileId)).size).toBe(4);
  const moving=scenario.sensors.find(s=>s.profileId==='temperature')!;
  await page.getByRole('button',{name:'Open sensor list',exact:true}).click();
  await page.getByRole('button',{name:new RegExp('^'+moving.name+' ')}).click();
  await page.getByRole('button',{name:'Move',exact:true}).click();
  await page.getByRole('button',{name:'Coordinates',exact:true}).first().click();
  await page.getByLabel('Longitude',{exact:true}).fill(String(moving.location.longitude+.0002));
  await page.getByRole('button',{name:'Preview position',exact:true}).click();
  await page.getByRole('button',{name:'Cancel movement',exact:true}).click();
  const cancelled=await page.request.get('/api/v1/scenarios/'+scenario.id).then(r=>r.json());
  expect(cancelled.sensors.find((s:any)=>s.id===moving.id).location).toEqual(moving.location);
  await closePanel(page);
  // Water rejection preserves the active ignition tool.
  const water=g.cells.findIndex(c=>c.cover==='water');
  await page.getByRole('button',{name:'Add ignition',exact:true}).click();
  await page.getByRole('button',{name:'Coordinates',exact:true}).click();
  if(water>=0){
    await page.getByLabel('Latitude',{exact:true}).fill(String(g.bounds.south+(Math.floor(water/g.width)+.5)/g.height*(g.bounds.north-g.bounds.south)));
    await page.getByLabel('Longitude',{exact:true}).fill(String(g.bounds.west+(water%g.width+.5)/g.width*(g.bounds.east-g.bounds.west)));
    await page.getByRole('button',{name:'Place object',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText(/cannot burn|non-burnable/);
  }
  await page.getByLabel('Latitude',{exact:true}).fill(String(coordinate.latitude));
  await page.getByLabel('Longitude',{exact:true}).fill(String(coordinate.longitude));
  await page.getByRole('button',{name:'Place object',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Ignition',exact:true})).toBeVisible();await closePanel(page);
  await page.getByRole('button',{name:'Run',exact:true}).click();
  await expect(page.getByRole('button',{name:'Pause run',exact:true})).toBeVisible();
  await expect.poll(async()=>{scenario=await page.request.get('/api/v1/scenarios/'+scenario.id).then(r=>r.json());return scenario.authoritativeTimeSec;},{timeout:90000}).toBeGreaterThanOrEqual(30);
  await page.screenshot({path:'output/playwright/02-running.png'});
  await page.getByRole('button',{name:'Pause run',exact:true}).click();
  await expect(page.getByRole('button',{name:'Run',exact:true})).toBeVisible();
  const before=await page.request.get(`/api/v1/scenarios/${scenario.id}/state?at=10&revision=${scenario.revision}`).then(r=>r.json());
  await page.getByRole('button',{name:'Rewind to start',exact:true}).click();
  await expect(page.getByLabel('Simulation time',{exact:true})).toHaveValue('0');
  await page.getByRole('button',{name:'Step forward 5 seconds',exact:true}).click();
  await page.getByRole('button',{name:'Step forward 5 seconds',exact:true}).click();
  await expect(page.getByLabel('Simulation time',{exact:true})).toHaveValue('10');
  await page.getByRole('button',{name:'Open sensor list',exact:true}).click();
  const temp=scenario.sensors.find(s=>s.profileId==='temperature')!;
  await page.getByRole('button',{name:new RegExp('^'+temp.name+' ')}).click();
  await expect(page.getByText('Not supported',{exact:true})).toHaveCount(2);
  await page.getByText('Accessible reading table',{exact:true}).click();
  await expect(page.getByRole('region',{name:'Measurement history'}).locator('tbody tr')).toHaveCount(3);
  await page.screenshot({path:'output/playwright/03-selected-rewind.png'});
  await closePanel(page);
  await page.getByRole('button',{name:'Inspect terrain',exact:true}).click();
  await page.getByRole('button',{name:'Coordinates',exact:true}).click();
  await page.getByLabel('Latitude',{exact:true}).fill(String(coordinate.latitude));
  await page.getByLabel('Longitude',{exact:true}).fill(String(coordinate.longitude));
  await page.getByRole('button',{name:'Inspect terrain',exact:true}).last().click();
  await expect(page.getByText(environment.id,{exact:true})).toBeVisible();
  await page.screenshot({path:'output/playwright/04-terrain-inspection.png'});
  await closePanel(page);
  await page.getByRole('button',{name:'Map layers',exact:true}).click();
  await page.getByLabel('Effective land cover',{exact:true}).uncheck();
  const after=await page.request.get(`/api/v1/scenarios/${scenario.id}/state?at=10&revision=${scenario.revision}`).then(r=>r.json());expect(after.checksum).toBe(before.checksum);
  await page.getByLabel('Effective land cover',{exact:true}).check();
  await page.getByRole('button',{name:'Compare',exact:true}).click();
  await page.getByRole('button',{name:'Estimate from observations',exact:true}).click();
  await expect(page.getByText(/Issued .*uncalibrated/)).toBeVisible({timeout:60000});
  await expect.poll(async()=>Number(await page.getByTestId('terrain-map').getAttribute('data-rendered-estimate-count'))).toBeGreaterThan(0);
  await page.screenshot({path:'output/playwright/05-compare.png'});
  await closePanel(page);
  await page.goto(`/?scenario=${scenario.id}&study=shelf`);
  await expect(page.getByTitle(scenario.name,{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Add sensor',exact:true})).toBeEnabled();
  await page.screenshot({path:'output/playwright/06-shelf-study.png'});
  await page.goto(`/?scenario=${scenario.id}&study=strip`);
  await expect(page.getByTitle(scenario.name,{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Add sensor',exact:true})).toBeEnabled();
  await page.screenshot({path:'output/playwright/07-strip-study.png'});
  for(const [width,height] of [[1280,800],[768,1024],[390,844],[320,844]]){
    await page.setViewportSize({width,height});await expect(page.getByTestId('terrain-map')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`output/playwright/viewport-${width}.png`});
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Open sensor list',exact:true}).click();
  await page.getByRole('button',{name:new RegExp('^'+temp.name+' ')}).click();
  await expect(page.getByRole('heading',{name:temp.name,exact:true})).toBeVisible();
  await page.screenshot({path:'output/playwright/08-mobile-inspector.png'});
  await closePanel(page);
  await page.getByRole('button',{name:'Add sensor',exact:true}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Select objects',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.setViewportSize({width:720,height:450});
  await page.screenshot({path:'output/playwright/09-zoom-equivalent-200.png'});
  expect(errors).toEqual([]);
});

test('touch placement and Live telemetry remain in the map workspace',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,baseURL:process.env.DRYSPELL_BASE_URL??'http://127.0.0.1:4000'});
  const page=await context.newPage();
  try{
    await page.goto('/');await expect(page.getByRole('button',{name:'Add sensor',exact:true})).toBeEnabled();await login(page);
    const session=await page.request.get('/api/v1/auth/session').then(r=>r.json());
    const deviceId='browser-live-'+Date.now();
    const created=await page.request.post('/api/v1/sensors',{headers:{'X-CSRF-Token':session.csrfToken},data:{deviceId,name:'Touch live sensor',source:'real',profileId:'smoke',location:{latitude:53.025,longitude:-6.35},expectedIntervalSec:60,enabled:true,tags:['browser']}});expect(created.ok()).toBe(true);
    const sensor=await created.json();const credential=await page.request.post(`/api/v1/sensors/${sensor.id}/credentials`,{headers:{'X-CSRF-Token':session.csrfToken},data:{}}).then(r=>r.json());
    await page.getByLabel('Workspace context').selectOption('live');
    await page.getByRole('button',{name:'Open sensor list',exact:true}).tap();
    await page.getByLabel('Find sensor',{exact:true}).fill(deviceId);
    await page.getByRole('button',{name:new RegExp('^Touch live sensor ')}).tap();
    const response=await page.request.post('/api/v1/telemetry',{headers:{authorization:`Bearer ${credential.token}`},data:{deviceId,messageId:'ui-zero',smokePct:0}});expect(response.ok()).toBe(true);
    await expect(page.getByText('Not supported',{exact:true})).toHaveCount(2);
    await expect(page.locator('[data-channel="smokePct"] strong')).toHaveText('0.0');
    await page.screenshot({path:'output/playwright/10-touch-live-zero.png'});
    await page.getByLabel('Workspace context').selectOption('history');
    const cursor=await page.getByLabel('History selected time').inputValue();
    await page.request.post('/api/v1/telemetry',{headers:{authorization:`Bearer ${credential.token}`},data:{deviceId,messageId:'ui-next',smokePct:80}});
    await expect(page.getByLabel('History selected time')).toHaveValue(cursor);
    await closePanel(page);
    await page.getByLabel('Workspace context').selectOption('simulation');
    await page.getByRole('button',{name:'Add sensor',exact:true}).tap();
    await page.getByRole('button',{name:'Cancel placement',exact:true}).tap();
    await expect(page.getByRole('button',{name:'Select objects',exact:true})).toHaveAttribute('aria-pressed','true');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const terrain=await page.request.get('/api/v1/environment').then(r=>r.json()) as EnvironmentSnapshot;
    const grid=terrain.landscape,index=grid.cells.findIndex(c=>c.burnable&&c.cover==='grass');
    const location={longitude:grid.bounds.west+(index%grid.width+.5)/grid.width*(grid.bounds.east-grid.bounds.west),latitude:grid.bounds.south+(Math.floor(index/grid.width)+.5)/grid.height*(grid.bounds.north-grid.bounds.south)};
    const made=await page.request.post('/api/v1/scenarios',{headers:{'X-CSRF-Token':session.csrfToken},data:{name:'Touch placement '+Date.now()}});
    expect(made.ok()).toBe(true);const touchScenario=await made.json() as Scenario;
    await page.goto('/?scenario='+touchScenario.id);
    await expect(page.getByRole('button',{name:'Add sensor',exact:true})).toBeEnabled();
    for(const tool of ['Add sensor','Add ignition']){
      await page.getByRole('button',{name:tool,exact:true}).tap();
      await page.getByRole('button',{name:'Coordinates',exact:true}).tap();
      await page.getByLabel('Latitude',{exact:true}).fill(String(location.latitude));
      await page.getByLabel('Longitude',{exact:true}).fill(String(location.longitude));
      await page.getByRole('button',{name:'Place object',exact:true}).tap();
      await expect(page.getByRole('heading',{name:tool==='Add sensor'?'Combined 1':'Ignition',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Close inspector',exact:true}).tap();
    }
    await page.getByRole('button',{name:'Run',exact:true}).tap();
    await expect.poll(async()=>page.request.get('/api/v1/scenarios/'+touchScenario.id).then(r=>r.json()).then(s=>s.authoritativeTimeSec),{timeout:90000}).toBeGreaterThanOrEqual(10);
    await page.getByRole('button',{name:'Pause run',exact:true}).tap();
    await expect(page.getByRole('button',{name:'Run',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Rewind to start',exact:true}).tap();
    await expect(page.getByLabel('Simulation time',{exact:true})).toHaveValue('0');
    await page.getByRole('button',{name:'Open sensor list',exact:true}).tap();
    await page.getByRole('button',{name:/^Combined 1 /}).tap();
    await expect(page.getByRole('heading',{name:'Combined 1',exact:true})).toBeVisible();
    await page.screenshot({path:'output/playwright/15-touch-simulation-rewind.png'});
  }finally{await context.close();}
});
