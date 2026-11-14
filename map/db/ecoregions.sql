CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS map;
CREATE TABLE IF NOT EXISTS map.ecoregion_sources (
  version text PRIMARY KEY,
  provenance jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS map.ecoregions (
  eco_id integer PRIMARY KEY,
  name text NOT NULL,
  biome text NOT NULL,
  zone text NOT NULL,
  geom geometry(MultiPolygon,3857) NOT NULL,
  source_version text NOT NULL REFERENCES map.ecoregion_sources(version)
);
CREATE INDEX IF NOT EXISTS ecoregions_geometry ON map.ecoregions USING gist(geom);
ALTER TABLE map.ecoregions ADD COLUMN IF NOT EXISTS geom_low geometry(MultiPolygon,3857);
ALTER TABLE map.ecoregions ADD COLUMN IF NOT EXISTS geom_mid geometry(MultiPolygon,3857);
