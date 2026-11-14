import {useEffect,useMemo,useRef} from 'react';
import * as echarts from 'echarts/core';
import {LineChart} from 'echarts/charts';
import {GridComponent,TooltipComponent,MarkLineComponent,DataZoomComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
import type {Channel,Sensor,ValidatedObservation} from '@dryspell/contracts';
import {UNITS} from '@dryspell/contracts';
import styles from './workspace.module.css';

echarts.use([LineChart,GridComponent,TooltipComponent,MarkLineComponent,DataZoomComponent,CanvasRenderer]);
const channels:Channel[]=['temperatureC','humidityPct','smokePct'];
const labels:Record<Channel,string>={temperatureC:'Temperature',humidityPct:'Humidity',smokePct:'Smoke index'};
const colors=['#ff994d','#7fc6ed','#d2b8ef'];
interface Props{sensor:Sensor;readings:ValidatedObservation[];at:string;baseline?:number;timeZone?:string;loading?:boolean;historyError?:string;}

export default function TelemetryCharts({sensor,readings,at,baseline,timeZone='UTC',loading=false,historyError}:Props){
 const host=useRef<HTMLDivElement>(null),chart=useRef<echarts.ECharts|null>(null);
 const supported=useMemo(()=>channels.filter(c=>sensor.capabilities.includes(c)),[sensor.capabilities]);
 const sorted=useMemo(()=>{
   const cutoff=Date.parse(at),observations=new Map<string,ValidatedObservation>();
   for(const observation of readings){if(observation.sensorId===sensor.id&&Date.parse(observation.recordedAt)<=cutoff&&Date.parse(observation.receivedAt)<=cutoff)observations.set(observation.id,observation);}
   return [...observations.values()].sort((a,b)=>Date.parse(a.recordedAt)-Date.parse(b.recordedAt)).slice(-1200);
 },[readings,sensor.id,at]);
 const timeFormat=useMemo(()=>new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}),[timeZone]);
 const chartHeight=Math.max(142,supported.length*118+24);

 useEffect(()=>{
   if(!host.current)return;
   const instance=echarts.init(host.current,undefined,{renderer:'canvas'});chart.current=instance;
   const observer=new ResizeObserver(()=>instance.resize());observer.observe(host.current);
   return()=>{observer.disconnect();instance.dispose();chart.current=null;};
 },[]);

 useEffect(()=>{
   if(!chart.current)return;
   const cutoff=Date.parse(at),first=sorted.length?Date.parse(sorted[0].recordedAt):cutoff;
   // A single received point still needs a visible domain and symbol, not an empty chart.
   const from=first<cutoff?first:cutoff-60_000;
   chart.current.setOption({
     animation:false,useUTC:true,backgroundColor:'transparent',
     textStyle:{fontFamily:'IBM Plex Sans',color:'#c2d0c9'},
     tooltip:{trigger:'axis',axisPointer:{type:'line'},confine:true},
     axisPointer:{link:[{xAxisIndex:'all'}]},
     grid:supported.map((_,index)=>({left:44,right:22,top:index*118+24,height:76})),
     xAxis:supported.map((_,index)=>({
       type:'time',gridIndex:index,min:from,max:cutoff,splitNumber:3,minInterval:1000,
       axisLabel:{color:'#c2d0c9',show:index===supported.length-1,fontSize:11,hideOverlap:true,showMinLabel:true,showMaxLabel:true,margin:10,formatter:(value:number)=>timeFormat.format(new Date(value))},
       axisLine:{lineStyle:{color:'#60716a'}},axisTick:{show:false},splitLine:{show:false},
     })),
     yAxis:supported.map((channel,index)=>({
       type:'value',gridIndex:index,
       min:channel==='temperatureC'?(extent:{min:number})=>Math.floor(Math.min(extent.min,baseline??extent.min,70)/10)*10:0,
       max:channel==='temperatureC'?(extent:{max:number})=>Math.ceil(Math.max(extent.max,baseline??extent.max,70)/10)*10:100,
       name:UNITS[channel],nameGap:8,nameTextStyle:{color:colors[channels.indexOf(channel)],align:'left'},
       axisLabel:{color:'#c2d0c9',fontSize:11},splitNumber:3,splitLine:{lineStyle:{color:'#425750'}},
     })),
     series:supported.map((channel,index)=>({
       name:labels[channel],type:'line',xAxisIndex:index,yAxisIndex:index,
       showSymbol:sorted.length<=60,symbolSize:5,connectNulls:false,
       lineStyle:{color:colors[channels.indexOf(channel)],width:2},itemStyle:{color:colors[channels.indexOf(channel)]},
       data:sorted.flatMap((observation,position)=>{
         const value=observation.values[channel],point=[Date.parse(observation.recordedAt),value===undefined||!Number.isFinite(value)?null:value];
         const gap=position>0&&Date.parse(observation.recordedAt)-Date.parse(sorted[position-1].recordedAt)>sensor.expectedIntervalSec*3000;
         return gap?[[Date.parse(observation.recordedAt)-1,null],point]:[point];
       }),
       markLine:{silent:true,symbol:'none',label:{show:false},lineStyle:{width:1,type:'dashed'},data:[
         {xAxis:cutoff,lineStyle:{color:'#96e3e2'}},
         ...(channel==='temperatureC'?[{yAxis:70,lineStyle:{color:'#ff994d'}},...(baseline!==undefined?[{yAxis:baseline,lineStyle:{color:'#a8bcb1'}}]:[])]:[]),
       ]},
     })),
     dataZoom:[{type:'inside',xAxisIndex:supported.map((_,index)=>index),filterMode:'none',zoomOnMouseWheel:'ctrl'}],
   },true);
 },[supported,sorted,at,sensor.expectedIntervalSec,baseline,timeFormat]);

 return <section aria-label="Measurement history" data-testid="measurement-history" data-sample-count={sorted.length} data-cursor={at}>
   <div className={styles.sectionHeading}><h3>Observed response</h3><span>{timeZone} shared cursor</span></div>
   {loading&&sorted.length<2?<p role="status" className={styles.caption}>Loading earlier observations…</p>:!sorted.length&&!historyError?<p className={styles.muted}>No readings at this time. Run the scenario or select a later recorded time.</p>:null}
   {historyError&&<p role="status" className={styles.warning}>Earlier history is unavailable. Received observations remain visible. {historyError}</p>}
   <div ref={host} style={{height:chartHeight}} role="img" aria-label={`${supported.map(c=>labels[c]).join(', ')} history. Exact values are in the table below.`}/>
   <p className={styles.caption}>Gaps remain missing.{supported.includes('temperatureC')?' Temperature dashed lines: weather baseline and 70 °C critical alarm.':''}</p>
   <details><summary>Accessible reading table</summary><div className={styles.tableScroll}><table><thead><tr><th>Observed at ({timeZone})</th>{supported.map(c=><th key={c}>{labels[c]} ({UNITS[c]})</th>)}</tr></thead>
   <tbody>{sorted.slice(-50).map(observation=><tr key={observation.id} data-observation-id={observation.id} data-recorded-at={observation.recordedAt}><td>{timeFormat.format(new Date(observation.recordedAt))}</td>{supported.map(c=><td key={c}>{observation.values[c]===undefined?'No reading':observation.values[c]!.toFixed(2)}</td>)}</tr>)}</tbody></table></div></details>
 </section>;
}
