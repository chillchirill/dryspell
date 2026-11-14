import {fileURLToPath} from 'node:url';
import {createSampleEnvironment} from '@dryspell/data-sources';
import {pool,transaction} from './db.ts';
import {newScenario,saveScenario} from './domain.ts';
export async function seed(){const environment=createSampleEnvironment();await transaction(async db=>{await db.query('INSERT INTO environment_snapshots(id,document) VALUES($1,$2) ON CONFLICT DO NOTHING',[environment.id,JSON.stringify(environment)]);if(!(await db.query('SELECT 1 FROM scenarios LIMIT 1')).rowCount){const s=newScenario(environment,{name:'Glendalough · prepared example'});s.id='prepared-sample';await saveScenario(db,s);}});console.log(JSON.stringify({seed:'prepared-sample',environmentId:environment.id}));}
if(process.argv[1]===fileURLToPath(import.meta.url))seed().then(()=>pool.end()).catch(e=>{console.error(e.message);process.exitCode=1;void pool.end();});
