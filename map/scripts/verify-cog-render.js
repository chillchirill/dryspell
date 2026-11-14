import {createRasterTiles} from '../server/raster-tiles.js';
import {openStorage} from '../server/storage.js';
import {PNG} from 'pngjs';
import {lonLatToWorld} from '../server/terrain.js';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const storage=await openStorage(process.env.MAP_DATABASE_URL),raster=createRasterTiles(storage),results=[];
try { for(const point of [{name:'water',lat:49.5,lng:32.15,color:[0,100,200,255]},{name:'forest',lat:49.47,lng:31.9,color:[0,100,0,255]}]){
 const z=14,[wx,wy]=lonLatToWorld(point.lng,point.lat),x=Math.floor(wx*2**z),y=Math.floor(wy*2**z),started=performance.now();
 const png=await raster.render({z,x,y},{signal:AbortSignal.timeout(25000)});const decoded=PNG.sync.read(png),index=(Math.floor((wy*2**z-y)*256)*256+Math.floor((wx*2**z-x)*256))*4;
 const pixel=[...decoded.data.subarray(index,index+4)];assert.deepEqual(pixel,point.color);
 await writeFile(`output/cog-${point.name}.png`,png);const result={point,tile:{z,x,y},ms:performance.now()-started,pixel,bytes:png.length,stats:raster.stats()};results.push(result);console.log(JSON.stringify(result));
}
const started=performance.now();await Promise.all([9650,9651,9652,9653].map(x=>raster.render({z:14,x,y:5594},{signal:AbortSignal.timeout(25000)})));
results.push({concurrentTiles:4,ms:performance.now()-started,stats:raster.stats()});
await writeFile('output/cog-verification.json',JSON.stringify(results,null,2));}finally{await storage.close();}
