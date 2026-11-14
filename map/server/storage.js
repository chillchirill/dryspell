// Optional durable cache. No connection is made unless MAP_DATABASE_URL is set.
export async function openStorage(connectionString) {
  if (!connectionString) return { kind: 'memory', get: async () => null, put: async () => {}, getRecord: async () => null, putRecord: async () => {}, getRange: async () => null, putRange: async () => {}, close: async () => {} };
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 5000 });
  pool.on('error', error => console.error('Map database idle connection error:', error.message));
  try {
    const ready=(await pool.query(`SELECT to_regclass('map.rendered_tiles') IS NOT NULL
      AND to_regclass('map.source_records') IS NOT NULL AND to_regclass('map.source_ranges') IS NOT NULL
      AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='map' AND table_name='rendered_tiles' AND column_name='provenance') AS ready`)).rows[0].ready;
    // Avoid taking an exclusive ALTER TABLE lock on every server/test startup.
    if(!ready)await pool.query(`CREATE SCHEMA IF NOT EXISTS map;
      CREATE TABLE IF NOT EXISTS map.rendered_tiles (
        version text NOT NULL, layer text NOT NULL, z smallint NOT NULL, x integer NOT NULL, y integer NOT NULL,
        png bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (version, layer, z, x, y), CHECK (octet_length(png) < 1048576));
      ALTER TABLE map.rendered_tiles ADD COLUMN IF NOT EXISTS provenance jsonb;
      CREATE TABLE IF NOT EXISTS map.source_records(key text PRIMARY KEY, value jsonb NOT NULL, expires_at timestamptz, retrieved_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS map.source_ranges(key text PRIMARY KEY, bytes bytea NOT NULL, provenance jsonb NOT NULL, CHECK(octet_length(bytes)<=2097152));`);
    // Land-cover data did not change when the ecological renderer changed. Reuse
    // historical real-source PNGs instead of downloading the same pixels again.
    await pool.query(`INSERT INTO map.rendered_tiles(version,layer,z,x,y,png,provenance)
      SELECT DISTINCT ON(z,x,y) 'worldcover-2021-v200',layer,z,x,y,png,provenance
      FROM map.rendered_tiles WHERE layer='landcover' AND version LIKE 'real-%'
      ORDER BY z,x,y,created_at DESC ON CONFLICT DO NOTHING`);
  } catch (error) { await pool.end(); throw error; }
  return {
    kind: 'postgres',
    async get(version, tile) {
      const result = await pool.query('SELECT png FROM map.rendered_tiles WHERE version=$1 AND layer=$2 AND z=$3 AND x=$4 AND y=$5', [version, tile.layer, tile.z, tile.x, tile.y]);
      return result.rows[0]?.png || null;
    },
    async put(version, tile, png, provenance = null) {
      await pool.query('INSERT INTO map.rendered_tiles(version,layer,z,x,y,png,provenance) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING', [version, tile.layer, tile.z, tile.x, tile.y, png, provenance]);
    },
    async getRecord(key) {
      const result = await pool.query('SELECT value,expires_at FROM map.source_records WHERE key=$1 AND (expires_at IS NULL OR expires_at>now())', [key]);
      const row = result.rows[0]; return row ? { value: row.value, expiresAt: row.expires_at } : null;
    },
    async putRecord(key, value, expiresAt) { await pool.query('INSERT INTO map.source_records(key,value,expires_at) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,expires_at=EXCLUDED.expires_at,retrieved_at=now()', [key, value, expiresAt]); },
    async getRange(key) { return (await pool.query('SELECT bytes FROM map.source_ranges WHERE key=$1', [key])).rows[0]?.bytes || null; },
    async putRange(key, bytes, provenance) { await pool.query('INSERT INTO map.source_ranges(key,bytes,provenance) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [key, bytes, provenance]); },
    close: () => pool.end(),
  };
}
