import {describe,it,expect,vi} from 'vitest';
vi.mock('../../../packages/data-sources/src/prepare',()=>({prepareLandscape:vi.fn(async(r:any)=>({id:'analytical-'+r.center.longitude,cells:[{burnable:true,cover:'grass',elevationM:5,sourceClassCode:30}],provenance:[],checksum:'fixture'}))}));
vi.mock('./weather',()=>({weather:vi.fn(async(_a:number,_b:number,startTime:string,durationSec:number)=>({id:'weather-'+durationSec,validAt:startTime,samples:[],provenance:[],stale:false}))}));
import {prepareArea} from './area';
import {prepareLandscape} from '../../../packages/data-sources/src/prepare';
describe('anonymous area adapter',()=>{
 it('adapts grid resolution, caches terrain independently and uses requested weather duration',async()=>{const request={center:{latitude:48,longitude:24},sizeM:20000,startTime:new Date().toISOString(),durationSec:45000};const a=await prepareArea(request);const b=await prepareArea({...request,durationSec:172800});expect(a.landscape.id).toBe(b.landscape.id);expect(a.id).not.toBe(b.id);expect(prepareLandscape).toHaveBeenCalledTimes(1);expect(prepareLandscape).toHaveBeenCalledWith(expect.objectContaining({cellSizeM:100}));expect(b.weather.id).toBe('weather-172800');});
 it('rejects unsupported latitude, huge areas and unsafe durations before provider acquisition',async()=>{const r={center:{latitude:86,longitude:24},startTime:new Date().toISOString(),durationSec:45000};await expect(prepareArea(r)).rejects.toThrow();await expect(prepareArea({...r,center:{latitude:48,longitude:24},sizeM:999999})).rejects.toThrow();await expect(prepareArea({...r,center:{latitude:48,longitude:24},durationSec:Number.MAX_SAFE_INTEGER})).rejects.toThrow();});
 it('prepares a historical area without forcing its weather origin to now',async()=>{const result=await prepareArea({center:{latitude:53,longitude:-8},sizeM:1000,startTime:'2026-02-01T00:00:00Z',durationSec:21600});expect(result.weather.validAt).toBe('2026-02-01T00:00:00Z');});
});
