import {describe,it,expect} from 'vitest';
import {windMultiplier} from './index';
describe('linear wind response',()=>{for(const canopy of [.25,.4])it(`equal wind increments add equal forward response canopy ${canopy}`,()=>{const factors=[0,5,10,15,20].map(s=>windMultiplier(s,canopy));expect(factors[0]).toBe(1);for(let i=2;i<factors.length;i++)expect(factors[i]-factors[i-1]).toBeCloseTo(factors[1]-1,12);expect(windMultiplier(-20,canopy)).toBeGreaterThan(0);expect(windMultiplier(-20,canopy)).toBeLessThan(1);});});
