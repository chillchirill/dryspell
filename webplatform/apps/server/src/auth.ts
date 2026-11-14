import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import type {Request,Response,NextFunction} from 'express';
import {pool} from './db.ts';
import {HttpError,assert} from './errors.ts';
export const hash=(token:string)=>createHash('sha256').update(token).digest('hex');
export interface AuthRequest extends Request{session?:{username:string;csrf:string;tokenHash:string};}
const require=createRequire(import.meta.url);
let adminCache:{username:string;passwordHash:string;passwordSalt:string}|undefined;
function admin(){if(!adminCache){try{adminCache=require(path.resolve(process.env.ADMIN_CONFIG_PATH||'config/admin.config.cjs'));}catch{throw new HttpError(503,'ADMIN_NOT_CONFIGURED','Administrator configuration is unavailable.');}}return adminCache!;}
function cookie(req:Request){return req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('dryspell_session='))?.slice('dryspell_session='.length);}
export async function sessionMiddleware(req:AuthRequest,_res:Response,next:NextFunction){try{const token=cookie(req);if(token&&token.length<256){const result=await pool.query('SELECT username,csrf FROM sessions WHERE token_hash=$1 AND expires_at>now()',[hash(token)]);if(result.rows[0])req.session={...result.rows[0],tokenHash:hash(token)};}next();}catch(e){next(e);}}
export function sameOrigin(req:Request){const origin=req.headers.origin;if(origin){let host:string;try{host=new URL(origin).host;}catch{throw new HttpError(403,'ORIGIN','Invalid origin.');}assert(host===req.headers.host,403,'ORIGIN','Cross-origin mutation rejected.');}assert(req.headers['sec-fetch-site']!=='cross-site',403,'ORIGIN','Cross-site mutation rejected.');}
export function requireAdmin(req:AuthRequest,_res:Response,next:NextFunction){try{assert(req.session,401,'AUTH_REQUIRED','Administrator login is required.');sameOrigin(req);assert(req.headers['x-csrf-token']===req.session.csrf,403,'CSRF','Session token is missing or expired.');next();}catch(e){next(e);}}
const attempts=new Map<string,{count:number;until:number}>();
export async function login(req:AuthRequest,res:Response){sameOrigin(req);const key=req.ip||'unknown';const now=Date.now();if(attempts.size>10000)for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);const state=attempts.get(key);assert(!state||state.until<now||state.count<10,429,'LOGIN_THROTTLED','Too many login attempts. Retry after 15 minutes.');attempts.set(key,{count:state&&state.until>now?state.count+1:1,until:now+900000});const cfg=admin();const password=typeof req.body?.password==='string'?req.body.password:'';assert(password.length<=1024,400,'INVALID_PASSWORD','Password is too long.');const candidate=scryptSync(password,cfg.passwordSalt,64);const expected=Buffer.from(cfg.passwordHash,'hex');assert(req.body?.username===cfg.username&&candidate.length===expected.length&&timingSafeEqual(candidate,expected),401,'LOGIN_FAILED','Invalid username or password.');attempts.delete(key);const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');await pool.query('INSERT INTO sessions(token_hash,username,csrf,expires_at) VALUES($1,$2,$3,now()+interval \'12 hours\')',[hash(token),cfg.username,csrf]);res.cookie('dryspell_session',token,{httpOnly:true,sameSite:'strict',secure:process.env.SESSION_SECURE==='true',maxAge:43200000,path:'/'});res.json({authenticated:true,username:cfg.username,csrfToken:csrf});}
export async function logout(req:AuthRequest,res:Response){if(req.session)await pool.query('DELETE FROM sessions WHERE token_hash=$1',[req.session.tokenHash]);res.clearCookie('dryspell_session',{path:'/'});res.json({authenticated:false});}

