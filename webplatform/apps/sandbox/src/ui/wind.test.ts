import {describe,it,expect} from 'vitest';
import {windDirection} from './wind';
describe('north-up meteorological wind',()=>{it.each([[0,'N','S',180],[90,'E','W',270],[180,'S','N',0],[270,'W','E',90]] as const)('wind from %s points downwind',(from,origin,to,arrowDeg)=>expect(windDirection(from)).toEqual({from:origin,to,arrowDeg}));it('wraps negative and full-turn bearings',()=>{expect(windDirection(-90)).toEqual(windDirection(270));expect(windDirection(360)).toEqual(windDirection(0));});});
