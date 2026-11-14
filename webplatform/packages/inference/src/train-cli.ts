import { readFile } from 'node:fs/promises';
import { loadRows,trainBaseline } from './ml';
const [rowsPath,manifestPath,outDir]=process.argv.slice(2);
if(!rowsPath||!manifestPath||!outDir){console.error('Usage: npx tsx packages/inference/src/train-cli.ts rows.jsonl manifest.json output-directory');process.exitCode=2;}else{const rows=await loadRows(rowsPath);const manifest=JSON.parse(await readFile(manifestPath,'utf8'));const result=await trainBaseline(rows,manifest,outDir);console.log(JSON.stringify({rows:result.rows,epochs:result.epochs,evaluation:result.evaluation,promoted:result.promoted},null,2));}
