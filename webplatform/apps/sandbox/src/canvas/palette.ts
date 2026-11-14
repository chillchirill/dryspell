import type {LandscapeCell} from '@dryspell/contracts';
export const coverLegend=[['#4c8258','Forest'],['#9daf63','Shrubland'],['#bdd180','Grassland'],['#c6aa66','Cropland'],['#8b949b','Built-up'],['#4f91b5','Water'],['#b4b6a2','Bare / sparse']] as const;
export const ecologicalLegend=[['#4c8258','Forest'],['#9daf63','Forest-steppe'],['#d6b76e','Steppe'],['#bdd180','Other grasslands'],['#b4b6a2','Other regions']] as const;
const codes:Record<number,string>={10:'#4c8258',20:'#9daf63',30:'#bdd180',40:'#c6aa66',50:'#8b949b',60:'#b4b6a2',70:'#d7e2e4',80:'#4f91b5',90:'#629c91',95:'#397969',100:'#a6ad83'};
const covers:Record<string,string>={woodland:'#4c8258',scrub:'#9daf63',grass:'#bdd180',water:'#4f91b5',built:'#8b949b',unknown:'#60686d'};
export function terrainColor(cell:LandscapeCell&{sourceClassCode?:number}){return cell.sourceClassCode===undefined?covers[cell.cover]:codes[cell.sourceClassCode]??covers[cell.cover];}
export function terrainLabel(cell:LandscapeCell&{sourceClassCode?:number}){const names:Record<number,string>={10:'Forest',20:'Shrubland',30:'Grassland',40:'Cropland',50:'Built-up',60:'Bare / sparse',70:'Snow / ice',80:'Water',90:'Wetland',95:'Mangroves',100:'Moss / lichen'};return cell.sourceClassCode===undefined?cell.cover:names[cell.sourceClassCode]??cell.cover;}
