import {describe,it,expect} from 'vitest';
import type {LandscapeSnapshot} from '@dryspell/contracts';
import {indexAt,cellPolygon,displayBounds} from './geography';
describe('map grid geometry across the antimeridian',()=>{
 const landscape={bounds:{west:179,south:10,east:-179,north:12},width:4,height:4} as LandscapeSnapshot;
 it('selects the same cell for equivalent wrapped coordinates',()=>{expect(indexAt(landscape,{longitude:-179.75,latitude:10.25})).toBe(2);expect(indexAt(landscape,{longitude:180.25,latitude:10.25})).toBe(2);expect(indexAt(landscape,{longitude:175,latitude:10.25})).toBe(-1);});
 it('renders a continuous local extent instead of a 358 degree rectangle',()=>{expect(displayBounds(landscape.bounds)).toEqual([[179,10],[181,12]]);const ring=cellPolygon(landscape,2);expect(ring[1][0]-ring[0][0]).toBe(.5);expect(ring[0]).toEqual([180,10]);});
});
