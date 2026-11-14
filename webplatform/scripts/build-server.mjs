import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
await build({entryPoints:['apps/server/src/index.ts','apps/server/src/worker.ts','apps/server/src/migrate.ts','apps/server/src/seed.ts'],bundle:true,platform:'node',format:'esm',target:'node24',outdir:'apps/server/dist',sourcemap:true,external:Object.keys(manifest.dependencies).flatMap(name=>[name,`${name}/*`]),logLevel:'info'});
