import 'dotenv/config';
import pg from 'pg';
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
const client=await pool.connect();
const rawDays=Number(process.env.RAW_RETENTION_DAYS??90), aggregateDays=Number(process.env.AGGREGATE_RETENTION_DAYS??365);
if(!Number.isInteger(rawDays)||rawDays<1||!Number.isInteger(aggregateDays)||aggregateDays<rawDays)throw new Error('Invalid retention configuration');
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('dryspell-maintenance'))");
  await client.query(`INSERT INTO telemetry_hourly(sensor_id,hour,channel,count,min,max,mean)
    SELECT sensor_id,date_trunc('hour',recorded_at),v.key,count(*),min(v.value::double precision),max(v.value::double precision),avg(v.value::double precision)
    FROM telemetry CROSS JOIN LATERAL jsonb_each_text(document->'values') v
    WHERE recorded_at<date_trunc('hour',now())
    GROUP BY sensor_id,date_trunc('hour',recorded_at),v.key
    ON CONFLICT(sensor_id,hour,channel) DO UPDATE SET count=EXCLUDED.count,min=EXCLUDED.min,max=EXCLUDED.max,mean=EXCLUDED.mean`);
  const raw=await client.query("DELETE FROM telemetry WHERE recorded_at < date_trunc('hour',now()-($1::int*interval '1 day'))",[rawDays]);
  const aggregate=await client.query("DELETE FROM telemetry_hourly WHERE hour < now()-($1::int*interval '1 day')",[aggregateDays]);
  await client.query('DELETE FROM sessions WHERE expires_at<now()');
  const outbox=await client.query("DELETE FROM event_outbox WHERE event_time<now()-interval '7 days'");
  await client.query('COMMIT');
  console.log(JSON.stringify({rawDeleted:raw.rowCount,aggregatesDeleted:aggregate.rowCount,outboxDeleted:outbox.rowCount,rawDays,aggregateDays}));
} catch(error){await client.query('ROLLBACK');throw error;} finally{client.release();await pool.end();}
