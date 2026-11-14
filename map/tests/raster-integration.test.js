import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {createRasterTiles} from '../server/raster-tiles.js';
import {openStorage} from '../server/storage.js';
test('concurrent real COG tile reads share blocks and retain independently verified water pixels',{skip:!process.env.MAP_DATABASE_URL},async()=>{
  const storage=await openStorage(process.env.MAP_DATABASE_URL),renderer=createRasterTiles(storage);
  // These ranges were acquired by verify-cog-render. A regression must not need the network.
  const network=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Regression must use durable real source blocks');};
  try{
    const results=await Promise.all([9650,9651,9652,9653].map(x=>renderer.render({z:14,x,y:5594},{signal:AbortSignal.timeout(10000)})));
    for(const bytes of results){const png=PNG.sync.read(bytes);assert.equal(png.width,256);assert.equal(png.height,256);}
    const water=PNG.sync.read(results[3]);assert.deepEqual([...water.data.subarray(0,4)],[0,100,200,255]);
    assert.equal(renderer.stats().downloadedBytes,0);assert.equal(renderer.stats().pendingRanges,0);
    assert.ok(renderer.stats().ranges.bytes<=24*1024*1024);
  }finally{globalThis.fetch=network;await storage.close();}
});
