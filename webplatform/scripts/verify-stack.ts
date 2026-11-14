import 'dotenv/config';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {checkRestarts} from './restart-check.ts';
const database=process.env.TEST_DATABASE_URL;
if(!database||!new URL(database).pathname.endsWith('_test'))throw new Error('TEST_DATABASE_URL must name a dedicated *_test database. Create it first.');
const env={...process.env,DATABASE_URL:database,PORT:'4000',HOST:'127.0.0.1',RUN_DB_TESTS:'1'};
async function command(args:string[]){const child=spawn(process.execPath,args,{env,stdio:'inherit'});await new Promise<void>((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(args.join(' ')+' failed: '+code)));});}
await mkdir('data/private',{recursive:true});
await mkdir('docs/evidence',{recursive:true});
await command(['--import','tsx','apps/server/src/migrate.ts']);
await command(['--import','tsx','apps/server/src/seed.ts']);
const services:ChildProcess[]=[];const logs:number[]=[];
try{
  for(const [name,file] of [['web','index'],['worker','worker']]){
    const fd=openSync(`data/private/${name}-verification.log`,'w');logs.push(fd);
    services.push(spawn(process.execPath,[`apps/server/dist/${file}.js`],{env,stdio:['ignore',fd,fd]}));
  }
  await writeFile('data/private/verification-processes.json',JSON.stringify(services.map(p=>p.pid)));
  let ready=false;
  for(let i=0;i<60;i++){if(services.some(p=>p.exitCode!==null))throw new Error('Service exited; inspect data/private/*-verification.log');try{const r=await fetch('http://127.0.0.1:4000/health/ready');const value=await r.json() as {worker:string};if(r.ok&&value.worker==='healthy'){ready=true;break;}}catch{}await delay(500);}
  if(!ready)throw new Error('Actual backend/database/worker readiness timed out');
  if(!process.argv.includes('--browser-only')){
  await command(['node_modules/vitest/vitest.mjs','run']);
  const restart=async(index:number,file:string)=>{services[index].kill('SIGKILL');await new Promise<void>(resolve=>{if(services[index].exitCode!==null)return resolve();services[index].once('exit',()=>resolve());});services[index]=spawn(process.execPath,[`apps/server/dist/${file}.js`],{env,stdio:['ignore',logs[index],logs[index]]});for(let i=0;i<40;i++){try{const r=await fetch('http://127.0.0.1:4000/health/ready');if(r.ok){await delay(1000);return;}}catch{}await delay(250);}throw new Error('Restart readiness timed out');};
  await checkRestarts(()=>restart(1,'worker'),()=>restart(0,'index'));
  await command(['--import','tsx','scripts/load-check.ts']);
  }
  await command(['node_modules/playwright/cli.js','test']);
  await command(['--import','tsx','scripts/smoke-test.ts']);
}finally{
  for(const child of services)child.kill();
  await Promise.all(services.map(child=>new Promise<void>(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',()=>resolve());setTimeout(()=>{child.kill('SIGKILL');resolve();},12000).unref();})));
  for(const fd of logs)closeSync(fd);
}
