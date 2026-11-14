export class RequestPool {
  active=0; queue=[]; readyAt=0; timer=null;
  run(task,signal) {
    return new Promise((resolve,reject)=> {
      const item={task,signal,resolve,reject};
      item.cancel=()=> {const i=this.queue.indexOf(item);if(i!==-1)this.queue.splice(i,1);reject(new DOMException('Aborted','AbortError'));};
      if(signal.aborted)return item.cancel();
      signal.addEventListener('abort',item.cancel,{once:true});
      this.queue.push(item);this.readyAt=performance.now()+160;this.drain();
    });
  }
  drain() {
    clearTimeout(this.timer);
    if(this.queue.length&&performance.now()<this.readyAt){this.timer=setTimeout(()=>this.drain(),this.readyAt-performance.now());return;}
    while(this.active<6&&this.queue.length){const item=this.queue.shift();item.signal.removeEventListener('abort',item.cancel);if(item.signal.aborted){item.cancel();continue;}
      this.active++;Promise.resolve().then(item.task).then(item.resolve,item.reject).finally(()=>{this.active--;this.drain();});}
  }
}
function delay(ms,signal) {
  return new Promise((resolve,reject)=>{if(signal.aborted)return reject(signal.reason);const cancel=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},ms);signal.addEventListener('abort',cancel,{once:true});});
}
export function managedTileLayer(L,pool,stats,changed,failed,images) {
  return L.TileLayer.extend({
    _abortLoading(){for(const[key,entry]of Object.entries(this._tiles)){if(entry.coords.z!==this._tileZoom&&!entry.loaded)this._removeTile(key);}},
    createTile(coords,done) {
      const tile=document.createElement('canvas');tile.width=tile.height=256;tile.setAttribute('role','presentation');
      const controller=new AbortController();tile._requestController=controller;const signal=controller.signal;const url=this.getTileUrl(coords);
      const context=tile.getContext('2d'),layer=this.options.dataLayer;
      const preview=images.draw(context,layer,coords);
      if(preview){tile.classList.add('leaflet-tile-loaded');tile.dataset.preview=preview;stats.previews++;}
      if(preview==='exact'){
        stats.cacheHits++;queueMicrotask(()=>{if(!signal.aborted){done(null,tile);changed();}});return tile;
      }
      pool.run(async()=> {
        const combined=AbortSignal.any([signal,AbortSignal.timeout(28000)]);let response;
        for(let attempt=0;attempt<3;attempt++){
          try{response=await fetch(url,{signal:combined});}
          catch(error){if(combined.aborted||attempt===2)throw error;await delay(300*2**attempt,combined);continue;}
          if(![500,502,503,504,429].includes(response.status)||attempt===2)break;
          await response.body?.cancel();await delay(300*2**attempt,combined);
        }
        if(!response.ok)throw new Error(`Map tile HTTP ${response.status}`);
        const blob=await response.blob();signal.throwIfAborted();return createImageBitmap(blob);
      },signal).then(image=>{
        if(signal.aborted){image.close();return;}
        context.clearRect(0,0,256,256);context.drawImage(image,0,0);images.put(layer,coords,image);
        delete tile.dataset.preview;delete tile.dataset.failed;stats.loaded++;done(null,tile);changed();
      }).catch(error=>{if(signal.aborted){stats.aborted++;return;}tile.dataset.failed='true';stats.errors++;done(error,tile);failed();});
      return tile;
    }
  });
}
export function releaseTile({tile}) {
  tile._requestController?.abort();if(tile.tagName==='CANVAS')tile.width=tile.height=0;
}
