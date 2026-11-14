import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { ByteLRU } from '../server/cache.js';
import { lonLatToWorld, worldToLonLat, tilePoint, WORLD_VERSION } from '../server/terrain.js';
import { cogUrl, LANDCOVER_CLASSES, landcoverTileUrl } from '../server/providers.js';
import { createMapServer } from '../server/index.js';
import { TilePool } from '../server/worker-pool.js';

const png = PNG.sync.write(new PNG({ width: 256, height: 256 }));
const fakeAcquire = async (tile, { signal }) => { await delay(50, null, { signal }); return png; };
const fixtureProviders = {
  landcover: async () => ({ classValue: 30, className: 'Grassland', year: 2021, analytical: true }),
  weather: async () => ({ kind: 'forecast', temperatureC: 7.2, humidityPct: 64, windSpeedMs: 3.37, windDirectionDeg: 282 }),
};
async function until(condition, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!condition()) { if (Date.now() >= deadline) throw new Error('Condition timed out'); await delay(5); }
}
async function testServer(overrides = {}) {
  const app = await createMapServer({ workers: 1, databaseUrl: '', acquireTile: fakeAcquire, providers: fixtureProviders, lookupEcoregion: async () => ({ name: 'East European forest steppe', zone: 'forest-steppe' }), ...overrides });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  return { ...app, base: `http://127.0.0.1:${app.server.address().port}` };
}

test('Mercator round trip and adjacent tile boundary coordinates agree', () => {
  for (const [lng, lat] of [[32.05, 48.45], [-123.4, -45], [0, 0], [179.9, 80]]) {
    const output = worldToLonLat(...lonLatToWorld(lng, lat));
    assert.ok(Math.abs(output[0] - lng) < 1e-9); assert.ok(Math.abs(output[1] - lat) < 1e-9);
  }
  for (const z of [3, 8, 16]) assert.deepEqual(tilePoint(z, 3, 2, 256, 72), tilePoint(z, 4, 2, 0, 72));
});

test('real source selection uses correct COG hemisphere grid and WMTS identifiers', () => {
  assert.match(cogUrl(49.44, 32.06), /N48E030_Map.tif$/);
  assert.match(cogUrl(46.45, 33.87), /N45E033_Map.tif$/);
  assert.match(cogUrl(-1, -1), /S03W003_Map.tif$/);
  assert.equal(LANDCOVER_CLASSES[30], 'Grassland'); // Grass is not a steppe classification.
  const url = new URL(landcoverTileUrl({ z: 10, x: 603, y: 349 }));
  assert.equal(url.searchParams.get('TIME'), '2021-01-01');
  assert.equal(url.searchParams.get('LAYER'), 'esa-worldcover-map-10m-2021-v2_map');
  assert.match(WORLD_VERSION, /^real-/);
});

test('LRU evicts least-recently-used bytes and respects replacement budget', () => {
  const cache = new ByteLRU(10);
  cache.set('a', Buffer.alloc(4)); cache.set('b', Buffer.alloc(4)); cache.get('a'); cache.set('c', Buffer.alloc(4));
  assert.equal(cache.get('b'), undefined); assert.equal(cache.stats().bytes, 8);
  cache.set('a', Buffer.alloc(7)); assert.equal(cache.stats().bytes, 7);
  cache.set('huge', Buffer.alloc(20)); assert.equal(cache.stats().bytes, 7);
});

test('real HTTP contract validates ranges, preserves provenance and revalidates tile cache', async () => {
  const app = await testServer();
  try {
    const world = await (await fetch(app.base + '/api/world')).json();
    assert.equal(world.synthetic, false); assert.equal(world.id, WORLD_VERSION); assert.equal(world.layers[0].maxNativeZoom, 14);
    for (const path of ['/api/sample', '/api/sample?lat=NaN&lng=32', '/api/sample?lat=90&lng=0', '/api/tiles/terrain/8/0/0.png', '/api/tiles/landcover/5/0/0.png', '/api/tiles/landcover/15/0/0.png']) assert.equal((await fetch(app.base + path)).status, 400);
    const first = await fetch(app.base + '/api/tiles/landcover/10/603/349.png');
    assert.equal(first.status, 200); assert.equal(first.headers.get('x-map-synthetic'), 'false');
    assert.equal((await fetch(app.base + '/api/tiles/landcover/10/603/349.png', { headers: { 'If-None-Match': first.headers.get('etag') } })).status, 304);
    const sample = await (await fetch(app.base + '/api/sample?lat=49.44&lng=32.06')).json();
    assert.equal(sample.synthetic, false); assert.equal(sample.landCover.classValue, 30); assert.equal(sample.ecoregion.zone, 'forest-steppe'); assert.equal(sample.moisture, null);
  } finally { await app.close(); }
});

test('unavailable real providers remain null while ecoregion result survives', async () => {
  const app = await testServer({ providers: { landcover: async () => { throw new Error('No coverage'); }, weather: async () => { throw new Error('Provider unavailable'); } } });
  try {
    const sample = await (await fetch(app.base + '/api/sample?lat=49.44&lng=32.06')).json();
    assert.equal(sample.landCover, null); assert.equal(sample.weather, null); assert.equal(sample.temperatureC, null); assert.equal(sample.water, null);
    assert.equal(sample.ecoregion.zone, 'forest-steppe'); assert.equal(sample.errors.length, 2);
  } finally { await app.close(); }
});

test('cancelling queued acquisition frees capacity immediately', async () => {
  const pool = new TilePool(1, 3, fakeAcquire);
  try {
    const active = pool.run({});
    const controllers = Array.from({ length: 3 }, () => new AbortController());
    const outcomes = Promise.allSettled(controllers.map(controller => pool.run({}, { signal: controller.signal })));
    assert.equal(pool.stats().queued, 3); controllers.forEach(controller => controller.abort());
    assert.equal(pool.stats().queued, 0); assert.ok((await outcomes).every(result => result.status === 'rejected'));
    await Promise.all([active, pool.run({})]);
  } finally { await pool.close(); }
});

test('slow remote land-cover requests cannot block local ecological rendering', async () => {
  let unblock;const gate=new Promise(resolve=>{unblock=resolve;});
  const app=await testServer({workers:1,acquireTile:async tile=>{if(tile.layer==='landcover')await gate;return png;}});
  try{
    const remote=fetch(app.base+'/api/tiles/landcover/10/603/349.png');
    await until(()=>app.pool.stats().active===1);
    const local=await fetch(app.base+'/api/tiles/ecoregions/10/603/349.png',{signal:AbortSignal.timeout(2000)});
    assert.equal(local.status,200);await local.arrayBuffer();assert.equal(app.pool.stats().active,1);
    unblock();await(await remote).arrayBuffer();
  }finally{unblock();await app.close();}
});

test('one disconnected subscriber does not cancel another viewer of the same tile', async () => {
  const app = await testServer();
  const firstController = new AbortController();
  let calls = 0;
  const original = app.pool.acquire;
  app.pool.acquire = async (...args) => { calls++; await delay(100); return original(...args); };
  try {
    const first = fetch(app.base + '/api/tiles/landcover/10/603/349.png', { signal: firstController.signal }).catch(error => error);
    const second = fetch(app.base + '/api/tiles/landcover/10/603/349.png');
    await until(() => app.cache.stats().misses === 2);
    firstController.abort(); assert.equal((await first).name, 'AbortError');
    const response = await second; assert.equal(response.status, 200); await response.arrayBuffer();
    assert.equal(calls, 1); assert.equal(app.cache.stats().entries, 1);
  } finally { await app.close(); }
});

test('abandoned HTTP requests leave no queued acquisition or orphaned cache writes', async () => {
  const app = await testServer();
  const controllers = Array.from({ length: 20 }, () => new AbortController());
  try {
    const requests = controllers.map((controller, i) => fetch(`${app.base}/api/tiles/landcover/10/${603 + i}/349.png`, { signal: controller.signal }).then(response => response.arrayBuffer()).catch(error => error));
    await until(() => app.pool.stats().queued > 0); controllers.forEach(controller => controller.abort()); await Promise.all(requests);
    await until(() => app.pool.stats().queued === 0 && app.pool.stats().active === 0);
    const health = await (await fetch(app.base + '/api/health')).json();
    assert.equal(health.pending, 0); assert.equal(health.renderer.queued, 0);
    assert.equal((await fetch(app.base + '/api/tiles/landcover/10/603/349.png')).status, 200);
  } finally { controllers.forEach(controller => controller.abort()); await app.close(); }
});
