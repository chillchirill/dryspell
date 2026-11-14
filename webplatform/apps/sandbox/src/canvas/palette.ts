import type {LandscapeCell} from '@dryspell/contracts';
export const coverLegend=[['#4f7f45','Forest'],['#b8ba86','Shrubland'],['#d9cd8a','Grassland'],['#d8c59b','Cropland'],['#b6b8ba','Built-up'],['#6eaed6','Water'],['#dadada','Bare / sparse']] as const;
export const ecologicalLegend=[['#4f7f45','Forest'],['#a8b87b','Forest-steppe'],['#d9cd8a','Steppe'],['#d9cd8a','Other grasslands'],['#dadada','Other regions']] as const;
const codes:Record<number,string>={10:'#4f7f45',20:'#b8ba86',30:'#d9cd8a',40:'#d8c59b',50:'#b6b8ba',60:'#dadada',70:'#d7e2e4',80:'#6eaed6',90:'#629c91',95:'#397969',100:'#a6ad83'};
const covers:Record<string,string>={woodland:'#4f7f45',scrub:'#b8ba86',grass:'#d9cd8a',water:'#6eaed6',built:'#b6b8ba',unknown:'#dadada'};
export function terrainColor(cell:LandscapeCell&{sourceClassCode?:number}){return cell.sourceClassCode===undefined?covers[cell.cover]:codes[cell.sourceClassCode]??covers[cell.cover];}
export function terrainLabel(cell:LandscapeCell&{sourceClassCode?:number}){const names:Record<number,string>={10:'Forest',20:'Shrubland',30:'Grassland',40:'Cropland',50:'Built-up',60:'Bare / sparse',70:'Snow / ice',80:'Water',90:'Wetland',95:'Mangroves',100:'Moss / lichen'};return cell.sourceClassCode===undefined?cell.cover:names[cell.sourceClassCode]??cell.cover;}
