import {describe,it,expect} from 'vitest';
import {cellAt,span} from './geography';
import type {LandscapeSnapshot} from '@dryspell/contracts';
describe('sandbox coordinates',()=>{const landscape={bounds:{west:179,east:-179,south:0,north:2},width:2,height:2} as LandscapeSnapshot;it('keeps crossing terrain continuous',()=>{expect(span(landscape.bounds)).toBe(2);expect(cellAt(landscape,{longitude:179.5,latitude:.5})).toBe(0);expect(cellAt(landscape,{longitude:-179.5,latitude:1.5})).toBe(3);});it('rejects points beyond bounds',()=>{expect(cellAt(landscape,{longitude:178,latitude:.5})).toBe(-1);expect(cellAt(landscape,{longitude:179.5,latitude:3})).toBe(-1);});});
