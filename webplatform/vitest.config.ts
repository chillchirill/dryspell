import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['packages/**/*.test.ts','apps/server/**/*.test.ts','apps/web/**/*.test.ts','apps/sandbox/**/*.test.ts','tests/integration/**/*.test.ts'],exclude:['node_modules/**'],testTimeout:60000,hookTimeout:60000,fileParallelism:false}});

