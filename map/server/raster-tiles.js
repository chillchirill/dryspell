import {fromCustomClient} from 'geotiff';
import sharp from 'sharp';
import {ByteLRU} from './cache.js';
import {cogUrl,LANDCOVER_SOURCE} from './providers.js';
import {worldToLonLat} from './terrain.js';

export const CLASS_COLORS={10:[0,100,0],20:[255,187,34],30:[255,255,76],40:[240,150,255],50:[250,0,0],60:[180,180,180],70:[240,240,240],80:[0,100,200],90:[0,150,160],95:[0,207,117],100:[250,230,160]};
export function selectOverview(images,base,resolution){
  let selected=base;
  for(const image of images)if(Math.abs(image.getResolution(base)[0])<=resolution)selected=image;
  return selected;
}
export function createRasterTiles(storage){
  const ranges=new ByteLRU(24*1024*1024),pending=new Map(),sources=new Map();
  let downloadedBytes=0;
  async function rangeBytes(url,range){
    const key=`${url}|${range}`,cached=ranges.get(key);if(cached)return cached;
    if(pending.has(key))return pending.get(key);
    const task=(async()=>{
      let bytes=await storage.getRange(key);
      if(!bytes){
        const response=await fetch(url,{headers:{Range:range},signal:AbortSignal.timeout(8000)});
        if(response.status!==206){await response.body?.cancel();throw Object.assign(new Error(`ESA source HTTP ${response.status}`),{statusCode:response.status===404?404:502});}
        const chunks=[];let size=0;
        for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024)throw new Error('Source range exceeds 2 MiB');chunks.push(chunk);}
        bytes=Buffer.concat(chunks,size);downloadedBytes+=size;
        await storage.putRange(key,bytes,{...LANDCOVER_SOURCE,sourceUrl:url,requestRange:range,delivery:'COG display overview',retrievedAt:new Date().toISOString()});
      }
      ranges.set(key,bytes);return bytes;
    })();
    pending.set(key,task);try{return await task;}finally{pending.delete(key);}
  }
  async function source(url){
    if(sources.has(url)){const value=sources.get(url);sources.delete(url);sources.set(url,value);return value;}
    const task=(async()=>{
      const tiff=await fromCustomClient({url,async request(options={}){
        const range=options.headers?.Range||options.headers?.range,match=/^bytes=(\d+)-(\d+)$/.exec(range||'');
        if(!match||Number(match[2])-Number(match[1])+1>2*1024*1024)throw new Error('Only bounded COG ranges are supported');
        const begin=Number(match[1]),end=Number(match[2]),alignedBegin=Math.floor(begin/65536)*65536,alignedEnd=Math.ceil((end+1)/65536)*65536-1;
        const block=await rangeBytes(url,`bytes=${alignedBegin}-${alignedEnd}`),bytes=block.subarray(begin-alignedBegin,end-alignedBegin+1);
        return {status:206,ok:true,getHeader:name=>name.toLowerCase()==='content-range'?`bytes ${begin}-${begin+bytes.length-1}/*`:undefined,getData:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)};
      }},{allowFullFile:false,maxRanges:0});
      const images=[];for(let i=0,n=await tiff.getImageCount();i<n;i++)images.push(await tiff.getImage(i));
      return {images,base:images[0],origin:images[0].getOrigin()};
    })();
    if(sources.size>=8)sources.delete(sources.keys().next().value);sources.set(url,task);
    try{return await task;}catch(error){if(error.statusCode!==404&&sources.get(url)===task)sources.delete(url);throw error;}
  }
  async function render({z,x,y},{signal}={}){
    signal?.throwIfAborted();
    const scale=2**z,[west,north]=worldToLonLat(x/scale,y/scale),[east,south]=worldToLonLat((x+1)/scale,(y+1)/scale);
    const rgba=Buffer.alloc(256*256*4),columns=new Map(),rows=new Map();
    // Only 512 coordinate entries, not one allocation per output pixel.
    for(let px=0;px<256;px++){
      const lng=west+(px+.5)/256*(east-west),key=Math.floor(lng/3)*3;
      if(!columns.has(key))columns.set(key,[]);columns.get(key).push([px,lng]);
    }
    for(let py=0;py<256;py++){
      const lat=worldToLonLat(0,(y+(py+.5)/256)/scale)[1];if(lat< -60||lat>=83)continue;
      const key=Math.floor(lat/3)*3;if(!rows.has(key))rows.set(key,[]);rows.get(key).push([py,lat]);
    }
    for(const column of columns.values())for(const row of rows.values()){
      const group={west:column[0][1],east:column.at(-1)[1],north:row[0][1],south:row.at(-1)[1]},url=cogUrl(group.north,group.west);
      signal?.throwIfAborted();let dataset;
      try{dataset=await source(url);}catch(error){if(error.statusCode===404)continue;throw Object.assign(error,{statusCode:502});}
      const {images,base,origin}=dataset;
      const image=selectOverview(images,base,Math.min(east-west,north-south)/256),resolution=image.getResolution(base);
      const left=Math.max(0,Math.floor((group.west-origin[0])/resolution[0])),top=Math.max(0,Math.floor((group.north-origin[1])/resolution[1]));
      const right=Math.min(image.getWidth(),Math.floor((group.east-origin[0])/resolution[0])+1),bottom=Math.min(image.getHeight(),Math.floor((group.south-origin[1])/resolution[1])+1);
      if(right<=left||bottom<=top)continue;
      // An overview bounds decoded windows even when the viewport covers a country.
      if((right-left)*(bottom-top)>1024*1024)throw new Error('Display window exceeds bounded overview size');
      const raster=await image.readRasters({window:[left,top,right,bottom],samples:[0],interleave:true,signal});
      for(const[py,lat]of row)for(const[px,lng]of column){
        const ix=Math.min(right-1,Math.max(left,Math.floor((lng-origin[0])/resolution[0]))),iy=Math.min(bottom-1,Math.max(top,Math.floor((lat-origin[1])/resolution[1])));
        const color=CLASS_COLORS[raster[(iy-top)*(right-left)+ix-left]];if(!color)continue;
        const index=(py*256+px)*4;rgba[index]=color[0];rgba[index+1]=color[1];rgba[index+2]=color[2];rgba[index+3]=255;
      }
    }
    signal?.throwIfAborted();return sharp(rgba,{raw:{width:256,height:256,channels:4}}).png({compressionLevel:3,palette:true}).toBuffer();
  }
  return {render,stats:()=>({ranges:ranges.stats(),sources:sources.size,pendingRanges:pending.size,downloadedBytes})};
}
