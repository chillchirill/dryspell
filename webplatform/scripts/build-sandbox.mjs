import {build} from 'esbuild';
await build({entryPoints:['apps/sandbox/server/index.ts'],outfile:'apps/sandbox/dist-server/index.js',bundle:true,platform:'node',format:'esm',packages:'external',sourcemap:true});
