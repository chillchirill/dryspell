CREATE TABLE IF NOT EXISTS map.ecoregion_lod (
  lod smallint NOT NULL,
  eco_id integer NOT NULL,
  zone text NOT NULL,
  geom geometry(Polygon,3857) NOT NULL,
  CHECK(ST_NPoints(geom)<=128)
) PARTITION BY LIST(lod);
CREATE TABLE IF NOT EXISTS map.ecoregion_lod_world PARTITION OF map.ecoregion_lod FOR VALUES IN(0);
CREATE TABLE IF NOT EXISTS map.ecoregion_lod_country PARTITION OF map.ecoregion_lod FOR VALUES IN(1);
CREATE TABLE IF NOT EXISTS map.ecoregion_lod_region PARTITION OF map.ecoregion_lod FOR VALUES IN(2);
CREATE TABLE IF NOT EXISTS map.ecoregion_lod_local PARTITION OF map.ecoregion_lod FOR VALUES IN(3);
CREATE INDEX IF NOT EXISTS ecoregion_lod_geometry ON map.ecoregion_lod USING gist(geom);
CREATE TABLE IF NOT EXISTS map.lod_catalog (
  layer text NOT NULL,
  lod smallint NOT NULL,
  version text NOT NULL,
  name text NOT NULL,
  min_zoom smallint NOT NULL,
  max_zoom smallint NOT NULL,
  tolerance_m integer NOT NULL,
  polygon_count integer NOT NULL,
  point_count bigint NOT NULL,
  geometry_bytes bigint NOT NULL,
  built_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(layer,lod)
);
