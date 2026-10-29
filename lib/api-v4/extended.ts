import crypto from "node:crypto";
import { assertPublicWebhookUrl } from "./webhooks.js";
import type { V3Request,V3Response,JsonRecord } from "../api-v3/types.js";
import { authorizeDeveloperKey } from "../api-v3/auth.js";
import { requestId,timestamp,queryValue } from "../api-v3/http.js";
import { withDevMetadata } from "../developer-contact.js";
const DB=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SERVICE=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
function respond(res:V3Response,status:number,data:unknown,id:string,meta:JsonRecord={}){res.setHeader("X-Request-Id",id);res.setHeader("X-API-Version","4");res.status(status).json(withDevMetadata({success:status<400,data:status<400?data:null,error:status>=400?data:null,meta:{apiVersion:"4",requestId:id,timestamp:timestamp(),...meta}}))}
function error(res:V3Response,status:number,code:string,message:string,id:string){respond(res,status,{code,message},id)}
async function db(path:string,init:RequestInit={}){if(!SERVICE)throw Object.assign(new Error("Storage unavailable"),{status:503});const r=await fetch(DB+path,{...init,signal:init.signal||AbortSignal.timeout(5000),headers:{apikey:SERVICE,authorization:"Bearer "+SERVICE,"content-type":"application/json",...(init.headers||{})}});const b=await r.json().catch(()=>null);if(!r.ok)throw Object.assign(new Error("Storage unavailable"),{status:r.status});return b}
const enc=(s:string)=>Buffer.from(s,"utf8").toString("base64url"); const dec=(s:string)=>{try{return Buffer.from(s,"base64url").toString("utf8")}catch{return ""}};
export async function handleV4Extended(req:V3Request,res:V3Response,path:string):Promise<void>{
 const id=requestId(),method=String(req.method||"GET").toUpperCase();
 for(const [k,v] of Object.entries({"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-API-Version":"4","Access-Control-Allow-Origin":"*"}))res.setHeader(k,v);
 const methods=path==="webhooks"?"GET, POST":path.startsWith("webhooks/")?"DELETE":path==="alliances"||path==="redemption-history"||path==="usage"?"GET":"";
 res.setHeader("Access-Control-Allow-Methods",methods+", OPTIONS");res.setHeader("Access-Control-Allow-Headers","Authorization, Content-Type, Idempotency-Key");
 if(method==="OPTIONS"){const r=res.status(204);if(r.end)r.end();else r.json({});return}
 if(!methods||!methods.split(", ").includes(method)){res.setHeader("Allow",methods?methods+", OPTIONS":"OPTIONS");error(res,methods?405:404,methods?"method_not_allowed":"route_not_found","V4 route or method not found.",id);return}
 const auth=await authorizeDeveloperKey(req,res,id);if(!auth)return;const keyId=String(auth.key_id||"");const q=(n:string)=>queryValue(req,n);
 const scopes=Array.isArray(auth.scopes)?auth.scopes.map(String):["players:read","alliances:read","redemptions:write","redemptions:read","webhooks:manage","usage:read"];
 const needed=path==="alliances"?"alliances:read":path==="redemption-history"?"redemptions:read":path==="usage"?"usage:read":"webhooks:manage";
 if(!scopes.includes(needed)){error(res,403,"insufficient_scope","This API key does not have the required scope: "+needed,id);return}
 try{
  if(path==="alliances"){
   const kid=q("kingdomId"),tag=q("tag"),limit=Math.max(1,Math.min(100,Number(q("limit")||50)));
   if(!/^\d{1,10}$/.test(kid)){error(res,400,"invalid_kingdom_id","kingdomId must contain 1–10 digits.",id);return}
   if(tag&&!/^[A-Za-z0-9_-]{1,20}$/.test(tag)){error(res,400,"invalid_alliance_tag","Invalid alliance tag.",id);return}
   const url=tag?"https://api.mightpulse.com/v1/alliances/"+encodeURIComponent(kid)+"/"+encodeURIComponent(tag)+"?include=info,roster":"https://api.mightpulse.com/v1/kingdoms/"+encodeURIComponent(kid)+"/ranks?board=alliance_power&limit=100";
   const upstream=await fetch(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(9000)});if(!upstream.ok){error(res,upstream.status===404?404:upstream.status===429?503:502,upstream.status===404?"alliance_not_found":"alliance_provider_unavailable","Alliance data is temporarily unavailable.",id);return}
   const body:any=await upstream.json(),source=body?.data&&typeof body.data==="object"?body.data:body,alliance=source.alliance??source;
   const raw:any[]=tag?(Array.isArray(source.members)?source.members:Array.isArray(source.roster)?source.roster:[]):(source.rankings??source.ranks??source.items??[]);
   const members=raw.map((m:any)=>({playerId:String(m.player_id??m.playerId??m.governor_id??m.id??""),name:String(m.nick_name??m.name??m.nickname??"").slice(0,80),power:Number.isFinite(Number(m.power))?Number(m.power):null,townCenterLevel:Number.isFinite(Number(m.town_center_level??m.townCenterLevel))?Number(m.town_center_level??m.townCenterLevel):null,rank:String(m.alliance_rank_label??m.alliance_rank??m.rank??"").slice(0,30)})).filter(m=>/^\d{5,20}$/.test(m.playerId));
   const fingerprint=crypto.createHash("sha256").update(JSON.stringify(members)).digest("hex"),cursor=q("cursor"),offset=Math.max(0,Math.min(10000,Number(q("offset")||0)));
   respond(res,200,{alliance:{name:String(alliance.name??alliance.alliance_name??tag??"").slice(0,80),tag:String(alliance.abbr??alliance.tag??tag??"").slice(0,20),kingdomId:kid,power:Number.isFinite(Number(alliance.power))?Number(alliance.power):null,memberCount:members.length},members:members.slice(offset,offset+limit),total:members.length,offset,limit,hasMore:offset+limit<members.length,nextCursor:offset+limit<members.length?String(offset+limit):null,changeCursor:fingerprint,changed:!cursor||cursor!==fingerprint,stale:body.fresh===false||Boolean(body.stale),fetchedAt:typeof body.cached_at==="string"?body.cached_at:null},id,{source:"mightpulse"});return
  }
  if(path==="redemption-history"){
   const player=q("playerId"),limit=Math.max(1,Math.min(100,Number(q("limit")||25))),offset=Math.max(0,Math.min(10000,Number(q("offset")||0)));
   if(!/^\d{5,20}$/.test(player)){error(res,400,"invalid_player_id","playerId must contain 5–20 digits.",id);return}
   const rows=await db("/rest/v1/kingshot_redemptions?select=player_id,gift_code,status,err_code,message,attempted_at&player_id=eq."+encodeURIComponent(player)+"&order=attempted_at.desc&limit="+limit+"&offset="+offset);
   respond(res,200,{playerId:player,items:Array.isArray(rows)?rows:[],limit,offset,hasMore:Array.isArray(rows)&&rows.length===limit},id);return
  }
  if(path==="usage"){
   const rows=await db("/rest/v1/rpc/kingshot_developer_get_usage",{method:"POST",body:JSON.stringify({p_key_id:keyId})});
   respond(res,200,rows,id);return
  }
  if(path==="webhooks"&&method==="GET"){
   const rows=await db("/rest/v1/kingshot_developer_webhooks?select=id,url,events,created_at,updated_at,disabled_at&key_id=eq."+encodeURIComponent(keyId)+"&order=created_at.desc");
   respond(res,200,{items:Array.isArray(rows)?rows:[]},id);return
  }
  if(path==="webhooks"&&method==="POST"){
   const b=req.body as Record<string,unknown>|undefined,url=String(b?.url||"").trim(),events=Array.isArray(b?.events)?b!.events.map(String):[];let u:URL;
   try{u=new URL(url)}catch{error(res,400,"invalid_webhook_url","Provide a valid HTTPS URL.",id);return}
   try{await assertPublicWebhookUrl(u.href)}catch{error(res,400,"invalid_webhook_url","Webhook URLs must resolve only to public IP addresses and use HTTPS without embedded credentials.",id);return}
   const allowed=new Set(["redemption.completed","redemption.unknown"]);if(!events.length||events.length>2||events.some(e=>!allowed.has(e))){error(res,400,"invalid_webhook_events","Supported events: redemption.completed, redemption.unknown.",id);return}
   const count=await db("/rest/v1/kingshot_developer_webhooks?select=id&key_id=eq."+encodeURIComponent(keyId));if(Array.isArray(count)&&count.length>=5){error(res,409,"webhook_limit_reached","Each key can have at most five subscriptions.",id);return}
   const encryption=process.env.V4_WEBHOOK_ENCRYPTION_KEY||"";if(!/^[0-9a-f]{64}$/i.test(encryption)){error(res,503,"webhook_encryption_unconfigured","Webhook encryption is not configured on this deployment.",id);return}
   const secret="whsec_"+crypto.randomBytes(32).toString("base64url"),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",Buffer.from(encryption,"hex"),iv),ct=Buffer.concat([cipher.update(secret,"utf8"),cipher.final()]),encrypted=[iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),ct.toString("base64url")].join(".");
   const created=await db("/rest/v1/kingshot_developer_webhooks",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({key_id:keyId,url:u.href,events,secret_hash:crypto.createHash("sha256").update(secret).digest("hex"),secret_ciphertext:encrypted})}),item=Array.isArray(created)?created[0]:created;
   respond(res,201,{id:item?.id,url:u.href,events,secret,warning:"Store this signing secret now. It will not be shown again."},id);return
  }
  if(path.startsWith("webhooks/")&&method==="DELETE"){
   const wid=path.slice(9);if(!/^[0-9a-f-]{36}$/i.test(wid)){error(res,400,"invalid_webhook_id","Invalid webhook ID.",id);return}
   const rows=await db("/rest/v1/kingshot_developer_webhooks?id=eq."+encodeURIComponent(wid)+"&key_id=eq."+encodeURIComponent(keyId),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({disabled_at:timestamp()})});
   respond(res,200,{revoked:Array.isArray(rows)&&rows.length>0},id);return
  }
 }catch(e){const s=Number((e as {status?:number})?.status)||503;console.error("[v4-extended]",{requestId:id,status:s});error(res,503,"feature_unavailable","The requested V4 feature is temporarily unavailable.",id)}
}
