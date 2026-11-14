import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readRasterWindow} from '../packages/data-sources/src/index';
import type {EnvironmentSnapshot} from '@dryspell/contracts';
if(process.platform==='win32')process.env.DRYSPELL_WINDOWS_HTTP='1';
const env:EnvironmentSnapshot=JSON.parse(await readFile('data/sample/environment.json','utf8'));
const l=env.landscape,source=l.provenance.find(p=>p.provider==='ESA WorldCover')!;
const classes=await readRasterWindow(source.sourceUrl,l.bounds,l.width,l.height);
if(classes.length!==l.cells.length||classes.some(c=>!Number.isInteger(c)))throw new Error('Invalid analytical class window');
for(let y=0;y<l.height;y++)for(let x=0;x<l.width;x++){const cell=l.cells[y*l.width+x];cell.sourceClassCode=classes[(l.height-1-y)*l.width+x];if(cell.sourceClassCode===40)cell.fuelModel='cropland-herbaceous-assumption';}
const hash=createHash('sha256').update(JSON.stringify(l.cells)).digest('hex');l.checksum=hash;l.id+='-classes-'+hash.slice(0,12);env.id+='-classes-'+hash.slice(0,12);
source.parameters={...source.parameters,originalClassCodesPreserved:true,resampling:'nearest',rowOrder:'south-to-north'};source.retrievedAt=new Date().toISOString();
env.warnings.push('Cropland fuel is an explicit herbaceous assumption; crop stage and management are unavailable. Regional ecological zones do not replace local fuel classes.');
await mkdir('data/sandbox',{recursive:true});await writeFile('data/sandbox/environment.json',JSON.stringify(env));
console.log(JSON.stringify({id:env.id,cells:l.cells.length,classes:[...new Set(classes)],checksum:hash}));
