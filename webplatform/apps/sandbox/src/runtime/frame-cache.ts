import type {SimulationFrame} from '@dryspell/contracts';

interface PackedFrame {metadata:SimulationFrame;burning:Uint32Array;burned:Uint32Array;cells:Uint32Array;phases:Uint8Array;values:Float64Array;bytes:number;}
/** Exact numeric columns, bounded LRU; no unbounded history of full terrain objects. */
export class FrameCache {
  private frames=new Map<number,PackedFrame>();
  private totalBytes=0;
  constructor(readonly maxBytes=16*1024*1024,readonly maxFrames=64){}
  get size(){return this.frames.size;}
  get bytes(){return this.totalBytes;}
  clear(){this.frames.clear();this.totalBytes=0;}
  set(frame:SimulationFrame):void {
    const old=this.frames.get(frame.timeSec);if(old){this.totalBytes-=old.bytes;this.frames.delete(frame.timeSec);}
    const burning=Uint32Array.from(frame.burningCells),burned=Uint32Array.from(frame.burnedCells),combustion=frame.combustion??[],cells=new Uint32Array(combustion.length),phases=new Uint8Array(combustion.length),values=new Float64Array(combustion.length*4);
    combustion.forEach((value,i)=>{cells[i]=value.cell;phases[i]=value.phase==='flaming'?1:0;values.set([value.intensity,value.fuelRemainingKgM2,value.heatFluxWm2,value.smokeFluxKgM2Sec],i*4);});
    // Keep original property order so re-hashing an unpacked frame is byte-identical.
    const metadata=structuredClone({...frame,burningCells:[],burnedCells:[],...(frame.combustion?{combustion:[]}: {})});
    const bytes=burning.byteLength+burned.byteLength+cells.byteLength+phases.byteLength+values.byteLength+new TextEncoder().encode(JSON.stringify(metadata)).byteLength*2;
    if(bytes>this.maxBytes)return;
    this.frames.set(frame.timeSec,{metadata,burning,burned,cells,phases,values,bytes});this.totalBytes+=bytes;
    while(this.totalBytes>this.maxBytes||this.frames.size>this.maxFrames){const time=this.frames.keys().next().value!,entry=this.frames.get(time)!;this.totalBytes-=entry.bytes;this.frames.delete(time);}
  }
  get(timeSec:number):SimulationFrame|undefined {
    const entry=this.frames.get(timeSec);if(!entry)return undefined;
    this.frames.delete(timeSec);this.frames.set(timeSec,entry);
    const frame=structuredClone(entry.metadata);frame.burningCells=Array.from(entry.burning);frame.burnedCells=Array.from(entry.burned);
    if(entry.metadata.combustion)frame.combustion=Array.from(entry.cells,(cell,i)=>({cell,phase:entry.phases[i]?'flaming':'residual',intensity:entry.values[i*4],fuelRemainingKgM2:entry.values[i*4+1],heatFluxWm2:entry.values[i*4+2],smokeFluxKgM2Sec:entry.values[i*4+3]}));
    return frame;
  }
}
