import crypto from"node:crypto";
import {rateLimit} from"../lib/request-rate-limit.js";
const SUPABASE_URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const COOKIE="__Host-ks_admin_session";
// Admin auth v2: normalize copied keys server-side before hashing.
function hash(value){const normalized=String(value??"").normalize("NFKC").replace(/\s+/g,"");return crypto.createHash("sha256").update(normalized,"utf8").digest("hex")}
function token(){return crypto.randomBytes(32).toString("hex")}
function getCookie(req){const raw=String(req.headers.cookie||"");const part=raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE+"="));return part?decodeURIComponent(part.slice(COOKIE.length+1)):""}
function setCookie(res,value,maxAge){const v=encodeURIComponent(value);res.setHeader("Set-Cookie",COOKIE+"="+v+"; Max-Age="+maxAge+"; Path=/; HttpOnly; Secure; SameSite=Strict")}
function clearCookie(res){res.setHeader("Set-Cookie",[COOKIE+"=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict","ks_admin_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax"])}
async function rpc(name,body){if(!SUPABASE_KEY)throw Error("Admin service is not configured.");const r=await fetch(SUPABASE_URL+"/rest/v1/rpc/"+name,{method:"POST",headers:{"apikey":SUPABASE_KEY,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.message||"Admin service unavailable.");return d}
export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 res.setHeader("Allow","GET, DELETE");
 return res.status(410).json({error:"Passkey administration is retired. Sign in with the authorized Discord account at /dev."});
}
