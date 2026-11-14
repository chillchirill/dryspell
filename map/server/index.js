import http from 'node:http';
import { readFile, stat, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { ByteLRU } from './cache.js';
import { TilePool } from './worker-pool.js';
import { openStorage } from './storage.js';
import { WORLD_VERSION, MAX_LAT, TILE_SIZE, LAYERS } from './terrain.js';
import { createProviders, LANDCOVER_SOURCE, LANDCOVER_CLASSES } from './providers.js';
import {ECOREGION_LODS,tileLod} from './lod.js';
import {createRasterTiles} from './raster-tiles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const tileVersion = tile => tile.layer === 'landcover' ? 'worldcover-2021-v200' : WORLD_VERSION;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };
const numericSetting = (value, fallback, min, max) => Number.isFinite(Number(value)) && value !== undefined ? Math.max(min, Math.min(max, Math.floor(Number(value)))) : fallback;
function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
export async function createMapServer(options = {}) {
  const cache = new ByteLRU(options.cacheBytes ?? numericSetting(process.env.MAP_CACHE_MB, 32, 1, 256) * 1024 * 1024);
  const pool = new TilePool(options.workers ?? numericSetting(process.env.MAP_REMOTE_WORKERS, 4, 1, 4), options.maxQueue ?? 32, options.acquireTile);
  const localPool = new TilePool(2,32,options.acquireTile);
  let storage;
  try { storage = await openStorage(options.databaseUrl ?? process.env.MAP_DATABASE_URL); }
  catch (error) { await pool.close(); await localPool.close(); throw error; }
  const rasterTiles=createRasterTiles(storage);
  if(!options.acquireTile)pool.acquire=(tile,options)=>rasterTiles.render(tile,options);
  const providers = options.providers || createProviders(storage);
  const regionLookup = options.lookupEcoregion || (async (lat, lng) => (await import('./ecoregions.js')).lookupEcoregion(lat, lng));
  const samples = new TilePool(2, 24, async ({ lat, lng }, { signal }) => {
    const results = await Promise.allSettled([providers.landcover(lat, lng, signal), providers.weather(lat, lng, signal), regionLookup(lat, lng)]);
    signal.throwIfAborted();
    const [landCover, weather, ecoregion] = results.map(result => result.status === 'fulfilled' ? result.value : null);
    return { lat, lng, synthetic: false, landCover, weather, ecoregion,
      biome: ecoregion?.zone || null, water: landCover && landCover.classValue ? landCover.classValue === 80 : null,
      moisture: null, soilMoisturePct: null, waterDepthM: null, elevation: null,
      temperatureC: weather?.temperatureC ?? null, humidityPct: weather?.humidityPct ?? null,
      windSpeedMs: weather?.windSpeedMs ?? null, windDirectionDeg: weather?.windDirectionDeg ?? null,
      errors: results.flatMap((result, i) => result.status === 'rejected' ? [{ source: ['landCover', 'weather', 'ecoregion'][i], message: result.reason.message }] : []),
    };
  });
  const pending = new Map();
  const world = {
    id: WORLD_VERSION, name: 'Dryspell · Real environmental map', synthetic: false,
    description: 'Real geographic data: OpenStreetMap basemap, ESA WorldCover 2021 land cover, RESOLVE ecoregions and Open-Meteo model forecasts. Missing values remain unavailable.',
    center: [49.44, 32.06], zoom: 11, minZoom: 3, maxZoom: 19, tileSize: TILE_SIZE,
    bounds: [[-MAX_LAT, -180], [MAX_LAT, 180]], storage: storage.kind,
    basemapUrl: process.env.MAP_BASEMAP_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    basemapAttribution: '© OpenStreetMap contributors',
    layers: [{ id: 'landcover', cacheVersion:tileVersion({layer:'landcover'}), name: 'Land cover · ESA 2021', minZoom: 6, maxNativeZoom: 14, maxZoom: 19, bounds: [[-60, -180], [83, 180]], source: LANDCOVER_SOURCE },
      { id: 'ecoregions', name: 'Steppe & forest-steppe · RESOLVE', minZoom: 3, maxNativeZoom: 14, maxZoom: 19, levels:ECOREGION_LODS, source: { provider: 'RESOLVE Ecoregions 2017', license: 'CC BY 4.0' } }],
    landCoverClasses: LANDCOVER_CLASSES,
  };
  async function tileBuffer(tile, { signal } = {}) {
    signal?.throwIfAborted();
    const version=tileVersion(tile),acquisition=tile.layer==='ecoregions'?localPool:pool;
    const key = `${version}/${tile.layer}/${tile.z}/${tile.x}/${tile.y}`;
    const existing = cache.get(key);
    if (existing) return {png:existing,cache:'memory'};
    let entry = pending.get(key);
    if (!entry) {
      if (pending.size >= pool.maxQueue + pool.size + localPool.maxQueue + localPool.size) throw Object.assign(new Error('Tile queue full; retry shortly'), { statusCode: 503 });
      entry = { controller: new AbortController(), subscribers: 0, settled: false, promise: null };
      pending.set(key, entry);
      entry.promise = (async () => {
        const sharedSignal = entry.controller.signal;
        try {
          let png = await storage.get(version, tile);
          const cacheSource=png?'database':'generated';
          sharedSignal.throwIfAborted();
          if (!png) {
            png = await acquisition.run(tile, { signal: sharedSignal });
            sharedSignal.throwIfAborted();
            const provenance = tile.layer === 'landcover' ? { ...LANDCOVER_SOURCE, delivery:'Local rendering from bounded ESA COG overview blocks', sourceUrl:'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/' } : { provider: 'RESOLVE Ecoregions 2017', license: 'CC BY 4.0' };
            await storage.put(version, tile, png, { ...provenance, retrievedAt: new Date().toISOString(), checksum: createHash('sha256').update(png).digest('hex'), request: tile });
          }
          sharedSignal.throwIfAborted();
          cache.set(key, png); return {png,cache:cacheSource};
        } finally {
          entry.settled = true;
          // A cancelled key may already have been requested again.
          if (pending.get(key) === entry) pending.delete(key);
        }
      })();
    }
    entry.subscribers++;
    return new Promise((resolve, reject) => {
      let released = false;
      const release = () => {
        if (released) return false;
        released = true;
        signal?.removeEventListener('abort', onAbort);
        entry.subscribers--;
        if (!entry.subscribers && !entry.settled) {
          if (pending.get(key) === entry) pending.delete(key);
          entry.controller.abort(new DOMException('Tile has no remaining viewers', 'AbortError'));
        }
        return true;
      };
      const onAbort = () => { if (release()) reject(signal.reason || new DOMException('Tile request abandoned', 'AbortError')); };
      signal?.addEventListener('abort', onAbort, { once: true });
      entry.promise.then(value => { if (release()) resolve(value); }, error => { if (release()) reject(error); });
      if (signal?.aborted) onAbort();
    });
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Existing local UI processes can use the newer API without losing their browser origin/scenes.
    if(['http://127.0.0.1:4176','http://localhost:4176','http://127.0.0.1:4175','http://localhost:4175'].includes(request.headers.origin)){
      response.setHeader('Access-Control-Allow-Origin',request.headers.origin);
      response.setHeader('Access-Control-Expose-Headers','X-Map-LOD,X-Map-Cache,X-Map-Source');
      response.setHeader('Vary','Origin');
    }
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.setHeader('Allow', 'GET, HEAD'); return json(response, 405, { error: 'Read-only map API' }); }
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/api/health') return json(response, 200, { ok: true, service: 'dryspell-map', version: WORLD_VERSION, delivery:'progressive-cog-v3', synthetic: false, storage: storage.kind, cache: cache.stats(), raster:rasterTiles.stats(), renderer: pool.stats(), localRenderer:localPool.stats(), samples: samples.stats(), providers: providers.stats?.(), pending: pending.size });
      if (url.pathname === '/api/world') return json(response, 200, world);
      if (url.pathname === '/api/lod') {const lod=await import('./ecoregions.js');return json(response,200,{version:WORLD_VERSION,levels:await lod.lodCatalog(),pyramid:await lod.pyramidCatalog(WORLD_VERSION)});}
      if (url.pathname === '/api/sources') return json(response, 200, {
        synthetic: false,
        basemap: { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL', delivery: 'Browser tiles; independent from analytical classes' },
        landCover: {...LANDCOVER_SOURCE,delivery:'Local COG overview rendering with durable block/PNG caches; existing Terrascope PNGs reused'},
        ecoregions: { name: 'RESOLVE Ecoregions 2017', url: 'https://developers.google.com/earth-engine/datasets/catalog/RESOLVE_ECOREGIONS_2017', license: 'CC BY 4.0', storage: 'Imported PostGIS geometries', levels:ECOREGION_LODS, interpretation: 'Regional ecosystems, not current field land cover' },
        weather: { name: 'Open-Meteo', url: 'https://open-meteo.com/', kind: 'forecast', cacheMinutes: 15, interpretation: 'Forecast baseline, not sensor telemetry' }
      });
      if (url.pathname === '/api/sample') {
        const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'));
        if (!url.searchParams.get('lat')?.trim() || !url.searchParams.get('lng')?.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > MAX_LAT || Math.abs(lng) > 180) return json(response, 400, { error: 'Valid lat and lng required' });
        const controller = new AbortController();
        const onClose = () => { if (!response.writableEnded) controller.abort(); };
        response.once('close', onClose);
        try { const result = await samples.run({ lat, lng }, { signal: controller.signal }); if (!response.destroyed) return json(response, 200, result); }
        finally { response.removeListener('close', onClose); }
        return;
      }
      if (url.pathname.startsWith('/api/tiles/')) {
        const match = /^\/api\/tiles\/([a-z]+)\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url.pathname);
        if (!match) return json(response, 400, { error: 'Invalid tile address' });
        const [, layer, zs, xs, ys] = match;
        const z = Number(zs), x = Number(xs), y = Number(ys);
        if (!LAYERS.includes(layer) || z < (layer === 'landcover' ? 6 : 3) || z > 14 || x >= 2 ** z || y >= 2 ** z) return json(response, 400, { error: 'Tile outside supported layer or zoom range' });
        const etag = `"${tileVersion({layer})}-${layer}-${z}-${x}-${y}"`;
        const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600', ETag: etag, 'X-Map-Synthetic': 'false', 'X-Map-LOD':tileLod(layer,z),'X-Map-Source': layer === 'landcover' ? 'ESA WorldCover 2021 v200' : 'RESOLVE Ecoregions 2017' };
        if (request.headers['if-none-match'] === etag) { response.writeHead(304, headers); return response.end(); }
        const controller = new AbortController();
        const onClose = () => { if (!response.writableEnded) controller.abort(new DOMException('Viewer disconnected', 'AbortError')); };
        response.once('close', onClose);
        let result;
        try { result = await tileBuffer({ layer, z, x, y }, { signal: controller.signal }); }
        finally { response.removeListener('close', onClose); }
        if (response.destroyed) return;
        response.writeHead(200, { ...headers, 'Content-Length': result.png.length,'X-Map-Cache':result.cache });
        return response.end(request.method === 'HEAD' ? undefined : result.png);
      }
      if (url.pathname.startsWith('/api/')) return json(response, 404, { error: 'Unknown endpoint' });
      const vendor = url.pathname.startsWith('/vendor/leaflet/');
      const root = vendor ? path.join(ROOT, 'node_modules', 'leaflet', 'dist') : path.join(ROOT, 'public');
      const relative = decodeURIComponent(vendor ? url.pathname.slice('/vendor/leaflet/'.length) : url.pathname.slice(1)) || 'index.html';
      const filename = path.resolve(root, relative);
      if (!filename.startsWith(root + path.sep) || !MIME[path.extname(filename)]) return json(response, 404, { error: 'Not found' });
      const info = await stat(filename);
      if (!info.isFile()) return json(response, 404, { error: 'Not found' });
      const content = request.method === 'HEAD' ? undefined : await readFile(filename);
      response.writeHead(200, { 'Content-Type': MIME[path.extname(filename)], 'Content-Length': info.size, 'Cache-Control': vendor ? 'public, max-age=86400' : 'no-cache' });
      response.end(content);
    } catch (error) {
      if (response.destroyed) return;
      if (error.statusCode === 503) response.setHeader('Retry-After', '1');
      const status = error.statusCode || (error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : error instanceof URIError ? 400 : 500);
      if (status === 500) console.error('Map request failed:', error.message);
      json(response, status, { error: status === 500 ? 'Map request failed' : status === 404 ? 'Not found' : error.message });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return {
    server, cache, pool, localPool, world,
    async close() {
      const shutdown = new Promise(resolve => server.listening ? server.close(resolve) : resolve());
      server.closeIdleConnections();
      await pool.close(); await localPool.close(); await samples.close(); await shutdown; await storage.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const app = await createMapServer();
  const port = numericSetting(process.env.MAP_PORT, 4175, 1, 65535);
  const host = process.env.MAP_HOST || '127.0.0.1';
  app.server.on('error', async error => { console.error(`Map server could not start: ${error.message}`); await app.close(); process.exitCode = 1; });
  app.server.listen(port, host, async () => {
    const origin=`http://${host}:${port}`;
    const config=path.join(ROOT,'public','api-config.json'),temporary=config+`.${process.pid}.tmp`;
    await writeFile(temporary,JSON.stringify({apiOrigin:origin,version:WORLD_VERSION}));await rename(temporary,config);
    console.log(`Dryspell map: ${origin} (real geographic sources, ${app.world.storage})`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
