import {PNG} from 'pngjs';
export const MAP_ORIGIN=process.env.MAP_API_ORIGIN||'http://127.0.0.1:4180';
export const MAP_PALETTE_VERSION='dryspell-natural-v2';
const palette:Record<string,string>={'0,100,0':'4f7f45','255,187,34':'b8ba86','255,255,76':'d9cd8a','240,150,255':'d8c59b','250,0,0':'b6b8ba','180,180,180':'dadada','240,240,240':'e2e9e7','0,100,200':'6eaed6','0,150,160':'6ba49a','0,207,117':'527f65','250,230,160':'c5bf8b'};
export function recolorLandcover(bytes:Buffer){const png=PNG.sync.read(bytes);for(let i=0;i<png.data.length;i+=4){if(!png.data[i+3])continue;const color=palette[`${png.data[i]},${png.data[i+1]},${png.data[i+2]}`];if(color){png.data[i]=parseInt(color.slice(0,2),16);png.data[i+1]=parseInt(color.slice(2,4),16);png.data[i+2]=parseInt(color.slice(4,6),16);}}return PNG.sync.write(png);}
export function recolorEcoregions(bytes:Buffer){const png=PNG.sync.read(bytes),colors:Record<string,number[]>={'76,130,88':[79,127,69],'157,175,99':[168,184,123],'214,183,110':[217,205,138],'189,209,128':[217,205,138],'180,182,162':[218,218,218]};for(let i=0;i<png.data.length;i+=4){if(!png.data[i+3])continue;const c=colors[`${png.data[i]},${png.data[i+1]},${png.data[i+2]}`];if(c){png.data[i]=c[0];png.data[i+1]=c[1];png.data[i+2]=c[2];}}return PNG.sync.write(png);}
const cache=new Map<string,Buffer>();let bytesCached=0;
const pending=new Map<string,Promise<Buffer>>();
let active=0;const waiting:Array<()=>void>=[];
async function acquire(){if(active<8){active++;return;}await new Promise<void>(resolve=>waiting.push(resolve));}
function release(){const next=waiting.shift();if(next)next();else active--;}
export async function mapTile(layer:string,z:number,x:number,y:number):Promise<Buffer>{
 if(!['landcover','ecoregions'].includes(layer)||![z,x,y].every(Number.isInteger)||z<(layer==='landcover'?6:3)||z>14||x<0||y<0||x>=2**z||y>=2**z)throw new Error('Invalid map tile');
 const tilePath=`${layer}/${z}/${x}/${y}`,key=`${MAP_PALETTE_VERSION}/${tilePath}`;if(cache.has(key))return cache.get(key)!;if(pending.has(key))return pending.get(key)!;if(pending.size>=96)throw new Error('Map busy; retry after navigation settles');
 const request=(async()=>{await acquire();try{let response:Response|undefined;for(let attempt=0;attempt<2;attempt++){response=await fetch(`${MAP_ORIGIN}/api/tiles/${tilePath}.png`,{signal:AbortSignal.timeout(30000)});if(response.ok||response.status!==429&&response.status<500)break;if(attempt===0){await response.body?.cancel();await new Promise(resolve=>setTimeout(resolve,500));}}if(!response?.ok)throw new Error(`Map service HTTP ${response?.status}`);const raw=Buffer.from(await response.arrayBuffer());if(raw.length>4*1024*1024)throw new Error('Map tile too large');const result=layer==='landcover'?recolorLandcover(raw):recolorEcoregions(raw);while(bytesCached+result.length>32*1024*1024&&cache.size){const oldest=cache.keys().next().value!;bytesCached-=cache.get(oldest)!.length;cache.delete(oldest);}cache.set(key,result);bytesCached+=result.length;return result;}finally{release();}})();pending.set(key,request);try{return await request;}finally{pending.delete(key);}
}
