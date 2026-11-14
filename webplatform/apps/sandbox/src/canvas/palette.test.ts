import {describe,it,expect} from 'vitest';
import type {LandscapeCell} from '@dryspell/contracts';
import {terrainColor,terrainLabel,ecologicalLegend} from './palette';
describe('truthful natural map classes',()=>{const base={cover:'grass'} as LandscapeCell;it('distinguishes original crops from coarse grass without pink',()=>{expect(terrainColor({...base,sourceClassCode:40})).toBe('#d8c59b');expect(terrainLabel({...base,sourceClassCode:40})).toBe('Cropland');expect(terrainColor(base)).toBe('#d9cd8a');});it('keeps urban cover neutral',()=>expect(terrainColor({...base,sourceClassCode:50})).toBe('#b6b8ba'));it('does not invent ecological zones from grass cover',()=>{expect(terrainLabel(base)).toBe('grass');expect(ecologicalLegend.find(([,name])=>name==='Steppe')?.[0]).toBe('#d9cd8a');});});
