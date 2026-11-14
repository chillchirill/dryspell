import {test,expect} from '@playwright/test';
import dotenv from 'dotenv';
dotenv.config({path:'.env.test',quiet:true});

test('keyboard placement preserves a failed draft, retries, undoes and saves movement',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Add sensor',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Add sensor',exact:true}).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Username',{exact:true}).fill(process.env.DRYSPELL_TEST_USERNAME||'admin');
  await page.getByLabel('Password',{exact:true}).fill(process.env.DRYSPELL_TEST_PASSWORD!);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const session=await page.request.get('/api/v1/auth/session').then(r=>r.json());
  const made=await page.request.post('/api/v1/scenarios',{headers:{'X-CSRF-Token':session.csrfToken},data:{name:'Keyboard recovery '+Date.now(),sensors:[],ignitions:[]}});
  expect(made.ok()).toBe(true);const scenario=await made.json();
  const read=()=>page.request.get('/api/v1/scenarios/'+scenario.id).then(r=>r.json());
  await page.goto('/?scenario='+scenario.id);
  await expect(page.getByTitle(scenario.name,{exact:true})).toBeVisible();
  await page.keyboard.press('s');
  await page.mouse.move(400,400);await page.mouse.down();
  await page.mouse.move(455,425,{steps:8});await page.mouse.up();
  expect((await read()).sensors).toHaveLength(0);
  await page.getByRole('button',{name:'Coordinates',exact:true}).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Latitude',{exact:true}).fill('53.025');
  await page.getByLabel('Longitude',{exact:true}).fill('-6.35');
  // Explicit fault injection only. Retry and every persisted assertion use the actual API/DB.
  let fail=true;
  await page.route('**/api/v1/scenarios/'+scenario.id,async route=>{
    if(fail&&route.request().method()==='PATCH'){fail=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEST_OUTAGE',message:'Temporary test outage'}})});}
    else await route.continue();
  });
  await page.getByRole('button',{name:'Place object',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Temporary test outage');
  expect((await read()).sensors).toHaveLength(0);
  await expect(page.getByLabel('Latitude',{exact:true})).toHaveValue('53.025');
  await page.getByRole('button',{name:'Retry save',exact:true}).focus();await page.keyboard.press('Enter');
  await expect.poll(async()=>(await read()).sensors.length).toBe(1);
  await page.unroute('**/api/v1/scenarios/'+scenario.id);
  await page.getByRole('button',{name:'Undo last edit',exact:true}).focus();await page.keyboard.press('Enter');
  await expect.poll(async()=>(await read()).sensors.length).toBe(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Close inspector',exact:true}).click();
  await page.keyboard.press('s');
  await page.getByRole('button',{name:'Coordinates',exact:true}).click();
  await page.getByLabel('Latitude',{exact:true}).fill('53.025');
  await page.getByLabel('Longitude',{exact:true}).fill('-6.35');
  await page.getByRole('button',{name:'Place object',exact:true}).click();
  await expect(page.getByRole('button',{name:'Move',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Move',exact:true}).click();
  await page.getByRole('button',{name:'Coordinates',exact:true}).first().click();
  await page.getByLabel('Longitude',{exact:true}).fill('-6.349');
  await page.getByRole('button',{name:'Preview position',exact:true}).click();
  await page.getByRole('button',{name:'Save movement',exact:true}).click();
  await expect.poll(async()=>(await read()).sensors[0].location.longitude).toBe(-6.349);
  await page.reload();await expect(page.getByTitle(scenario.name,{exact:true})).toBeVisible();
  expect((await read()).sensors[0].location.longitude).toBe(-6.349);
});
