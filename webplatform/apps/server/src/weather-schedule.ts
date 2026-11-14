import type {Bounds,Coordinate,WeatherSnapshot} from '@dryspell/contracts';
import {pool,transaction} from './db.ts';
export interface WeatherRefreshCandidate {id:string;createdAt:string;sample:boolean;bounds:Bounds;weather:WeatherSnapshot;}
export const boundsKey=(b:Bounds)=>[b.west,b.south,b.east,b.north].map(v=>v.toFixed(6)).join(',');
export function dueWeatherRefresh(candidates:WeatherRefreshCandidate[],nowMs=Date.now()):{environmentId:string;boundsKey:string;location:Coordinate;jobId:string}[]{
  const newest=new Map<string,WeatherRefreshCandidate>();
  for(const candidate of candidates){
    if(candidate.sample)continue;
    const source=candidate.weather.provenance.find(p=>{try{return !p.sample&&new URL(p.sourceUrl).hostname==='api.open-meteo.com'&&new URL(p.sourceUrl).pathname==='/v1/forecast';}catch{return false;}});
    if(!source||candidate.weather.provenance.some(p=>p.sample)||nowMs-Date.parse(candidate.weather.validAt)<0||nowMs-Date.parse(candidate.weather.validAt)>48*3600000)continue;
    const key=boundsKey(candidate.bounds),previous=newest.get(key);
    if(!previous||Date.parse(candidate.createdAt)>Date.parse(previous.createdAt))newest.set(key,candidate);
  }
  return [...newest.entries()].filter(([,c])=>{
    const lastRetrieval=Math.max(Date.parse(c.createdAt),...c.weather.provenance.map(p=>Date.parse(p.retrievedAt)).filter(Number.isFinite));
    return nowMs-lastRetrieval>=3600000;
  }).sort(([,a],[,b])=>Date.parse(a.createdAt)-Date.parse(b.createdAt)).map(([key,c])=>{
    const span=(c.bounds.east-c.bounds.west+360)%360||360;
    const longitude=((c.bounds.west+span/2+180)%360+360)%360-180;
    return{environmentId:c.id,boundsKey:key,location:{longitude,latitude:(c.bounds.south+c.bounds.north)/2},jobId:`weather-refresh:${c.id}:${new Date(nowMs).toISOString().slice(0,13)}`};
  });
}
export async function scheduleWeatherRefresh(nowMs=Date.now()){
  const rows=await pool.query("SELECT id,created_at,document->'sample' AS sample,document->'landscape'->'bounds' AS bounds,document->'weather' AS weather FROM environment_snapshots WHERE document->>'sample'='false' ORDER BY created_at DESC LIMIT 200");
  const due=dueWeatherRefresh(rows.rows.map(r=>({id:r.id,createdAt:r.created_at.toISOString(),sample:r.sample,bounds:r.bounds,weather:r.weather})),nowMs);
  return transaction(async db=>{
    const pending=Number((await db.query("SELECT count(*) FROM analysis_jobs WHERE kind='import' AND payload->>'scheduled'='true' AND status IN ('queued','running')")).rows[0].count);
    let inserted=0;
    for(const item of due){if(inserted>=Math.max(0,4-pending))break;
      const result=await db.query("INSERT INTO analysis_jobs(id,kind,payload) VALUES($1,'import',$2) ON CONFLICT(id) DO NOTHING",[item.jobId,JSON.stringify({provider:'weather',environmentId:item.environmentId,location:item.location,scheduled:true,cacheKey:'weather:'+item.boundsKey})]);
      inserted+=result.rowCount||0;
    }return inserted;
  });
}
