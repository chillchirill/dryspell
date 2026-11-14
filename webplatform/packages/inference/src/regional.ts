import { createReadStream,createWriteStream } from 'node:fs';
import { writeFile,rename,rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import proj4 from 'proj4';
import { createSplitValidator,type TrainingRow,type DatasetManifest } from './ml';

export const REGIONAL_FEATURES=[
  {name:'temperatureC',unit:'degC'},{name:'humidityPct',unit:'percent RH'},
  {name:'windEastMps',unit:'m/s'},{name:'windNorthMps',unit:'m/s'},{name:'precipitationMm',unit:'mm'},
  {name:'elevationM',unit:'m'},{name:'slopeDeg',unit:'degrees'},
  {name:'grassFraction',unit:'fraction'},{name:'woodlandFraction',unit:'fraction'},
  {name:'scrubFraction',unit:'fraction'},{name:'waterFraction',unit:'fraction'},
  {name:'previousFire',unit:'observed binary'},{name:'latitudeSin',unit:'1'},{name:'latitudeCos',unit:'1'},
  {name:'longitudeSin',unit:'1'},{name:'longitudeCos',unit:'1'},{name:'dayOfYearSin',unit:'1'},{name:'dayOfYearCos',unit:'1'},
  {name:'neighbourObservedFireFraction',unit:'fraction'},{name:'neighbourKnownFraction',unit:'fraction'},
  {name:'previousContextKnownFraction',unit:'fraction'},{name:'knownFirePresent',unit:'indicator'},
  {name:'nearestKnownFireDistanceM',unit:'m; zero sentinel when knownFirePresent=0'},
  {name:'nearestKnownFireBearingSin',unit:'1'},{name:'nearestKnownFireBearingCos',unit:'1'},{name:'nearestKnownFireBearingDefined',unit:'indicator'}
];
const BASE_FEATURES=REGIONAL_FEATURES.slice(0,11);
export interface RegionalSource { id:string; provider:string; url:string; version:string; license:string; checksum:string; resolutionM:number; retrievedAt:string; }
export interface MaskPixel { id:string; sourceId:string; xM:number; yM:number; widthM:number; heightM:number; classification:'fire'|'no-fire'|'unknown'|'cloud'; quality:'good'|'bad'; observedAt:string; receivedAt:string; }
export interface RegionalFeature { name:string; value:number; unit:string; xM:number; yM:number; validAt:string; receivedAt:string; issuedAt?:string; kind:'observation'|'forecast'|'static'; sourceId:string; }
/** Coordinates are already normalized to the one declared metric CRS. No raw swath/HDF parsing is implied. */
export interface RegionalRecord {
  id:string; eventId:string; split:TrainingRow['split']; region:string; fuel:string; issuedAt:string;
  targetStart:string; targetEnd:string; featureValidAt:string;
  grid:{ projection:string; originXM:number; originYM:number; width:number; height:number; cellSizeM:1000; };
  sources:RegionalSource[]; previousMask:MaskPixel[]; targetMask:MaskPixel[]; environmentalFeatures:RegionalFeature[];
}
export interface RegionalOptions { minimumKnownCoverage?:number; maximumFeatureDistanceM?:number; featureTimeToleranceSec?:number; previousWindowHours?:number; retrospective?:boolean; }
export interface RegionalTrainingRow extends TrainingRow {
  recordId:string; cellId:string; projection:string; boundsM:[number,number,number,number]; location:{longitude:number;latitude:number};
  issuedAt:string; targetStart:string; targetEnd:string; knownCoverage:{previous:number;target:number};
  sourceIds:string[]; featureLineage:{name:string;sourceId:string;validAt:string;receivedAt:string;issuedAt?:string;resolutionM:number}[];
}
type Rectangle=[number,number,number,number];
interface CellMask { known:Rectangle[]; fire:Rectangle[]; sources:Set<string>; }
const timestamp=(value:string)=>{const n=Date.parse(value);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)||!Number.isFinite(n)||new Date(n).toISOString().slice(0,19)!==value.slice(0,19))throw new Error(`Invalid UTC timestamp: ${value}`);return n;};
/** Exact planar union of clipped footprints prevents duplicate/overlapping observations inflating coverage. */
export function rectangleUnionArea(rectangles:Rectangle[]):number{
  const xs=[...new Set(rectangles.flatMap(r=>[r[0],r[2]]))].sort((a,b)=>a-b);let area=0;
  for(let i=1;i<xs.length;i++){const left=xs[i-1],right=xs[i],intervals=rectangles.filter(r=>r[0]<right&&r[2]>left).map(r=>[r[1],r[3]]).sort((a,b)=>a[0]-b[0]);let length=0,low=0,high=0,started=false;
    for(const [a,b] of intervals){if(!started){low=a;high=b;started=true;}else if(a>high){length+=high-low;low=a;high=b;}else high=Math.max(high,b);}if(started)length+=high-low;area+=(right-left)*length;
  }return area;
}
function sourceMap(record:RegionalRecord){const map=new Map<string,RegionalSource>();for(const s of record.sources){if(!s.id||!s.provider||!s.url||!s.version||!s.license||!/^[a-f0-9]{64}$/i.test(s.checksum)||!Number.isFinite(s.resolutionM)||s.resolutionM<=0)throw new Error('Source provenance, SHA-256 and resolution are required');timestamp(s.retrievedAt);if(map.has(s.id))throw new Error('Duplicate source ID');map.set(s.id,s);}return map;}
function maskCells(record:RegionalRecord,pixels:MaskPixel[],sources:Map<string,RegionalSource>,start:number,end:number,cutoff:number|null){
  const cells=new Map<number,CellMask>(),ids=new Set<string>(),g=record.grid;
  for(const p of pixels){if(ids.has(p.id))throw new Error('Duplicate mask pixel ID within a window');ids.add(p.id);const source=sources.get(p.sourceId);if(!source)throw new Error('Unknown mask source');
    if(source.resolutionM>1000||p.widthM>1000||p.heightM>1000)throw new Error('Mask resolution is coarser than target: finer labels are prohibited');
    if(![p.xM,p.yM,p.widthM,p.heightM].every(Number.isFinite)||p.widthM<=0||p.heightM<=0)throw new Error('Invalid metric pixel footprint');
    const observed=timestamp(p.observedAt),received=timestamp(p.receivedAt);if(received<observed)throw new Error('Mask receipt precedes observation');
    if(observed<start||observed>=end||(cutoff!==null&&received>cutoff)||p.quality!=='good'||!['fire','no-fire'].includes(p.classification))continue;
    const minX=Math.max(0,Math.floor((p.xM-g.originXM)/1000)),maxX=Math.min(g.width-1,Math.ceil((p.xM+p.widthM-g.originXM)/1000)-1),minY=Math.max(0,Math.floor((p.yM-g.originYM)/1000)),maxY=Math.min(g.height-1,Math.ceil((p.yM+p.heightM-g.originYM)/1000)-1);
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){const west=g.originXM+x*1000,south=g.originYM+y*1000,rectangle:Rectangle=[Math.max(west,p.xM),Math.max(south,p.yM),Math.min(west+1000,p.xM+p.widthM),Math.min(south+1000,p.yM+p.heightM)],index=y*g.width+x;
      let cell=cells.get(index);if(!cell){cell={known:[],fire:[],sources:new Set()};cells.set(index,cell);}cell.known.push(rectangle);if(p.classification==='fire')cell.fire.push(rectangle);cell.sources.add(p.sourceId);
    }
  }return cells;
}
export function convertRegionalRecord(record:RegionalRecord,options:RegionalOptions={}):{rows:RegionalTrainingRow[];excluded:Record<string,number>}{
  const g=record.grid,issue=timestamp(record.issuedAt),targetStart=timestamp(record.targetStart),targetEnd=timestamp(record.targetEnd),featureAt=timestamp(record.featureValidAt),sources=sourceMap(record);
  if(!record.id||!record.eventId||!record.region||!record.fuel||!['train','validation','test'].includes(record.split))throw new Error('Record/event/domain/split identity is required');
  if(g.cellSizeM!==1000||!Number.isInteger(g.width)||!Number.isInteger(g.height)||g.width<1||g.height<1||g.width*g.height>4096||![g.originXM,g.originYM].every(Number.isFinite))throw new Error('Declare a bounded 1 km metric target grid');
  if(!g.projection.includes('+units=m')||/\+proj=(longlat|latlong)/.test(g.projection))throw new Error('An explicit metre-based projected CRS is required');
  if(targetStart-issue!==86400000||targetEnd<=targetStart||targetEnd-targetStart>86400000)throw new Error('Target must begin exactly 24 h after issue and declare a window up to 24 h');
  if(record.previousMask.length>100000||record.targetMask.length>100000||record.environmentalFeatures.length>100000)throw new Error('Normalized record exceeds bounded input limit');
  const minCoverage=options.minimumKnownCoverage??1;if(minCoverage<=0||minCoverage>1)throw new Error('Known coverage must be in (0,1]');
  const previous=maskCells(record,record.previousMask,sources,issue-(options.previousWindowHours??6)*3600000,issue+1,options.retrospective?null:issue),target=maskCells(record,record.targetMask,sources,targetStart,targetEnd,null);
  const featureGroups=new Map<string,RegionalFeature[]>(),distance=options.maximumFeatureDistanceM??25000,tolerance=(options.featureTimeToleranceSec??3600)*1000;
  for(const f of record.environmentalFeatures){if(!['observation','forecast','static'].includes(f.kind))throw new Error('Unknown environmental time semantics');if(!sources.has(f.sourceId))throw new Error('Unknown environmental source');if(![f.value,f.xM,f.yM].every(Number.isFinite))throw new Error('Non-finite environmental feature');const valid=timestamp(f.validAt),received=timestamp(f.receivedAt);if(!options.retrospective&&received>issue)continue;
    if(f.kind==='forecast'){if(!f.issuedAt||timestamp(f.issuedAt)>issue)continue;}else if(valid>issue)continue;
    if(f.kind!=='static'&&Math.abs(valid-featureAt)>tolerance)continue;
    const list=featureGroups.get(f.name)??[];list.push(f);featureGroups.set(f.name,list);
  }
  const knownFireCells=[...previous].filter(([,mask])=>mask.fire.length>0).map(([index])=>({index,xM:g.originXM+index%g.width*1000+500,yM:g.originYM+Math.floor(index/g.width)*1000+500}));
  const contextCoverage=[...previous.values()].reduce((sum,mask)=>sum+rectangleUnionArea(mask.known),0)/(g.width*g.height*1e6);
  const previousContextSources=[...new Set([...previous.values()].flatMap(mask=>[...mask.sources]))];
  const rows:RegionalTrainingRow[]=[],excluded={coverage:0,features:0};
  for(let i=0;i<g.width*g.height;i++){const a=previous.get(i),b=target.get(i),coverageA=a?rectangleUnionArea(a.known)/1e6:0,coverageB=b?rectangleUnionArea(b.known)/1e6:0;
    if(coverageA+1e-10<minCoverage||coverageB+1e-10<minCoverage||(!a?.fire.length&&coverageA<1-1e-10)||(!b?.fire.length&&coverageB<1-1e-10)){excluded.coverage++;continue;}
    const west=g.originXM+i%g.width*1000,south=g.originYM+Math.floor(i/g.width)*1000,xM=west+500,yM=south+500,chosen:RegionalFeature[]=[];
    for(const spec of BASE_FEATURES){const candidates=(featureGroups.get(spec.name)??[]).filter(f=>f.unit===spec.unit&&Math.hypot(f.xM-xM,f.yM-yM)<=distance).sort((a,b)=>Math.abs(timestamp(a.validAt)-featureAt)-Math.abs(timestamp(b.validAt)-featureAt)||Math.hypot(a.xM-xM,a.yM-yM)-Math.hypot(b.xM-xM,b.yM-yM)||timestamp(b.issuedAt??b.receivedAt)-timestamp(a.issuedAt??a.receivedAt));if(candidates[0])chosen.push(candidates[0]);}
    if(chosen.length!==BASE_FEATURES.length){excluded.features++;continue;}
    const values=chosen.map(f=>f.value);if(values[1]<0||values[1]>100||values[4]<0||values[6]<0||values[6]>90||values.slice(7,11).some(x=>x<0||x>1)||values.slice(7,11).reduce((sum,v)=>sum+v,0)>1.000001)throw new Error('Environmental units/ranges or land-cover fractions are inconsistent');
    const [longitude,latitude]=proj4(g.projection,'EPSG:4326',[xM,yM]);if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>90)throw new Error('Projection produced invalid coordinates');
    const previousFire:0|1=a!.fire.length?1:0,label:0|1=b!.fire.length?1:0,day=(issue-Date.UTC(new Date(issue).getUTCFullYear(),0,1))/86400000,angle=2*Math.PI*day/365.2425,radians=Math.PI/180;
    const geographicBlock=`lon${Math.floor(longitude+180)}:lat${Math.floor(latitude+90)}`;
    let neighbours=0,knownNeighbours=0,fireNeighbours=0;const cx=i%g.width,cy=Math.floor(i/g.width);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=cx+dx,ny=cy+dy;if(nx<0||nx>=g.width||ny<0||ny>=g.height)continue;neighbours++;const mask=previous.get(ny*g.width+nx);if(mask?.fire.length)fireNeighbours++;if(mask&&rectangleUnionArea(mask.known)>=1e6-1e-4)knownNeighbours++;}
    let nearest:typeof knownFireCells[number]|undefined,nearestDistance=Infinity;for(const fire of knownFireCells){const d=Math.hypot(fire.xM-xM,fire.yM-yM);if(d<nearestDistance){nearest=fire;nearestDistance=d;}}
    const bearingDefined=nearest!==undefined&&nearestDistance>0,contextFeatures=[neighbours?fireNeighbours/neighbours:0,neighbours?knownNeighbours/neighbours:0,contextCoverage,nearest?1:0,nearest?nearestDistance:0,bearingDefined?(nearest!.xM-xM)/nearestDistance:0,bearingDefined?(nearest!.yM-yM)/nearestDistance:0,bearingDefined?1:0];
    rows.push({eventId:record.eventId,geographicBlock,timeBlock:record.issuedAt.slice(0,7),split:record.split,region:record.region,fuel:record.fuel,features:[...values,previousFire,Math.sin(latitude*radians),Math.cos(latitude*radians),Math.sin(longitude*radians),Math.cos(longitude*radians),Math.sin(angle),Math.cos(angle),...contextFeatures],label,previousFire,recordId:record.id,cellId:`${record.id}:${i}`,projection:g.projection,boundsM:[west,south,west+1000,south+1000],location:{longitude,latitude},issuedAt:record.issuedAt,targetStart:record.targetStart,targetEnd:record.targetEnd,knownCoverage:{previous:coverageA,target:coverageB},sourceIds:[...new Set([...previousContextSources,...b!.sources,...chosen.map(f=>f.sourceId)])].sort(),featureLineage:chosen.map(f=>({name:f.name,sourceId:f.sourceId,validAt:f.validAt,receivedAt:f.receivedAt,issuedAt:f.issuedAt,resolutionM:sources.get(f.sourceId)!.resolutionM}))});
  }return {rows,excluded};
}
export async function convertRegionalJsonl(inputPath:string,outputPath:string,options:RegionalOptions={}){
  const temporary=outputPath+'.partial',stream=createWriteStream(temporary,{flags:'wx'}),validator=createSplitValidator(REGIONAL_FEATURES.length,{geographicHoldout:true,temporalHoldout:true}),inputHash=createHash('sha256'),outputHash=createHash('sha256'),sources=new Map<string,RegionalSource>();let records=0,rows=0,created=false;const recordIds=new Set<string>(),regions=new Set<string>();const excluded={coverage:0,features:0};
  try{
    await once(stream,'open');created=true;
    for await(const line of createInterface({input:createReadStream(inputPath),crlfDelay:Infinity})){if(!line.trim())continue;if(Buffer.byteLength(line)>64*1024*1024)throw new Error('Input JSONL record exceeds64 MiB');inputHash.update(line+'\n');const record=JSON.parse(line) as RegionalRecord,result=convertRegionalRecord(record,options);if(recordIds.has(record.id))throw new Error('Duplicate record identity');recordIds.add(record.id);regions.add(record.region);records++;
      for(const source of record.sources){const old=sources.get(source.id);if(old&&JSON.stringify(old)!==JSON.stringify(source))throw new Error('Conflicting immutable source provenance');sources.set(source.id,source);}
      excluded.coverage+=result.excluded.coverage;excluded.features+=result.excluded.features;
      for(const row of result.rows){validator.check(row);const serialized=JSON.stringify(row)+'\n';outputHash.update(serialized);if(!stream.write(serialized))await once(stream,'drain');rows++;}
    }
    const splits=validator.finish();stream.end();await once(stream,'finish');
    const manifest:DatasetManifest&Record<string,unknown>={name:'Dryspell coverage-aware regional daily dataset',sourceUrl:'operator-normalized metric source records; see sources',sourceVersion:'regional-normalized-v1',license:'Per-source licence retained; operator must verify redistribution compatibility',features:REGIONAL_FEATURES,target:'Any quality-observed active-fire footprint in a1km cell during the declared window beginning24h after issue',resolutionM:1000,horizonHours:24,domain:regions.size===1?[...regions][0]:[...regions].sort().join(' | '),retrospective:options.retrospective??false,coveragePolicy:`Both previous and target known union-area coverage >=${options.minimumKnownCoverage??1}; only good fire/no-fire masks count. Cloud/unknown/bad QA excluded. Negative labels require100% known coverage even if the positive threshold is relaxed. No hotspot absence negatives.`,sourceChecksums:Object.fromEntries([...sources.values()].map(s=>[s.id,s.checksum])),splitPolicy:{geographicHoldout:true,temporalHoldout:true},sources:[...sources.values()],recordCount:records,rowCount:rows,splits,excluded,inputNormalizedJsonlSha256:inputHash.digest('hex'),rowsSha256:outputHash.digest('hex'),geographicBlockPolicy:'Derived1-degree longitude/latitude blocks, no cross-split block reuse; no spatial-buffer claim',temporalBlockPolicy:'UTC issue-month blocks, no cross-split month reuse',neighbourFeaturesPolicy:'Previous-mask only, eight in-bounds adjacent1km cells; nearest observed-fire cell centre within supplied grid. Presence/coverage/bearing-defined indicators distinguish unknown context and zero sentinels. Outside-grid activity is unknown.',options};
    await rename(temporary,outputPath);await writeFile(outputPath+'.manifest.json',JSON.stringify(manifest,null,2));return manifest;
  }catch(error){stream.destroy();if(!stream.closed)await once(stream,'close');if(created)await rm(temporary,{force:true});throw error;}
}
