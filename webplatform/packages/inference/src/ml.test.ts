import { describe,it,expect } from 'vitest';
import { metrics,fitNormalizer,validateSplits,modelFallback,trainBaseline,predictDailyBaseline,type TrainingRow,type DatasetManifest } from './ml';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { resolve,join } from 'node:path';
const rows:TrainingRow[]=['train','validation','test'].map((split,i)=>({eventId:`event${i}`,geographicBlock:`block${i}`,timeBlock:'2020-07',split:split as TrainingRow['split'],region:'US',fuel:'grass',features:[i,1],label:(i%2) as 0|1,previousFire:0}));
describe('ML data/evaluation safeguards',()=>{
  it('rejects event leakage and unknown labels',()=>{expect(()=>validateSplits(rows,2)).not.toThrow();expect(()=>validateSplits([...rows,{...rows[0],split:'test'}],2)).toThrow('leakage');});
  it('rejects geographical reuse across different times and separately enforces temporal holdouts',()=>{const geographic=rows.map(r=>({...r}));geographic[1].geographicBlock=geographic[0].geographicBlock;geographic[1].timeBlock='2021-08';expect(()=>validateSplits(geographic,2)).toThrow('geographic:');expect(()=>validateSplits(rows,2,{temporalHoldout:true})).toThrow('temporal:');const strict=rows.map((r,i)=>({...r,timeBlock:`2020-0${i+1}`}));expect(()=>validateSplits(strict,2,{temporalHoldout:true})).not.toThrow();});
  it('normalizes only explicit training rows and handles constants',()=>{expect(fitNormalizer(rows.filter(r=>r.split==='train'))).toEqual({mean:[0,1],scale:[1,1]});});
  it('computes calibration-aware metrics and explicit domain fallback',()=>{const m=metrics([0,1],[.1,.9]);expect(m.brier).toBeCloseTo(.01);expect(m.prAuc).toBe(1);expect(modelFallback(undefined,'US',1000,24)).toContain('unavailable');expect(modelFallback({promoted:true,manifest:{domain:'US',resolutionM:1000,horizonHours:24}},'US',25,1)).toContain('mismatch');});
  it('trains, exports, loads and runs a synthetic CPU compatibility fixture with explicit promotion/domain gates',async()=>{
    const root=resolve('packages/inference'),directory=await mkdtemp(join(root,'.test-model-'));
    try{
      const sample:TrainingRow[]=Array.from({length:36},(_,i)=>({...rows[Math.floor(i/12)],eventId:`fixture-${Math.floor(i/12)}`,features:[i%2,i%3],label:(i%2) as 0|1,previousFire:(i%2) as 0|1}));
      const manifest:DatasetManifest={name:'Synthetic software compatibility only',sourceUrl:'local:test-fixture',sourceVersion:'1',license:'test fixture',features:[{name:'a',unit:'fixture'},{name:'b',unit:'fixture'}],target:'Test-only binary outcome',resolutionM:1000,horizonHours:24,domain:'test-domain',retrospective:true,coveragePolicy:'all synthetic labels known',sourceChecksums:{}};
      const result=await trainBaseline(sample,manifest,directory,42,2);expect(result.epochs).toBe(2);
      expect((await predictDailyBaseline({directory,region:'test-domain',resolutionM:1000,horizonHours:24,features:[[0,1]]})).fallbackReason).toContain('not promoted');
      const path=join(directory,'metadata.json'),metadata=JSON.parse(await readFile(path,'utf8'));metadata.promoted=true;await writeFile(path,JSON.stringify(metadata));
      const output=await predictDailyBaseline({directory,region:'test-domain',resolutionM:1000,horizonHours:24,features:[[0,1],[1,1]]});expect(output.activeModel).toBe('daily-neural');expect(output.probabilities).toHaveLength(2);expect(output.probabilities!.every(x=>x>0&&x<1)).toBe(true);
      expect((await predictDailyBaseline({directory,region:'elsewhere',resolutionM:1000,horizonHours:24,features:[[0,1]]})).fallbackReason).toContain('domain');
      expect((await predictDailyBaseline({directory,region:'test-domain',resolutionM:25,horizonHours:1,features:[[0,1]]})).fallbackReason).toContain('mismatch');
    }finally{if(!resolve(directory).startsWith(root+String.fromCharCode(92))&&!resolve(directory).startsWith(root+'/'))throw new Error('Unsafe test cleanup target');await rm(directory,{recursive:true,force:true});}
  },20000);
});
