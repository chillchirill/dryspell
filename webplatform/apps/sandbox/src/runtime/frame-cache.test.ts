import {describe,it,expect} from 'vitest';
import {FrameCache} from './frame-cache';
import {fixture} from '../../../../packages/simulation/src/test-fixture';
import {simulateFrame,checksum} from '@dryspell/simulation';
describe('bounded exact frame cache',()=>{
  it('round trips typed terrain/combustion columns and preserves the exact checksum/property order',()=>{
    const {s,e}=fixture(),frame=simulateFrame(s,e,300),cache=new FrameCache();cache.set(frame);const restored=cache.get(300)!;
    expect(restored).toEqual(frame);expect(checksum({...restored,checksum:''})).toBe(frame.checksum);
    restored.readings[0].values.temperatureC=-999;restored.burnedCells.push(999);expect(cache.get(300)).toEqual(frame);
  });
  it('evicts least recently used frames and declines entries larger than its memory budget',()=>{
    const {s,e}=fixture(),cache=new FrameCache(1024*1024,2);for(const t of [0,5])cache.set(simulateFrame(s,e,t));cache.get(0);cache.set(simulateFrame(s,e,10));
    expect(cache.get(5)).toBeUndefined();expect(cache.get(0)).toBeDefined();expect(cache.size).toBe(2);expect(cache.bytes).toBeLessThanOrEqual(cache.maxBytes);
    const tiny=new FrameCache(1);tiny.set(simulateFrame(s,e,0));expect(tiny.size).toBe(0);expect(tiny.bytes).toBe(0);
  });
});
