import {randomUUID} from 'node:crypto';
import type {Coordinate,Bounds,EnvironmentSnapshot,LandscapeCell,LandscapeSnapshot,LandCover,Provenance,WeatherSample,WeatherSnapshot} from '@dryspell/contracts';
import {checksum,fetchWeather,localProjection,readRasterWindow,ProviderError} from './index.ts';
export interface PrepareRequest{center:Coordinate;sizeM?:number;cellSizeM?:number;date?:string;weatherOverride?:WeatherSample;}
const landClasses:Record<number,LandCover>={10:'woodland',20:'scrub',30:'grass',40:'grass',50:'built',60:'unknown',70:'unknown',80:'water',90:'grass',95:'woodland',100:'grass'};
function tileName(lat:number,lon:number){return`${lat>=0?'N':'S'}${String(Math.abs(lat)).padStart(2,'0')}${lon>=0?'E':'W'}${String(Math.abs(lon)).padStart(3,'0')}`;}
async function mosaic(bounds:Bounds,width:number,height:number,kind:'cover'|'dem'){
  const span=kind==='cover'?3:1,values=new Array<number>(width*height).fill(NaN),sources:Provenance[]=[];
  for(let lat=Math.floor(bounds.south/span)*span;lat<bounds.north;lat+=span)for(let lon=Math.floor(bounds.west/span)*span;lon<bounds.east;lon+=span){
    const x0=Math.max(0,Math.floor((lon-bounds.west)/(bounds.east-bounds.west)*width)),x1=Math.min(width,Math.ceil((lon+span-bounds.west)/(bounds.east-bounds.west)*width));
    const y0=Math.max(0,Math.floor((bounds.north-lat-span)/(bounds.north-bounds.south)*height)),y1=Math.min(height,Math.ceil((bounds.north-lat)/(bounds.north-bounds.south)*height));
    const part={west:Math.max(lon,bounds.west),east:Math.min(lon+span,bounds.east),south:Math.max(lat,bounds.south),north:Math.min(lat+span,bounds.north)};
    const normalizedLon=((lon+180)%360+360)%360-180,name=tileName(lat,normalizedLon);
    const demName=`Copernicus_DSM_COG_10_${name.slice(0,3)}_00_${name.slice(3)}_00_DEM`;
    const url=kind==='cover'?`https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${name}_Map.tif`:`https://copernicus-dem-30m.s3.amazonaws.com/${demName}/${demName}.tif`;
    const requestBounds={...part,west:part.west-lon+normalizedLon,east:part.east-lon+normalizedLon};
    const window=await readRasterWindow(url,requestBounds,x1-x0,y1-y0);
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)values[y*width+x]=window[(y-y0)*(x1-x0)+x-x0];
    sources.push({provider:kind==='cover'?'ESA WorldCover':'Copernicus DEM',sourceUrl:url,version:kind==='cover'?'2021 v200':'GLO-30 2021',validAt:'2021-01-01T00:00:00Z',retrievedAt:new Date().toISOString(),resolutionM:kind==='cover'?10:30,license:kind==='cover'?'CC BY 4.0':'Copernicus DEM free licence',attribution:kind==='cover'?'ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium':'© DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018 provided under COPERNICUS by the European Union and ESA; all rights reserved',checksum:checksum(window),sample:false,parameters:{bounds:requestBounds,width:x1-x0,height:y1-y0}});
  }return{values,sources};
}
export async function prepareLandscape(request:Pick<PrepareRequest,'center'|'sizeM'|'cellSizeM'>):Promise<LandscapeSnapshot>{
  const {longitude,latitude}=request.center,sizeM=request.sizeM||5000,cellSizeM=request.cellSizeM||25;
  if(![longitude,latitude,sizeM,cellSizeM].every(Number.isFinite)||Math.abs(longitude)>180||Math.abs(latitude)>85||sizeM<250||sizeM>20000||cellSizeM<10||sizeM/cellSizeM>400)throw new ProviderError('environment','AREA_BOUNDS','Use a finite center within ±85° latitude, 250–20000 m size, and no more than 400 cells per edge. Polar raster preparation is unavailable.');
  const width=Math.ceil(sizeM/cellSizeM-1e-9),height=width,dy=sizeM/2/111320,dx=sizeM/2/(111320*Math.cos(latitude*Math.PI/180));
  const bounds={west:longitude-dx,east:longitude+dx,south:latitude-dy,north:latitude+dy};
  const [dem,cover]=await Promise.all([mosaic(bounds,width,height,'dem'),mosaic(bounds,width,height,'cover')]);
  const cells:LandscapeCell[]=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const row=height-1-y,i=row*width+x,c=landClasses[cover.values[i]]||'unknown';
    const z=dem.values[i],west=dem.values[row*width+Math.max(0,x-1)],east=dem.values[row*width+Math.min(width-1,x+1)],south=dem.values[Math.min(height-1,row+1)*width+x],north=dem.values[Math.max(0,row-1)*width+x];
    const gx=(east-west)/((x===0||x===width-1?1:2)*cellSizeM),gy=(north-south)/((row===0||row===height-1?1:2)*cellSizeM),known=Number.isFinite(z)&&z> -1000&&z<10000,slopeKnown=known&&[west,east,south,north].every(v=>Number.isFinite(v)&&v> -1000&&v<10000);
    cells.push({sourceClassCode:cover.values[i],cover:c,elevationM:known?Math.round(z*10)/10:null,slopeDeg:slopeKnown?Math.atan(Math.hypot(gx,gy))*180/Math.PI:null,aspectDeg:slopeKnown?(Math.atan2(-gx,-gy)*180/Math.PI+360)%360:null,fuelModel:cover.values[i]===40?'cropland-herbaceous-assumption':c==='grass'?'GR1-inspired':c==='woodland'?'TL2-inspired':c==='scrub'?'SH2-inspired':'non-burnable',burnable:known&&['grass','woodland','scrub'].includes(c),spreadRateMps:c==='grass'?.16:c==='woodland'?.055:c==='scrub'?.1:0,moisture:.12});
  }
  const normalizedBounds={...bounds,west:((bounds.west+180)%360+360)%360-180,east:((bounds.east+180)%360+360)%360-180};
  return {id:'landscape-'+checksum({bounds:normalizedBounds,cellSizeM,cells}).slice(0,24),bounds:normalizedBounds,origin:{longitude:normalizedBounds.west,latitude:normalizedBounds.south},projection:localProjection(request.center),width,height,cellSizeM,cells,provenance:[...dem.sources,...cover.sources],checksum:checksum(cells)};
}
export async function prepareEnvironment(request:PrepareRequest):Promise<EnvironmentSnapshot>{
  const landscape=await prepareLandscape(request),{latitude,longitude}=request.center;
  const now=new Date().toISOString(),id='environment-'+randomUUID(),warnings=['Fuel rates are illustrative assumptions, not calibrated local forecasts. WorldCover and DEM are historical snapshots.'];
  let weather:WeatherSnapshot;
  if(request.weatherOverride){const w=request.weatherOverride;if(!Object.values(w).every(Number.isFinite)||w.humidityPct<0||w.humidityPct>100||w.windSpeedMps<0||w.precipitationMm<0)throw new Error('Invalid weather override');const validAt=request.date?new Date(request.date).toISOString():now;weather={id:'override-'+checksum(w).slice(0,16),validAt,issuedAt:now,samples:[{...w,timeSec:0},{...w,timeSec:86400}],stale:false,provenance:[{provider:'Administrator weather override',sourceUrl:'local:scenario-override',version:'1',retrievedAt:now,validAt,license:'User supplied',attribution:'Explicit scenario-only weather override',checksum:checksum(w),sample:true}]};warnings.push('Weather is an explicit administrator override.');}
  else weather=await fetchWeather(request.center,{date:request.date});
  return{id,name:`Prepared area ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,createdAt:now,sample:!!request.weatherOverride,status:landscape.cells.some(c=>c.cover==='unknown'||c.elevationM===null)?'partial':'ready',landscape,weather,warnings};
}
