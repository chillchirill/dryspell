// Display generalization only. Analytical point samples retain their original source resolution.
export const LOD_VERSION='ecoregions-lod-v1';
export const ECOREGION_LODS=Object.freeze([
  {id:0,name:'world',minZoom:3,maxZoom:4,toleranceM:40000,minPolygonAreaM2:100000000},
  {id:1,name:'country',minZoom:5,maxZoom:7,toleranceM:8000,minPolygonAreaM2:1000000},
  {id:2,name:'region',minZoom:8,maxZoom:10,toleranceM:2000,minPolygonAreaM2:40000},
  {id:3,name:'local',minZoom:11,maxZoom:14,toleranceM:0,minPolygonAreaM2:0}
]);
export function ecoregionLod(z){
  if(!Number.isInteger(z)||z<3||z>19)throw new RangeError('Unsupported ecological map zoom');
  return ECOREGION_LODS.find(level=>Math.min(z,14)<=level.maxZoom);
}
export function tileLod(layer,z){return layer==='ecoregions'?ecoregionLod(z).name:`source-z${z}`;}
