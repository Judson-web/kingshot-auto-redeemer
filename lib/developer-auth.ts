import crypto from "node:crypto";
import { rateLimit } from "./request-rate-limit.js";

type Req = { method?: string; headers: Record<string,string|string[]|undefined>; body?: Record<string,unknown> };
type Res = { status(n:number):Res; json(v:unknown):Res; setHeader(k:string,v:string):void };
const SUPABASE_URL = process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const AUTH_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || KEY;
const COOKIE = "__Host-ks_developer_session";
const sha = (v:string) => crypto.createHash("sha256").update(v).digest("hex");
const random = () => crypto.randomBytes(32).toString("hex");
const get = (req:Req,n:string) => { const v=req.headers[n.toLowerCase()]??req.headers[n]; return Array.isArray(v)?v[0]:v; };
function session(req:Req){const raw=String(get(req,"cookie")||"");const p=raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE+"="));if(!p)return "";try{return decodeURIComponent(p.slice(COOKIE.length+1))}catch{return ""}}
function setCookie(res:Res,v:string,age:number){res.setHeader("Set-Cookie",COOKIE+"="+encodeURIComponent(v)+"; Max-Age="+age+"; Path=/; HttpOnly; Secure; SameSite=Strict")}
function clearCookie(res:Res){res.setHeader("Set-Cookie",COOKIE+"=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict")}
async function rpc(name:string,body:Record<string,unknown>){if(!KEY)throw new Error("Auth service is not configured");const r=await fetch(SUPABASE_URL+"/rest/v1/rpc/"+name,{method:"POST",headers:{apikey:KEY,authorization:"Bearer "+KEY,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});const d:any=await r.json().catch(()=>null);if(!r.ok)throw new Error(d?.message||"Account service unavailable");return d}
async function authRequest(path:string,body:Record<string,unknown>){const r=await fetch(SUPABASE_URL+"/auth/v1/"+path,{method:"POST",headers:{apikey:AUTH_KEY||"", "content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});const d:any=await r.json().catch(()=>null);if(!r.ok){const e=new Error(d?.msg||d?.message||d?.error_description||"Authentication failed") as Error&{status?:number};e.status=r.status;throw e}return d}
export default async function handler(req:Req,res:Res){res.setHeader("Cache-Control","private, no-store");res.setHeader("X-Content-Type-Options","nosniff");if(!["GET","POST","DELETE"].includes(String(req.method))){res.status(405).json({error:"Method not allowed"});return}try{
 if(req.method==="GET"){const token=session(req);if(!token){res.status(200).json({authenticated:false});return}const user=await rpc("kingshot_developer_account_session_get",{p_token_hash:sha(token)});if(!user){clearCookie(res);res.status(200).json({authenticated:false});return}res.status(200).json({authenticated:true});return}
 if(req.method==="DELETE"){const token=session(req);if(token)await rpc("kingshot_developer_account_session_delete",{p_token_hash:sha(token)}).catch(()=>{});clearCookie(res);res.status(200).json({ok:true});return}
 if(!rateLimit(req,res,"developer-account-auth",8,900000)){res.status(429).json({error:"Too many attempts. Try again in 15 minutes."});return}
 const action=String(req.body?.action||"");const email=String(req.body?.email||"").trim().toLowerCase();const password=String(req.body?.password||"");
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<8||password.length>256){res.status(400).json({error:"Enter a valid email and a password of at least 8 characters."});return}
 if(action==="signup"){await authRequest("signup",{email,password});res.status(200).json({ok:true,verificationRequired:true,message:"Check your email for the verification link, then sign in."});return}
 if(action!=="login"){res.status(400).json({error:"Unknown action"});return}
 const auth=await authRequest("token?grant_type=password",{email,password});if(!auth?.user?.id||!auth?.user?.email_confirmed_at){res.status(403).json({error:"Verify your email address before signing in."});return}
 const token=random();const ok=await rpc("kingshot_developer_account_session_create",{p_token_hash:sha(token),p_user_id:auth.user.id});if(ok!==true){res.status(403).json({error:"Email verification is required before using the developer portal."});return}
 setCookie(res,token,43200);res.status(200).json({ok:true,email:auth.user.email});
 }catch(e){const err=e as Error&{status?:number};const status=err.status===400||err.status===422?400:err.status===429?429:err.status===403?403:500;res.status(status).json({error:status===500?"Developer account service is temporarily unavailable.":err.message})}}
