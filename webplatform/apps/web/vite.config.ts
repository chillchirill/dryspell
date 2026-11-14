import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root:fileURLToPath(new URL('.',import.meta.url)), plugins:[react()], build:{outDir:'dist',emptyOutDir:true}, server:{port:5173,proxy:{'/api':'http://localhost:4000','/health':'http://localhost:4000','/ws':{target:'ws://localhost:4000',ws:true}}} });
