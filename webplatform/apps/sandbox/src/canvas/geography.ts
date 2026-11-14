import type {Bounds,Coordinate,LandscapeSnapshot} from '@dryspell/contracts';
export const span=(b:Bounds)=>b.east>=b.west?b.east-b.west:b.east+360-b.west;
export function cellAt(l:LandscapeSnapshot,p:Coordinate){const x=Math.floor((((p.longitude-l.bounds.west)%360+360)%360)/span(l.bounds)*l.width),y=Math.floor((p.latitude-l.bounds.south)/(l.bounds.north-l.bounds.south)*l.height);return x<0||x>=l.width||y<0||y>=l.height?-1:y*l.width+x;}
export function polygon(l:LandscapeSnapshot,i:number){const dx=span(l.bounds)/l.width,dy=(l.bounds.north-l.bounds.south)/l.height,x=l.bounds.west+(i%l.width)*dx,y=l.bounds.south+Math.floor(i/l.width)*dy;return [[[x,y],[x+dx,y],[x+dx,y+dy],[x,y+dy],[x,y]]];}
export function center(l:LandscapeSnapshot):Coordinate{return {longitude:((l.bounds.west+span(l.bounds)/2+180)%360)-180,latitude:(l.bounds.south+l.bounds.north)/2};}
