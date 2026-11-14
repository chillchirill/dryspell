import {expect,it} from 'vitest';
import {demoWeather} from './demo-weather';
it('labels reference conditions explicitly and covers custom horizons without pretending to be live',async()=>{const start='2026-11-15T10:00:00.000Z',w=await demoWeather(start,45000);expect(w.validAt).toBe(start);expect(w.samples.at(-1)!.timeSec).toBe(45000);expect(w.provenance[0].sample).toBe(true);expect(w.provenance[0].parameters?.weatherMode).toBe('demo');expect(w.provenance[0].parameters?.referenceTime).toBe('2026-07-01T12:00:00Z');expect(w.provenance[0].attribution).toContain('not current');});
it('rejects unsafe reference-weather time',async()=>{await expect(demoWeather('bad',45000)).rejects.toThrow();await expect(demoWeather(new Date().toISOString(),Number.MAX_SAFE_INTEGER)).rejects.toThrow();});
