const directions=['N','NE','E','SE','S','SW','W','NW'];
export const normalizeBearing=(degrees:number)=>((degrees%360)+360)%360;
export const compass=(degrees:number)=>directions[Math.round(normalizeBearing(degrees)/45)%8];
export const windDirection=(from:number)=>({from:compass(from),to:compass(from+180),arrowDeg:normalizeBearing(from+180)});
