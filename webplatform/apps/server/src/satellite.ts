import {z} from 'zod';
import type {SatelliteObservation} from '@dryspell/contracts';
import {pool} from './db.ts';
import {assert} from './errors.ts';
export function satelliteQuery(query:Record<string,unknown>){
  const to=query.to?z.string().datetime().parse(query.to):new Date().toISOString();
  const from=query.from?z.string().datetime().parse(query.from):new Date(Date.parse(to)-86400000).toISOString();
  const availableAt=query.availableAt?z.string().datetime().parse(query.availableAt):to;
  assert(Date.parse(from)<=Date.parse(to),400,'INVALID_RANGE','Satellite from must not be after to.');
  let bounds:number[]|null=null;
  if(query.bounds){bounds=z.string().parse(query.bounds).split(',').map(Number);assert(bounds.length===4&&bounds.every(Number.isFinite)&&Math.abs(bounds[0])<=180&&Math.abs(bounds[2])<=180&&bounds[1]>=-90&&bounds[3]<=90&&bounds[1]<bounds[3],400,'INVALID_BOUNDS','Use west,south,east,north in geographic degrees.');}
  return{from,to,availableAt,bounds};
}
export async function getSatellite(query:Record<string,unknown>):Promise<SatelliteObservation[]>{
  const {from,to,availableAt,bounds}=satelliteQuery(query);
  const rows=await pool.query(`SELECT document FROM external_detections WHERE observed_at BETWEEN $1 AND $2 AND received_at<=$3
    AND ($4::float8 IS NULL OR ((document->'location'->>'latitude')::float8 BETWEEN $5 AND $7 AND
      CASE WHEN $4<=$6 THEN (document->'location'->>'longitude')::float8 BETWEEN $4 AND $6
      ELSE (document->'location'->>'longitude')::float8>=$4 OR (document->'location'->>'longitude')::float8<=$6 END))
    ORDER BY observed_at DESC,id LIMIT 5000`,[from,to,availableAt,bounds?.[0]??null,bounds?.[1]??null,bounds?.[2]??null,bounds?.[3]??null]);
  return rows.rows.map(r=>r.document);
}
