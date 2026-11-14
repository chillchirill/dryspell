-- Isolated database: dryspell_map. Never run against webplatform's database.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_raster;
CREATE SCHEMA IF NOT EXISTS map;

-- Rendered pixels stay compressed in 256 x 256 tiles, not individual SQL rows.
CREATE TABLE IF NOT EXISTS map.rendered_tiles (
  version text NOT NULL,
  layer text NOT NULL,
  z smallint NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  png bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version, layer, z, x, y),
  CHECK (octet_length(png) < 1048576)
);
ALTER TABLE map.rendered_tiles ADD COLUMN IF NOT EXISTS provenance jsonb;
CREATE INDEX IF NOT EXISTS rendered_tiles_created ON map.rendered_tiles(created_at);

CREATE TABLE IF NOT EXISTS map.source_records (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  expires_at timestamptz,
  retrieved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS map.source_ranges (
  key text PRIMARY KEY,
  bytes bytea NOT NULL,
  provenance jsonb NOT NULL,
  CHECK(octet_length(bytes)<=2097152)
);

-- Future measured/imported source data: tiled raster bands in EPSG:3857.
-- Use 256 x 256 blocks and matching lower-resolution overview datasets.
CREATE TABLE IF NOT EXISTS map.raster_sources (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset text NOT NULL,
  observed_at timestamptz,
  resolution_m double precision NOT NULL CHECK (resolution_m > 0),
  rast raster NOT NULL,
  CHECK (ST_SRID(rast) = 3857),
  CHECK (ST_Width(rast) <= 256 AND ST_Height(rast) <= 256)
);
CREATE INDEX IF NOT EXISTS raster_sources_extent ON map.raster_sources USING gist(ST_ConvexHull(rast));
CREATE INDEX IF NOT EXISTS raster_sources_dataset_resolution ON map.raster_sources(dataset, resolution_m, observed_at);

CREATE TABLE IF NOT EXISTS map.features (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('steppe', 'forest-steppe', 'river', 'lake')),
  properties jsonb NOT NULL DEFAULT '{}',
  geom geometry(Geometry, 3857) NOT NULL
);
CREATE INDEX IF NOT EXISTS features_geom ON map.features USING gist(geom);

-- Maintenance example after old simulation versions are retired:
-- DELETE FROM map.rendered_tiles WHERE version <> 'real-v1';
-- Source rasters are deliberately separate from disposable rendered tile cache.
