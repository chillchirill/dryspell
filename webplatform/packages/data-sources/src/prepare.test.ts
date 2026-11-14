import {describe,it,expect,vi} from 'vitest';
vi.mock('./index.ts',async importOriginal=>({...await importOriginal<typeof import('./index.ts')>(),readRasterWindow:vi.fn(async(url:string,_bounds:unknown,width:number,height:number)=>Array.from({length:width*height},(_,i)=>url.includes('WorldCover')?(Math.floor(i/width)<height/2?10:80):100+Math.floor(i/width)*2))}));
import {prepareLandscape} from './prepare';
import {readRasterWindow} from './index';
describe('analytical area preparation',()=>{
 it('keeps original classes, flips northern raster rows, and blocks actual water',async()=>{
  const l=await prepareLandscape({center:{latitude:48.4,longitude:24.5},sizeM:1000,cellSizeM:25});
  expect(l.cells).toHaveLength(1600);expect(l.cells[0].sourceClassCode).toBe(80);expect(l.cells[0].burnable).toBe(false);expect(l.cells.at(-1)!.sourceClassCode).toBe(10);expect(l.cells.at(-1)!.burnable).toBe(true);expect(l.cells.at(-1)!.elevationM).toBe(100);expect(l.cells.every(c=>Number.isFinite(c.slopeDeg))).toBe(true);expect(l.provenance.map(p=>p.provider)).toEqual(['Copernicus DEM','ESA WorldCover']);
 });
 it('splits source tiles at the antimeridian without inventing a world-wide grid',async()=>{
  vi.mocked(readRasterWindow).mockClear();const l=await prepareLandscape({center:{latitude:-16.5,longitude:179.999},sizeM:1000,cellSizeM:25});
  expect(l.bounds.west).toBeGreaterThan(l.bounds.east);expect(l.cells).toHaveLength(1600);expect(l.cells.every(c=>Number.isFinite(c.elevationM))).toBe(true);
  const calls=vi.mocked(readRasterWindow).mock.calls;expect(calls.some(([url])=>url.includes('W180'))).toBe(true);expect(calls.every(([,b])=>b.west>=-180&&b.east<=180)).toBe(true);
 });
});
