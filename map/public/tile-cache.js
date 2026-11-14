// Decoded images are expensive: 64 x 256 x 256 x 4 = 16 MiB maximum.
export class TileImageCache {
  constructor(maxBytes=16*1024*1024){this.maxBytes=maxBytes;this.bytes=0;this.items=new Map();}
  key(layer,{z,x,y}){return `${layer}/${z}/${x}/${y}`;}
  get(layer,coords){const key=this.key(layer,coords),item=this.items.get(key);if(!item)return null;this.items.delete(key);this.items.set(key,item);return item.image;}
  put(layer,coords,image){
    const key=this.key(layer,coords),bytes=image.width*image.height*4;
    const old=this.items.get(key);if(old){this.bytes-=old.bytes;old.image.close?.();this.items.delete(key);}
    if(bytes>this.maxBytes){image.close?.();return;}
    while(this.bytes+bytes>this.maxBytes){const [first,item]=this.items.entries().next().value;this.items.delete(first);this.bytes-=item.bytes;item.image.close?.();}
    this.items.set(key,{image,bytes});this.bytes+=bytes;
  }
  draw(context,layer,coords){
    context.imageSmoothingEnabled=false;
    const exact=this.get(layer,coords);
    if(exact){context.drawImage(exact,0,0,256,256);return 'exact';}
    for(let dz=1;dz<=4&&coords.z-dz>=3;dz++){
      const scale=2**dz,parent=this.get(layer,{z:coords.z-dz,x:Math.floor(coords.x/scale),y:Math.floor(coords.y/scale)});
      if(parent){const size=256/scale;context.drawImage(parent,(coords.x%scale)*size,(coords.y%scale)*size,size,size,0,0,256,256);return 'overview';}
    }
    let children=0;
    for(let dx=0;dx<2;dx++)for(let dy=0;dy<2;dy++){
      const child=this.get(layer,{z:coords.z+1,x:coords.x*2+dx,y:coords.y*2+dy});
      if(child){context.drawImage(child,dx*128,dy*128,128,128);children++;}
    }
    return children?'overview':null;
  }
  stats(){return {entries:this.items.size,bytes:this.bytes,maxBytes:this.maxBytes};}
  clear(){for(const {image}of this.items.values())image.close?.();this.items.clear();this.bytes=0;}
}
