import {describe,it,expect,afterAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {pool,event} from './db.ts';
const enabled=process.env.RUN_DB_TESTS==='1';
describe.skipIf(!enabled)('outbox commit ordering on PostgreSQL',()=>{
  afterAll(async()=>pool.end());
  it('does not expose a newer cursor before an earlier transaction commits',async()=>{const first=await pool.connect(),second=await pool.connect(),tag=randomUUID();let secondDone=false;try{await first.query('BEGIN');await second.query('BEGIN');await event(first,'source.status','live',{tag,order:1});const pending=event(second,'source.status','live',{tag,order:2}).then(()=>{secondDone=true;});await new Promise(r=>setTimeout(r,100));expect(secondDone).toBe(false);expect((await pool.query("SELECT cursor FROM event_outbox WHERE payload->>'tag'=$1",[tag])).rows).toHaveLength(0);await first.query('COMMIT');await pending;await second.query('COMMIT');const rows=(await pool.query("SELECT cursor::text,payload FROM event_outbox WHERE payload->>'tag'=$1 ORDER BY cursor",[tag])).rows;expect(rows.map(r=>r.payload.order)).toEqual([1,2]);expect(BigInt(rows[1].cursor)>BigInt(rows[0].cursor)).toBe(true);}finally{await first.query('ROLLBACK');await second.query('ROLLBACK');first.release();second.release();await pool.query("DELETE FROM event_outbox WHERE payload->>'tag'=$1",[tag]);}},10000);
});
