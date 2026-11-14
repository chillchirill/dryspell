import type {Bounds,Coordinate,LandscapeSnapshot} from '@dryspell/contracts';
/** Continuous display longitudes preserve adjacency at the antimeridian. */
export function longitudeSpan(bounds:Bounds){return bounds.east>=bounds.west?bounds.east-bounds.west:bounds.east+360-bounds.west;}
export function longitudeOffset(longitude:number,west:number){return ((longitude-west)%360+360)%360;}
export function indexAt(landscape:LandscapeSnapshot,point:Coordinate){const b=landscape.bounds,span=longitudeSpan(b);if(span<=0||b.north<=b.south)return -1;const x=Math.floor(longitudeOffset(point.longitude,b.west)/span*landscape.width),y=Math.floor((point.latitude-b.south)/(b.north-b.south)*landscape.height);return x>=0&&x<landscape.width&&y>=0&&y<landscape.height?y*landscape.width+x:-1;}
export function cellPolygon(landscape:LandscapeSnapshot,index:number){const b=landscape.bounds,x=index%landscape.width,y=Math.floor(index/landscape.width),dx=longitudeSpan(b)/landscape.width,dy=(b.north-b.south)/landscape.height,w=b.west+x*dx,s=b.south+y*dy;return [[w,s],[w+dx,s],[w+dx,s+dy],[w,s+dy],[w,s]];}
export function displayBounds(bounds:Bounds):[[number,number],[number,number]]{return [[bounds.west,bounds.south],[bounds.west+longitudeSpan(bounds),bounds.north]];}
