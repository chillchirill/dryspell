import {describe,it,expect} from 'vitest';
import type {LandscapeCell} from '@dryspell/contracts';
import {terrainColor,terrainLabel,ecologicalLegend} from './palette';
describe('truthful natural map classes',()=>{const base={cover:'grass'} as LandscapeCell;it('distinguishes original crops from coarse grass without pink',()=>{expect(terrainColor({...base,sourceClassCode:40})).toBe('#c6aa66');expect(terrainLabel({...base,sourceClassCode:40})).toBe('Cropland');expect(terrainColor(base)).toBe('#bdd180');});it('keeps urban cover neutral',()=>expect(terrainColor({...base,sourceClassCode:50})).toBe('#8b949b'));it('does not invent ecological zones from grass cover',()=>{expect(terrainLabel(base)).toBe('grass');expect(ecologicalLegend.find(([,name])=>name==='Steppe')?.[0]).toBe('#d6b76e');});});
