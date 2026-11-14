import {describe,it,expect} from 'vitest';
import {createSampleEnvironment} from '@dryspell/data-sources';
import {newScenario} from './domain';

const environment=createSampleEnvironment();
function point(index:number){const g=environment.landscape;return{longitude:g.bounds.west+(index%g.width+.5)/g.width*(g.bounds.east-g.bounds.west),latitude:g.bounds.south+(Math.floor(index/g.width)+.5)/g.height*(g.bounds.north-g.bounds.south)};}

describe('scenario creation validates and preserves supplied inputs',()=>{
 it('retains supplied ignition, capabilities and configuration at initial revision',()=>{
  const location=point(environment.landscape.cells.findIndex(c=>c.burnable));
  const scenario=newScenario(environment,{name:'Created inputs',seed:0,config:{durationSec:600},ignitions:[{id:'fire',location,timeSec:0}],sensors:[{name:'Temperature',profileId:'temperature',location}]});
  expect(scenario).toMatchObject({name:'Created inputs',seed:0,revision:1,status:'draft',authoritativeTimeSec:0,config:{durationSec:600,outputIntervalSec:5}});
  expect(scenario.ignitions).toHaveLength(1);
  expect(scenario.sensors[0]).toMatchObject({source:'simulated',profileId:'temperature',capabilities:['temperatureC']});
 });
 it('rejects water ignition and invalid creation fields with the edit rules',()=>{
  const location=point(environment.landscape.cells.findIndex(c=>c.cover==='water'));
  expect(()=>newScenario(environment,{ignitions:[{id:'water',location,timeSec:0}]})).toThrow(/cannot be ignited/);
  expect(()=>newScenario(environment,{name:''})).toThrow();
  expect(()=>newScenario(environment,{config:{outputIntervalSec:30}})).toThrow();
  expect(()=>newScenario(environment,{config:{timeZone:'Not/AZone'}})).toThrow(/time zone/);
  expect(()=>newScenario(environment,{unknownInput:true})).toThrow();
 });
});
