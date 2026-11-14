import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import dotenv from 'dotenv';
import type {EnvironmentSnapshot,Scenario,SimulationFrame} from '@dryspell/contracts';
dotenv.config({path:'.env.test',quiet:true});

test('ten simulated minutes produce a visible physical fire footprint',async({page})=>{
  const login=await page.request.post('/api/v1/auth/login',{data:{username:process.env.DRYSPELL_TEST_USERNAME||'admin',password:process.env.DRYSPELL_TEST_PASSWORD}});
  expect(login.ok()).toBe(true);const session=await login.json(),headers={'X-CSRF-Token':session.csrfToken};
  const environment=await page.request.get('/api/v1/environment').then(r=>r.json()) as EnvironmentSnapshot;
  const grid=environment.landscape;
  const index=grid.cells.findIndex((c,i)=>c.burnable&&c.cover==='grass'&&i%grid.width>grid.width*.4&&i%grid.width<grid.width*.6&&Math.floor(i/grid.width)>grid.height*.4&&Math.floor(i/grid.width)<grid.height*.6);
  expect(index).toBeGreaterThanOrEqual(0);
  const location={longitude:grid.bounds.west+(index%grid.width+.5)/grid.width*(grid.bounds.east-grid.bounds.west),latitude:grid.bounds.south+(Math.floor(index/grid.width)+.5)/grid.height*(grid.bounds.north-grid.bounds.south)};
  const created=await page.request.post('/api/v1/scenarios',{headers,data:{name:'Prepared landscape · ten-minute spread',sensors:[],ignitions:[{id:randomUUID(),location,timeSec:0}],config:{durationSec:600}}});
  expect(created.ok()).toBe(true);const scenario=await created.json() as Scenario;
  await page.goto('/?scenario='+scenario.id);await expect(page.getByTitle(scenario.name,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Run',exact:true}).click();
  await expect.poll(async()=>page.request.get('/api/v1/scenarios/'+scenario.id).then(r=>r.json()).then(s=>s.authoritativeTimeSec),{timeout:180000}).toBe(600);
  const final=await page.request.get(`/api/v1/scenarios/${scenario.id}/state?at=600&revision=${scenario.revision}`).then(r=>r.json()) as SimulationFrame;
  expect(final.burningCells.length+final.burnedCells.length).toBeGreaterThan(4);
  await expect(page.getByLabel('Simulation time',{exact:true})).toHaveValue('600');
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await page.getByRole('button',{name:'Inspect ignition',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Ignition',exact:true})).toBeVisible();
  await expect.poll(async()=>Number(await page.getByTestId('terrain-map').getAttribute('data-rendered-fire-count'))).toBeGreaterThan(0);
  await page.screenshot({path:'output/playwright/14-ten-minute-fire.png'});
});
