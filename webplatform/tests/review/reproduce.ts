import {fixture} from '../../packages/simulation/src/test-fixture.ts';
import {cellCenter} from '../../packages/simulation/src/index.ts';
import {predictFireSpread} from '../../packages/inference/src/index.ts';
import type {PredictionInput,ValidatedObservation} from '../../packages/contracts/src/index.ts';
const {e}=fixture(9);
const input:PredictionInput={area:{type:'Polygon',coordinates:[]},issuedAt:'2026-01-01T00:10:00Z',requestedTimes:['2026-01-01T00:10:00Z'],observations:[],weatherSnapshot:e.weather,landscapeSnapshot:e.landscape,seed:5,config:{ensembleSize:16,horizonSec:3600}};
function observation(id:string,index:number,temperatureC:number):ValidatedObservation{return{id,sensorId:id,source:'real',recordedAt:'2026-01-01T00:09:00Z',receivedAt:'2026-01-01T00:09:01Z',location:cellCenter(e.landscape,index),locationVersion:1,quality:[],values:{temperatureC,smokePct:80}};}
const a=observation('A',30,80),b=observation('B',50,50);
const once=await predictFireSpread({...input,observations:[a,b]});
const duplicate=await predictFireSpread({...input,observations:[a,a,b]});
console.log(JSON.stringify({check:'duplicate packet must not alter posterior',equal:JSON.stringify(once.posterior)===JSON.stringify(duplicate.posterior),uniqueNoFire:once.posterior.noFireProbability,duplicateNoFire:duplicate.posterior.noFireProbability,uniqueProcessed:once.posterior.processedObservationIds,duplicateProcessed:duplicate.posterior.processedObservationIds}));
try{
 const result=await predictFireSpread({...input,weatherSnapshot:{...e.weather,issuedAt:'2026-01-02T00:00:00Z'}});
 console.log(JSON.stringify({check:'operational replay excludes future weather issue',accepted:true,issueTime:result.issuedAt,weatherIssue:'2026-01-02T00:00:00Z',warnings:result.warnings}));
}catch(error){console.log(JSON.stringify({check:'operational replay excludes future weather issue',accepted:false,error:String(error)}));}
