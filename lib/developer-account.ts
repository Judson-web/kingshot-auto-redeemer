import crypto from "node:crypto";
import { assertPublicWebhookUrl } from "./api-v4/webhooks.js";
import { rateLimit } from "./request-rate-limit.js";
type Req={method?:string;url?:string;headers:Record<string,string|string[]|undefined>;body?:Record<string,unknown>};
type Res={status(n:number):Res;json(v:unknown):Res;setHeader(k:string,v:string):void};
const SUPABASE_URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const COOKIE="__Host-ks_developer_session";
const PROFILE_COOKIE="__Host-ks_profile_session";
const sha=(v:string)=>crypto.createHash("sha256").update(v).digest("hex");
const get=(req:Req,n:string)=>{const v=req.headers[n.toLowerCase()]??req.headers[n];return Array.isArray(v)?v[0]:v};
function sessionTokens(req:Req){const raw=String(get(req,"cookie")||"");const read=(name:string)=>{const p=raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="));if(!p)return "";try{return decodeURIComponent(p.slice(name.length+1))}catch{return ""}};return [...new Set([read(PROFILE_COOKIE),read(COOKIE)].filter(Boolean))]}
function ip(req:Req){const raw=String(get(req,"x-vercel-forwarded-for")||"").split(",")[0].trim();return raw.length>0&&raw.length<=64?raw:"unknown"}
async function db(path:string,init:RequestInit={}){if(!KEY)throw new Error("Developer API is not configured");const r=await fetch(SUPABASE_URL+path,{...init,signal:init.signal||AbortSignal.timeout(8000),headers:{apikey:KEY,authorization:"Bearer "+KEY,"content-type":"application/json",...(init.headers||{})}});const d:any=await r.json().catch(()=>null);if(!r.ok){const e=new Error(d?.message||"Developer webhook request failed") as Error&{status?:number};e.status=r.status;throw e}return d}
async function rpc(name:string,body:Record<string,unknown>){if(!KEY)throw new Error("Developer API is not configured");const r=await fetch(SUPABASE_URL+"/rest/v1/rpc/"+name,{method:"POST",headers:{apikey:KEY,authorization:"Bearer "+KEY,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});const d:any=await r.json().catch(()=>null);if(!r.ok){const e=new Error(d?.message||"Developer account request failed") as Error&{status?:number};e.status=r.status;throw e}return d}
export default async function handler(req:Req,res:Res){res.setHeader("Cache-Control","private, no-store");res.setHeader("X-Content-Type-Options","nosniff");if(!["GET","POST","PATCH","DELETE"].includes(String(req.method))){res.status(405).json({error:"Method not allowed"});return}
 const sessionCandidates=sessionTokens(req);if(!sessionCandidates.length){res.status(401).json({error:"Sign in with Discord to manage your API keys."});return}
 try{let s="";let userId:unknown=null;for(const candidate of sessionCandidates){const candidateUserId=await rpc("kingshot_developer_account_session_get",{p_token_hash:sha(candidate)});if(typeof candidateUserId==="string"&&candidateUserId){s=candidate;userId=candidateUserId;break}}if(!s||typeof userId!=="string"){res.status(401).json({error:"Your session is invalid. Sign in again."});return}const p_session_hash=sha(s);const authResponse=await fetch(SUPABASE_URL+"/auth/v1/admin/users/"+encodeURIComponent(userId),{headers:{apikey:KEY||"",authorization:"Bearer "+KEY},signal:AbortSignal.timeout(8000)});const authUser:any=await authResponse.json().catch(()=>null);const providers=Array.isArray(authUser?.app_metadata?.providers)?authUser.app_metadata.providers:[];const identities=Array.isArray(authUser?.identities)?authUser.identities:[];if(!authResponse.ok||!(providers.includes("discord")||identities.some((identity:any)=>identity?.provider==="discord"))){res.status(401).json({error:"This session is not linked to Discord. Sign in again to manage API keys."});return}
 if(action==="webhooks"){
  if(!rateLimit(req,res,"developer-webhook-management",30,60000))return;
  const keyId=String(req.body?.key_id||urlObj.searchParams.get("key_id")||"");
  if(!/^[0-9a-f-]{36}$/i.test(keyId)){res.status(400).json({error:"Choose a valid API key."});return}
  const keys:any[]=await rpc("kingshot_developer_account_list_keys",{p_session_hash});
  const owned=Array.isArray(keys)?keys.find(k=>k.id===keyId):null;
  if(!owned||owned.revoked_at||(owned.expires_at&&Date.parse(owned.expires_at)<=Date.now())){res.status(404).json({error:"Active API key not found."});return}
  if(!Array.isArray(owned.scopes)||!owned.scopes.includes("webhooks:manage")){res.status(403).json({error:"Enable the Standard access scope and save it before managing webhooks."});return}
  if(req.method==="GET"){
   const rows=await db("/rest/v1/kingshot_developer_webhooks?select=id,url,events,created_at,updated_at,disabled_at&key_id=eq."+encodeURIComponent(keyId)+"&order=created_at.desc");
   res.status(200).json({items:Array.isArray(rows)?rows:[]});return
  }
  if(req.method==="POST"){
   const url=String(req.body?.url||"").trim(),events=Array.isArray(req.body?.events)?(req.body?.events as unknown[]).map(String):[];
   try{const parsed=new URL(url);if(parsed.href!==url&&parsed.toString()!==url){}await assertPublicWebhookUrl(parsed.href)}catch{res.status(400).json({error:"Use a valid HTTPS webhook URL that resolves only to public IP addresses."});return}
   const allowed=new Set(["redemption.completed","redemption.unknown"]);
   if(!events.length||events.length>2||events.some(e=>!allowed.has(e))){res.status(400).json({error:"Choose at least one supported event."});return}
   const rows=await db("/rest/v1/kingshot_developer_webhooks?select=id&key_id=eq."+encodeURIComponent(keyId)+"&disabled_at=is.null");
   if(Array.isArray(rows)&&rows.length>=5){res.status(409).json({error:"This API key already has five active webhook subscriptions."});return}
   const encryption=process.env.V4_WEBHOOK_ENCRYPTION_KEY||"";
   if(!/^[0-9a-f]{64}$/i.test(encryption)){res.status(503).json({error:"Webhook encryption is not configured on this deployment."});return}
   const secret="whsec_"+crypto.randomBytes(32).toString("base64url"),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",Buffer.from(encryption,"hex"),iv),ct=Buffer.concat([cipher.update(secret,"utf8"),cipher.final()]),encrypted=[iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),ct.toString("base64url")].join(".");
   const created=await db("/rest/v1/kingshot_developer_webhooks",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({key_id:keyId,url:new URL(url).href,events,secret_hash:crypto.createHash("sha256").update(secret).digest("hex"),secret_ciphertext:encrypted})});
   const item=Array.isArray(created)?created[0]:created;res.status(201).json({item:{id:item?.id,url,events,created_at:item?.created_at,disabled_at:null},secret,warning:"Store this signing secret now. It will not be shown again."});return
  }
  if(req.method==="DELETE"){
   const id=String(req.body?.id||urlObj.searchParams.get("id")||"");
   if(!/^[0-9a-f-]{36}$/i.test(id)){res.status(400).json({error:"Invalid webhook ID."});return}
   const rows=await db("/rest/v1/kingshot_developer_webhooks?id=eq."+encodeURIComponent(id)+"&key_id=eq."+encodeURIComponent(keyId),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({disabled_at:new Date().toISOString()})});
   if(!Array.isArray(rows)||!rows.length){res.status(404).json({error:"Webhook subscription not found."});return}
   res.status(200).json({ok:true});return
  }
  res.status(405).json({error:"Method not allowed"});return
 }
 if(req.method==="GET"){if(!rateLimit(req,res,"developer-key-list",60,60000))return;const keys=await rpc("kingshot_developer_account_list_keys",{p_session_hash});res.status(200).json({keys});return}
 if(req.method==="POST"){if(!rateLimit(req,res,"developer-key-create",4,3600000))return;const rawLabel=typeof req.body?.label==="string"?req.body.label:"Developer key";if(rawLabel.length>80){res.status(400).json({error:"Key labels must be 80 characters or fewer."});return}const label=rawLabel.trim()||"Developer key";const secret="ks_live_"+crypto.randomBytes(32).toString("hex");const result=await rpc("kingshot_developer_account_create_key",{p_session_hash,p_ip_hash:sha(ip(req)),p_key_hash:sha(secret),p_key_prefix:secret.slice(0,16),p_label:label});res.status(201).json({key:secret,metadata:result});return}
 if(req.method==="PATCH"){if(!rateLimit(req,res,"developer-key-settings",20,60000))return;const id=new URL(req.url||"/","https://local.invalid").searchParams.get("id")||"";if(!/^[0-9a-f-]{36}$/i.test(id)){res.status(400).json({error:"Invalid key ID"});return}const rawScopes=req.body?.scopes;const scopes=Array.isArray(rawScopes)?rawScopes.map(String):[];let expiry:string|null=null;try{expiry=typeof req.body?.expires_at==="string"&&req.body.expires_at?new Date(req.body.expires_at).toISOString():null}catch{res.status(400).json({error:"Invalid expiry date"});return}if(scopes.length<1||scopes.length>6){res.status(400).json({error:"Choose at least one API scope."});return}const ok=await rpc("kingshot_developer_account_update_key_settings",{p_session_hash,p_key_id:id,p_scopes:scopes,p_expires_at:expiry});res.status(ok?200:404).json({ok:!!ok});return}
 if(!rateLimit(req,res,"developer-key-revoke",20,60000))return;const id=new URL(req.url||"/","https://local.invalid").searchParams.get("id")||"";if(!/^[0-9a-f-]{36}$/i.test(id)){res.status(400).json({error:"Invalid key ID"});return}const ok=await rpc("kingshot_developer_account_revoke_key",{p_session_hash,p_key_id:id});res.status(ok?200:404).json({ok:!!ok});return
 }catch(e){const err=e as Error&{status?:number};const m=err.message||"";const status=err.status===401||err.status===403||/unauthorized/i.test(m)?401:/lifetime limit|limit of three active/i.test(m)?429:500;res.status(status).json({error:status===500?"Could not complete API-key operation.":m})}}
