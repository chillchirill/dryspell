import { readFile } from 'node:fs/promises';
import { convertRegionalJsonl } from './regional';
const [input,output,optionsPath]=process.argv.slice(2);
if(!input||!output){console.error('Usage: npx tsx packages/inference/src/regional-cli.ts normalized-source.jsonl rows.jsonl [options.json]');process.exitCode=2;}
else{const options=optionsPath?JSON.parse(await readFile(optionsPath,'utf8')):{};const result=await convertRegionalJsonl(input,output,options);console.log(JSON.stringify({rows:result.rowCount,records:result.recordCount,splits:result.splits,excluded:result.excluded,manifest:output+'.manifest.json'},null,2));}
