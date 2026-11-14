import {useState} from 'react';
import type {Channel,Sensor,SimulationFault} from '@dryspell/contracts';
import {en} from './locales/en';
import styles from './workspace.module.css';

export default function SensorFaultSettings({sensor,durationSec,saving,onSave}:{sensor:Sensor;durationSec:number;saving:boolean;onSave:(faults:SimulationFault[])=>Promise<boolean>}){
 const [faults,setFaults]=useState<SimulationFault[]>(sensor.simulationFaults||[]);
 const [type,setType]=useState<SimulationFault['type']>('dropout');
 const [error,setError]=useState('');
 return <details><summary>{en.fault.title}{faults.length?` (${faults.length})`:''}</summary><p className={styles.caption}>{en.fault.help}</p>
 {faults.length?<ol className={styles.faultList}>{faults.map((fault,index)=><li key={`${index}:${fault.type}`}><strong>{en.fault.labels[fault.type]}</strong><span>{fault.startTimeSec}–{fault.endTimeSec} s · {(fault.channels||sensor.capabilities).map(c=>en.readings[c]).join(', ')}</span>{fault.value!==undefined&&<small>Value: {fault.value}</small>}{fault.delaySec!==undefined&&<small>Delay: {fault.delaySec} s</small>}<button type="button" aria-label={`${en.fault.remove} ${index+1}`} disabled={saving} onClick={()=>setFaults(v=>v.filter((_,i)=>i!==index))}>{en.fault.remove}</button></li>)}</ol>:<p className={styles.caption}>{en.fault.empty}</p>}
 <form onSubmit={event=>{event.preventDefault();const d=new FormData(event.currentTarget),startTimeSec=Number(d.get('start')),endTimeSec=Number(d.get('end'));if(endTimeSec<=startTimeSec||endTimeSec>durationSec){setError(en.fault.invalidWindow);return;}const channels=d.getAll('channel') as Channel[];if(!channels.length){setError(en.fault.channelRequired);return;}const fault:SimulationFault={type,startTimeSec,endTimeSec,channels};if(type==='delay')fault.delaySec=Number(d.get('delay'));if(type==='stuck'||type==='spike'||type==='smoke-without-fire')fault.value=Number(d.get('value'));setFaults(v=>[...v,fault]);setError('');}}>
 <label>{en.fault.type}<select name="type" value={type} onChange={e=>setType(e.target.value as SimulationFault['type'])}>{Object.entries(en.fault.labels).filter(([id])=>id!=='smoke-without-fire'||sensor.capabilities.includes('smokePct')).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label>
 <div className={styles.rangeInputs}><label>{en.fault.start}<input name="start" type="number" min="0" max={durationSec} step="1" defaultValue={0} required/></label><label>{en.fault.end}<input name="end" type="number" min="1" max={durationSec} step="1" defaultValue={Math.min(60,durationSec)} required/></label></div>
 <fieldset className={styles.faultChannels}><legend>{en.fault.channels}</legend>{sensor.capabilities.filter(c=>type!=='smoke-without-fire'||c==='smokePct').map(c=><label className={styles.check} key={`${type}:${c}`}><input name="channel" type="checkbox" value={c} defaultChecked/>{en.readings[c]}</label>)}</fieldset>
 {(type==='stuck'||type==='spike'||type==='smoke-without-fire')&&<label>{en.fault.value}<input name="value" type="number" step="any" defaultValue={type==='smoke-without-fire'?60:20} required/></label>}
 {type==='delay'&&<label>{en.fault.delay}<input name="delay" type="number" min="1" max="3600" defaultValue={30} required/></label>}
 {error&&<p role="alert" className={styles.warning}>{error}</p>}<button type="submit" disabled={saving||faults.length>=20}>{en.fault.add}</button>
 </form><button className={styles.primary} disabled={saving} onClick={()=>void onSave(faults)}>{saving?en.loading:en.fault.save}</button></details>;
}
