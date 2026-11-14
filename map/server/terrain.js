// Coordinate utilities only. The map uses real source data; no procedural terrain.
export const WORLD_VERSION = 'real-lod-v1';
export const TILE_SIZE = 256;
export const MAX_LAT = 85.0511287798066;
export const LAYERS = ['landcover', 'ecoregions'];
export function lonLatToWorld(lng, lat) {
  const s = Math.sin(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}
export function worldToLonLat(x, y) {
  return [x * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI];
}
export function tilePoint(z, x, y, px, py) {
  const scale = 2 ** z * TILE_SIZE;
  return [(x * TILE_SIZE + px) / scale, (y * TILE_SIZE + py) / scale];
}
