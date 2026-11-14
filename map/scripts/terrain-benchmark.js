import { performance } from 'node:perf_hooks';
import { createMapServer } from '../server/index.js';
import { loadEnvFile } from 'node:process';
import { closeEcoregions } from '../server/ecoregions.js';
try { loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }

const app = await createMapServer();
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
try {
  // Local PostGIS only: never stress external WMTS or OpenStreetMap services.
  const urls = Array.from({ length: 24 }, (_, i) => `${base}/api/tiles/ecoregions/9/${296 + i % 6}/${174 + Math.floor(i / 6)}.png`);
  const start = performance.now();
  const pending = Promise.all(urls.map(async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Tile HTTP ${response.status}`);
    return (await response.arrayBuffer()).byteLength;
  }));
  const healthStart = performance.now();
  await fetch(base + '/api/health');
  const healthMs = performance.now() - healthStart;
  const sizes = await pending;
  const coldMs = performance.now() - start;
  const warmStart = performance.now();
  await Promise.all(urls.map(async url => (await fetch(url)).arrayBuffer()));
  const stats = await (await fetch(base + '/api/health')).json();
  console.log(JSON.stringify({ storage: stats.storage, tileCount: urls.length, firstBatchMs: Math.round(coldMs), cachedBatchMs: Math.round(performance.now() - warmStart), healthWhileRenderingMs: Math.round(healthMs), pngBytes: sizes.reduce((a, b) => a + b, 0), cache: stats.cache, renderer: stats.renderer }, null, 2));
} finally { await app.close(); await closeEcoregions(); }
