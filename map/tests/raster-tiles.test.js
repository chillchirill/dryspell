import test from 'node:test';
import assert from 'node:assert/strict';
import {selectOverview} from '../server/raster-tiles.js';
test('raster display selects a source overview matched to ground-pixel size, retaining native pixels at close zoom',()=>{
  const images=[1,2,4,8,16,32,64].map(scale=>({scale,getResolution:()=>[scale/12000,-scale/12000]}));
  assert.equal(selectOverview(images,images[0],.00001).scale,1);
  assert.equal(selectOverview(images,images[0],.0004).scale,4);
  assert.equal(selectOverview(images,images[0],.001).scale,8);
  assert.equal(selectOverview(images,images[0],.05).scale,64);
});
