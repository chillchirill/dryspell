import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import dotenv from 'dotenv';
import type {EnvironmentSnapshot,Scenario,SimulationFrame,SessionInfo} from '@dryspell/contracts';

dotenv.config({path:'.env.test',quiet:true});

test('chart shows received frame observations while actual history is delayed, then merges rewind history',async({page})=>{
  const login=await page.request.post('/api/v1/auth/login',{data:{username:process.env.DRYSPELL_TEST_USERNAME||'admin',password:process.env.DRYSPELL_TEST_PASSWORD}});
  expect(login.ok()).toBe(true);
  const session=await login.json() as SessionInfo,headers={'X-CSRF-Token':session.csrfToken!};
  const environment=await page.request.get('/api/v1/environment').then(r=>r.json()) as EnvironmentSnapshot;
  const grid=environment.landscape,index=grid.cells.findIndex(c=>c.burnable&&c.cover==='grass');
  expect(index).toBeGreaterThanOrEqual(0);
  const location={longitude:grid.bounds.west+(index%grid.width+.5)/grid.width*(grid.bounds.east-grid.bounds.west),latitude:grid.bounds.south+(Math.floor(index/grid.width)+.5)/grid.height*(grid.bounds.north-grid.bounds.south)};
  let scenario=await page.request.post('/api/v1/scenarios',{headers,data:{name:`Chart regression ${Date.now()}`}}).then(r=>r.json()) as Scenario;
  const sensorId=randomUUID();
  const edited=await page.request.patch(`/api/v1/scenarios/${scenario.id}`,{headers,data:{revision:scenario.revision,config:{durationSec:30},sensors:[{id:sensorId,deviceId:`chart-${sensorId}`,name:'Chart combined',source:'simulated',profileId:'combined',location,expectedIntervalSec:5,enabled:true,tags:[],simulationFaults:[{type:'stuck',startTimeSec:0,endTimeSec:30,channels:['smokePct'],value:0},{type:'dropout',startTimeSec:5,endTimeSec:15,channels:['humidityPct']}]}],ignitions:[{id:randomUUID(),location,timeSec:0}]}});
  expect(edited.ok()).toBe(true);scenario=await edited.json() as Scenario;
  expect((await page.request.post(`/api/v1/scenarios/${scenario.id}/run`,{headers,data:{}})).ok()).toBe(true);
  await expect.poll(async()=>page.request.get(`/api/v1/scenarios/${scenario.id}`).then(r=>r.json()).then(s=>s.authoritativeTimeSec),{timeout:90000}).toBeGreaterThanOrEqual(20);
  await page.request.post(`/api/v1/scenarios/${scenario.id}/pause`,{headers,data:{}});
  const target=await page.request.get(`/api/v1/scenarios/${scenario.id}/state?at=10&revision=${scenario.revision}`).then(r=>r.json()) as SimulationFrame;
  const targetObservation=target.readings.find(o=>o.sensorId===sensorId)!;
  expect(targetObservation.values.smokePct).toBe(0);
  expect(targetObservation.values.humidityPct).toBeUndefined();

  // Delay delivery of a real response; no authentication, database, worker or history data is mocked.
  let releaseHistory!:()=>void;
  const gate=new Promise<void>(resolve=>{releaseHistory=resolve;});
  await page.route(url=>url.pathname===`/api/v1/scenarios/${scenario.id}/readings`,async route=>{
    const response=await route.fetch();await gate;
    if(!page.isClosed())await route.fulfill({response});
  });
  try{
    await page.goto(`/?scenario=${scenario.id}`);
    await expect(page.getByRole('button',{name:'Rewind to start',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Rewind to start',exact:true}).click();
    await page.getByRole('button',{name:'Step forward 5 seconds',exact:true}).click();
    await page.getByRole('button',{name:'Step forward 5 seconds',exact:true}).click();
    await page.getByRole('button',{name:'Open sensor list',exact:true}).click();
    await page.getByRole('button',{name:/^Chart combined /}).click();
    const history=page.getByTestId('measurement-history');
    await expect(history).toHaveAttribute('data-cursor',target.timestamp);
    await expect(history).toHaveAttribute('data-sample-count','1');
    await expect(history.getByText(/^No readings at this time/)).toHaveCount(0);
    await history.getByText('Accessible reading table',{exact:true}).click();
    const currentRow=history.locator(`tr[data-observation-id="${targetObservation.id}"]`);
    await expect(currentRow.locator('td').nth(1)).toHaveText(targetObservation.values.temperatureC!.toFixed(2));
    await expect(currentRow.locator('td').nth(2)).toHaveText('No reading');
    await expect(currentRow.locator('td').nth(3)).toHaveText('0.00');
    releaseHistory();
    await expect(history).toHaveAttribute('data-sample-count','3');
    const times=await history.locator('tbody tr').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-recorded-at')));
    expect(times.every(time=>time!==null&&Date.parse(time)<=Date.parse(target.timestamp))).toBe(true);
    await page.screenshot({path:'output/playwright/11-chart-rewind-regression.png'});
  }finally{releaseHistory();}
});
