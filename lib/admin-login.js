import crypto from"node:crypto";
import {rateLimit} from"../lib/request-rate-limit.js";
const SUPABASE_URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const COOKIE="__Host-ks_admin_session";
// Keep the current normalized hash and a legacy-compatible trimmed-only hash.
// This lets keys provisioned before normalization changes continue to authenticate.
function hash(value){return crypto.createHash("sha256").update(String(value??"").normalize("NFKC").replace(/\\s+/g,""),"utf8").digest("hex")}
function legacyHash(value){return crypto.createHash("sha256").update(String(value??"").trim(),"utf8").digest("hex")}
function token(){return crypto.randomBytes(32).toString("hex")}
function getCookie(req){const raw=String(req.headers.cookie||"");const part=raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE+"="));return part?decodeURIComponent(part.slice(COOKIE.length+1)):""}
function setCookie(res,value,maxAge){const v=encodeURIComponent(value);res.setHeader("Set-Cookie",COOKIE+"="+v+"; Max-Age="+maxAge+"; Path=/; HttpOnly; Secure; SameSite=Strict")}
function clearCookie(res){res.setHeader("Set-Cookie",[COOKIE+"=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict","ks_admin_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax"])}
async function rpc(name,body){if(!SUPABASE_KEY)throw Error("Admin service is not configured.");const r=await fetch(SUPABASE_URL+"/rest/v1/rpc/"+name,{method:"POST",headers:{"apikey":SUPABASE_KEY,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.message||"Admin service unavailable.");return d}
export default async function handler(req,res){
 res.setHeader("Cache-Control","private, no-store");
 if(!["POST","DELETE"].includes(req.method))return res.status(405).json({error:"Method not allowed"});
 try{
  if(req.method==="DELETE"){const session=getCookie(req);if(session)await rpc("kingshot_admin_logout",{p_token_hash:hash(session)}).catch(()=>{});clearCookie(res);return res.status(200).json({ok:true})}
  if(!rateLimit(req,res,"admin-login",5,900000))return res.status(429).json({error:"Too many login attempts. Please try again later."});
  const body=req.body||{},accessKey=String(body.accessKey||"").trim();
  if(!accessKey)return res.status(400).json({error:"Admin access key is required."});
  const session=token(),tokenHash=hash(session);
  let ok=await rpc("kingshot_admin_create_session_with_key",{p_key_hash:hash(accessKey),p_token_hash:tokenHash});
  // Compatibility fallback only checks the same entered key using the previous hash
  // convention; no new key is created and the fallback never bypasses DB validation.
  if(!ok){const oldHash=legacyHash(accessKey);if(oldHash!==hash(accessKey))ok=await rpc("kingshot_admin_create_session_with_key",{p_key_hash:oldHash,p_token_hash:tokenHash})}
  if(!ok)return res.status(401).json({error:"Invalid admin access key."});
  setCookie(res,session,43200);
  return res.status(200).json({ok:true});
 }catch(e){return res.status(502).json({error:e.message||"Admin authentication failed."})}
}
