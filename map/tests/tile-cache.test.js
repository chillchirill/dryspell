import test from 'node:test';
import assert from 'node:assert/strict';
import {TileImageCache} from '../public/tile-cache.js';
const bitmap=()=>({width:256,height:256,closed:false,close(){this.closed=true;}});
test('decoded image LRU evicts and closes GPU resources within its byte budget',()=>{
  const cache=new TileImageCache(2*256*256*4),a=bitmap(),b=bitmap(),c=bitmap();
  cache.put('landcover',{z:10,x:1,y:1},a);cache.put('landcover',{z:10,x:2,y:1},b);
  cache.get('landcover',{z:10,x:1,y:1});cache.put('landcover',{z:10,x:3,y:1},c);
  assert.equal(b.closed,true);assert.equal(a.closed,false);assert.equal(cache.stats().bytes,cache.maxBytes);
  cache.clear();assert.equal(a.closed,true);assert.equal(c.closed,true);assert.equal(cache.stats().bytes,0);
});
test('zoom preview crops the correct parent quadrant and never mixes source layers',()=>{
  const cache=new TileImageCache(),image=bitmap(),draws=[],ctx={drawImage:(...args)=>draws.push(args)};
  cache.put('landcover',{z:10,x:603,y:349},image);
  assert.equal(cache.draw(ctx,'landcover',{z:11,x:1207,y:698}),'overview');
  assert.deepEqual(draws[0].slice(1),[128,0,128,128,0,0,256,256]);
  assert.equal(cache.draw(ctx,'ecoregions',{z:11,x:1207,y:698}),null);
  assert.equal(cache.draw(ctx,'landcover',{z:10,x:603,y:349}),'exact');cache.clear();
});
test('zooming out composes cached children without requesting new source pixels',()=>{
  const cache=new TileImageCache(),draws=[],ctx={drawImage:(...args)=>draws.push(args)};
  for(let x=0;x<2;x++)for(let y=0;y<2;y++)cache.put('landcover',{z:11,x:1206+x,y:698+y},bitmap());
  assert.equal(cache.draw(ctx,'landcover',{z:10,x:603,y:349}),'overview');assert.equal(draws.length,4);
  assert.deepEqual(draws.map(d=>d.slice(1)),[[0,0,128,128],[0,128,128,128],[128,0,128,128],[128,128,128,128]]);cache.clear();
});
