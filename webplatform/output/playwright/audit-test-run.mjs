import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config({path:'.env.test',quiet:true}); dotenv.config({quiet:true});
const db=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
try {
 for(const table of ['sensors','scenarios']) {
  const rows=await db.query(`SELECT id,document->>'name' AS name,document->>'deviceId' AS device,document->>'createdAt' AS created FROM ${table} WHERE (document->>'createdAt')::timestamptz BETWEEN $1 AND $2`,['2026-11-14T15:15:13Z','2026-11-14T15:16:10Z']);
  console.log(table,JSON.stringify(rows.rows));
 }
 console.log('jobs',JSON.stringify((await db.query("SELECT kind,status,scenario_id FROM analysis_jobs WHERE created_at BETWEEN $1 AND $2",['2026-11-14T15:15:13Z','2026-11-14T15:16:10Z'])).rows));
} finally {await db.end();}
