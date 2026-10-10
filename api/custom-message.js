import crypto from"node:crypto";
import {rateLimit}from"../lib/request-rate-limit.js";
const PASS=process.env.CUSTOM_MESSAGE_PASSKEY||"";
function parseConfiguredDestinations(){
 const entries=String(process.env.CUSTOM_MESSAGE_DESTINATIONS||"").split(",").map(x=>x.trim()).filter(Boolean).map(x=>{
  const [key,...name]=x.split(":");
  return [key.trim(),name.join(":").trim()||key.trim()];
 });
 const map=new Map(entries);
 // Fall back to any dedicated webhook env vars so the UI cannot silently lose
 // its server selector when CUSTOM_MESSAGE_DESTINATIONS is missing/stale.
 for(const key of Object.keys(process.env)){
  const m=key.match(/^CUSTOM_MESSAGE_WEBHOOK_([A-Za-z0-9_]+)_URL$/);
  if(m&&!map.has(m[1]))map.set(m[1],m[1]);
 }
 // The primary Kingshot webhook is also a valid custom-message destination.
 if(!map.has("1494360495694549134")&&(process.env.DISCORD_KINGSHOT_WEBHOOK_URL||process.env.DISCORD_SCRAPER_WEBHOOK_URL)){
  map.set("1494360495694549134","Kingshot");
 }
 return map;
}
const DESTINATIONS=parseConfiguredDestinations();
function webhookFor(key){
 const k=String(key||"").trim();
 if(!/^[A-Za-z0-9_-]{1,40}$/.test(k)||!DESTINATIONS.has(k))return"";
 if(k==="1494360495694549134")return process.env.DISCORD_KINGSHOT_WEBHOOK_URL||process.env.DISCORD_SCRAPER_WEBHOOK_URL||"";
 return process.env["CUSTOM_MESSAGE_WEBHOOK_"+k.toUpperCase()+"_URL"]||"";
}
const COOKIE="__Host-ks_message_session";
const TTL=12*60*60*1000;
function sign(value){return crypto.createHmac("sha256",PASS).update(value).digest("base64url")}
function token(){const exp=Date.now()+TTL,nonce=crypto.randomBytes(24).toString("base64url"),body=exp+"."+nonce;return body+"."+sign(body)}
function validSession(req){
 if(!PASS)return false;
 const raw=String(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE+"="));
 if(!raw)return false;
 const value=decodeURIComponent(raw.slice(COOKIE.length+1)),parts=value.split(".");
 if(parts.length!==3)return false;
 const [exp,nonce,sig]=parts,body=exp+"."+nonce;
 if(!/^\d+$/.test(exp)||Number(exp)<Date.now())return false;
 const expected=sign(body),a=Buffer.from(sig),b=Buffer.from(expected);
 return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function setCookie(res,value,maxAge=TTL){res.setHeader("Set-Cookie",COOKIE+"="+encodeURIComponent(value)+"; Max-Age="+Math.floor(maxAge/1000)+"; Path=/; HttpOnly; Secure; SameSite=Strict")}
function clearCookie(res){res.setHeader("Set-Cookie",COOKIE+"=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict")}
function clean(v,max){return String(v??"").trim().slice(0,max)}
function hexColor(v){const s=clean(v,20);return /^#?[0-9a-fA-F]{6}$/.test(s)?parseInt(s.replace("#",""),16):0x5865F2}
function imageUrl(v){const s=clean(v,2048);if(!s)return"";try{const u=new URL(s);return u.protocol==="https:"?u.toString():""}catch{return""}}
const ROLE_CACHE=new Map();
async function resolveRoleMentions(message,guildId){
 const token=process.env.DISCORD_BOT_TOKEN||"";
 if(!token||!/^[0-9]+$/.test(guildId))return message;
 let cached=ROLE_CACHE.get(guildId);
 if(!cached||cached.expires<Date.now()){
  try{
   const r=await fetch("https://discord.com/api/v10/guilds/"+guildId+"/roles",{headers:{Authorization:"Bot "+token},signal:AbortSignal.timeout(5000)});
   if(!r.ok)return message;
   const data=await r.json();
   cached={expires:Date.now()+60000,items:Array.isArray(data)?data.filter(x=>x&&x.id&&x.name):[]};
   ROLE_CACHE.set(guildId,cached);
  }catch{return message}
 }
 let out=message;
 for(const role of cached.items){
  const escaped=RegExp.escape(role.name).replace(/\s+/g,"\\s+");
  if(!escaped)continue;
  out=out.replace(new RegExp("@"+escaped,"gi"),"<@&"+role.id+">");
 }
 return out;
}
async function resolveDestinationNames(){
 const items=[...DESTINATIONS.entries()].map(([key,name])=>({key,name}));
 const token=process.env.DISCORD_BOT_TOKEN||"";
 if(!token)return items;
 await Promise.all(items.map(async item=>{
  if(!/^\d{17,20}$/.test(item.key))return;
  try{
   const r=await fetch("https://discord.com/api/v10/guilds/"+item.key,{headers:{Authorization:"Bot "+token},signal:AbortSignal.timeout(5000)});
   if(!r.ok)return;
   const data=await r.json();
   if(data?.name)item.name=data.name;
  }catch{}
 }));
 return items;
}
export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
 try{
  const body=req.body||{},action=String(body.action||"").toUpperCase();
  if(action==="LOGIN"){
   if(!rateLimit(req,res,"custom-message-login",5,15*60*1000))return res.status(429).json({error:"Too many attempts. Try again later."});
   if(!PASS)return res.status(503).json({error:"Custom message access is not configured."});
   const supplied=String(body.passkey||""),a=Buffer.from(supplied),b=Buffer.from(PASS);
   const ok=a.length===b.length&&crypto.timingSafeEqual(a,b);
   if(!ok)return res.status(401).json({error:"Invalid passkey."});
   setCookie(res,token());
   return res.status(200).json({ok:true,expiresIn:TTL});
  }
  if(action==="LOGOUT"){clearCookie(res);return res.status(200).json({ok:true})}
  if(action==="CHECK")return res.status(validSession(req)?200:401).json({ok:validSession(req)});
  if(action==="PUSH_STATUS"){
   if(!validSession(req))return res.status(401).json({error:"Unauthorized. Sign in to the private console first."});
   const {pushIsConfigured}=await import("../internal/push-notifications.js");
   if(!pushIsConfigured())return res.status(503).json({error:"Push notifications are not configured."});
   const base=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
   const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
   if(!key)return res.status(503).json({error:"Push storage is not configured."});
   const response=await fetch(base+"/rest/v1/kingshot_push_subscriptions?select=id&limit=1",{method:"HEAD",headers:{apikey:key,authorization:"Bearer "+key,Prefer:"count=exact"},signal:AbortSignal.timeout(10000)});
   if(!response.ok)return res.status(502).json({error:"Could not load push audience size ("+response.status+")."});
   const range=response.headers.get("content-range")||"";
   const match=range.match(/\/(\d+|\*)$/);
   return res.status(200).json({ok:true,subscribedDevices:match&&match[1]!=="*"?Number(match[1]):null,configured:true});
  }
  if(action==="PUSH_SEND"){
   if(!validSession(req))return res.status(401).json({error:"Unauthorized. Sign in to the private console first."});
   if(!rateLimit(req,res,"push-send",5,60*1000))return res.status(429).json({error:"Too many push notifications. Wait a minute before sending again."});
   const title=clean(body.title,100),message=clean(body.message,220),rawUrl=clean(body.url||"/",500);
   const rawImage=clean(body.imageUrl,2048),image=rawImage?imageUrl(rawImage):"";
   if(rawImage&&!image)return res.status(400).json({error:"Image URL must be a valid, publicly accessible HTTPS URL."});
   if(!title)return res.status(400).json({error:"A notification title is required."});
   if(!message)return res.status(400).json({error:"A notification message is required."});
   let url="/";try{const parsed=new URL(rawUrl,"https://ks-rewards.com");if(parsed.origin==="https://ks-rewards.com"&&parsed.pathname.startsWith("/")&&!parsed.pathname.startsWith("//"))url=parsed.pathname+parsed.search+parsed.hash;}catch{}
   try{const {broadcastPush}=await import("../internal/push-notifications.js");const result=await broadcastPush({title,body:message,url,image,tag:"developer-push-"+crypto.randomUUID()});return res.status(200).json({ok:true,...result})}
   catch(error){return res.status(502).json({error:error instanceof Error?error.message:"Could not send push notification."})}
  }
  if(action==="PUSH_PUBLIC_KEY"){const {getPushPublicKey,pushIsConfigured}=await import("../internal/push-notifications.js");if(!pushIsConfigured())return res.status(503).json({error:"Push notifications are not configured."});return res.status(200).json({publicKey:getPushPublicKey()})}
  if(action==="PUSH_SUBSCRIBE"||action==="PUSH_UNSUBSCRIBE"){
   if(!rateLimit(req,res,"push-subscriptions",12,60000))return;
   const {pushIsConfigured,savePushSubscription,removePushSubscription}=await import("../internal/push-notifications.js");
   if(!pushIsConfigured())return res.status(503).json({error:"Push notifications are not configured."});
   try{if(action==="PUSH_SUBSCRIBE")await savePushSubscription(body.subscription);else await removePushSubscription(body.subscription);return res.status(200).json({ok:true})}catch(error){return res.status(400).json({error:error instanceof Error?error.message:"Push subscription failed."})}
  }
  if(action==="DESTINATIONS"){
   if(!validSession(req))return res.status(401).json({error:"Unauthorized."});
   return res.status(200).json({destinations:await resolveDestinationNames()});
  }
  if(!validSession(req))return res.status(401).json({error:"Unauthorized."});

  if(action.startsWith("GIFT_CODE_")||action==="TRIGGER_KINGDOM_VALIDATION"||action==="WAKE_REDEEM_WORKERS"){
   const base=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
   const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
   if(!key)return res.status(503).json({error:"Gift-code administration is not configured."});
   const db=async(path,options={})=>{
    const response=await fetch(base+"/rest/v1/"+path,{...options,headers:{"apikey":key,"authorization":"Bearer "+key,"content-type":"application/json",...(options.headers||{})},signal:AbortSignal.timeout(12000)});
    const data=await response.json().catch(()=>null);
    if(!response.ok)throw Error(data?.message||"Database request failed ("+response.status+").");
    return data;
   };
   if(action==="GIFT_CODE_LIST"){
    const rows=await db("kingshot_gift_codes?select=id,code,active,admin_added,suppressed,expires_at,first_seen_at,last_seen_at,source_date,validation_status,validated_at,validation_player_id,validation_message&order=active.desc,code.asc");
    return res.status(200).json({codes:Array.isArray(rows)?rows:[]});
   }
   if(action==="GIFT_CODE_ADD"){
    if(!rateLimit(req,res,"gift-code-write",30,60*1000))return res.status(429).json({error:"Too many changes. Wait a minute."});
    const code=clean(body.code,64);
    if(body.confirmManual!==true)return res.status(400).json({error:"Confirm that this code was checked against a trusted Kingshot source before adding it."});
    if(!/^[A-Za-z0-9_-]{6,32}$/.test(code))return res.status(400).json({error:"Use 6–32 letters, numbers, underscores or hyphens."});
    if(/^(ACTIVE|EXPIRED|CONTINUE|COPYCODE|SIGNINTOREDEEM|SHARELINK|GIFTCODES|REDEEMGIFTCODE|GIFTCODE|LOADING|COMMUNITY|FEATURES|LATEST|CURRENT|POPULAR|PROFILE|PLAYER|KINGDOM|SERVER|MESSAGE|SETTINGS|HEIGHT|GUIDES|MASTERY|QUESTION|ANSWER|ACCOUNT|PENDING|SCREEN|CONTENT|SCHEMA|CHILDREN|REWARDS|VERIFIED|IMPORT|COMPLETE|UPGRADE|ARTICLE|BACKGROUND|BUTTONS|CLIPBOARD|STATIC|ASSETS)$/i.test(code))return res.status(400).json({error:"That text looks like page/UI text, not a gift code."});
    const expiryInput=body.expiresAt===null||body.expiresAt===""?null:String(body.expiresAt);const expiryDate=expiryInput?Date.parse(expiryInput):null;if(expiryInput&&(!Number.isFinite(expiryDate)||!/^\d{4}-\d{2}-\d{2}T/.test(expiryInput)))return res.status(400).json({error:"Expiry must be a valid date and time."});
    const existing=await db("kingshot_gift_codes?code=eq."+encodeURIComponent(code)+"&select=id,code");
    if(Array.isArray(existing)&&existing.length){
     const updated=await db("kingshot_gift_codes?code=eq."+encodeURIComponent(code),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({active:false,admin_added:true,suppressed:false,expires_at:expiryInput,last_seen_at:new Date().toISOString(),validation_status:"pending",validated_at:null,validation_player_id:null,validation_message:"Awaiting player verification"})});
     return res.status(200).json({ok:true,code:updated?.[0]||{code,active:true},restored:true});
    }
    const created=await db("kingshot_gift_codes",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({code,active:false,admin_added:true,suppressed:false,expires_at:expiryInput,validation_status:"pending",validation_message:"Awaiting player verification"})});
    return res.status(200).json({ok:true,code:created?.[0]||{code,active:true}});
   }
   if(action==="GIFT_CODE_UPDATE"||action==="GIFT_CODE_DELETE"){
    if(!rateLimit(req,res,"gift-code-write",30,60*1000))return res.status(429).json({error:"Too many changes. Wait a minute."});
    const code=clean(body.code,64);
    if(!/^[A-Za-z0-9_-]{4,64}$/.test(code))return res.status(400).json({error:"Invalid gift code."});
    const query="kingshot_gift_codes?code=eq."+encodeURIComponent(code);
    if(action==="GIFT_CODE_DELETE"){
     const rows=await db(query,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({active:false,suppressed:true})});
     return res.status(200).json({ok:true,removed:true,code:rows?.[0]||{code,active:false}});
    }
    const active=body.active===true;
    const expiresAt=body.expiresAt===null||body.expiresAt===""?null:String(body.expiresAt);
    if(expiresAt&&!Number.isFinite(Date.parse(expiresAt)))return res.status(400).json({error:"Expiry must be a valid date and time."});
    const currentRows=await db(query+"&select=id,code,suppressed");
    if(!Array.isArray(currentRows)||!currentRows.length)return res.status(404).json({error:"Gift code not found."});
    if(active&&currentRows[0].suppressed===true)return res.status(409).json({error:"This code is blocked. Use Add / reactivate and confirm the trusted source before unblocking it."});
    const patch={active:false,expires_at:expiresAt};if(active){patch.suppressed=false;patch.validation_status="pending";patch.validated_at=null;patch.validation_player_id=null;patch.validation_message="Awaiting player verification";}
    const rows=await db(query,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(patch)});
    if(!Array.isArray(rows)||!rows.length)return res.status(404).json({error:"Gift code not found."});
    return res.status(200).json({ok:true,code:rows[0]});
   }
   if(action==="TRIGGER_KINGDOM_VALIDATION"||action==="WAKE_REDEEM_WORKERS"){
    if(!rateLimit(req,res,"gift-code-trigger",3,5*60*1000))return res.status(429).json({error:"A manual run was triggered recently. Wait five minutes."});
    const cronSecret=process.env.CRON_SECRET;
    if(!cronSecret)return res.status(503).json({error:"Worker trigger is not configured (CRON_SECRET missing)."});
    const origin=String(req.headers.origin||"").match(/^https:\/\/(?:www\.)?ks-rewards\.com$/i)?String(req.headers.origin):"https://ks-rewards.com";
    const mode=action==="TRIGGER_KINGDOM_VALIDATION"?"kingdom-check":"worker";
    const url=mode==="worker"?origin+"/api/kingshot-auto":origin+"/api/kingshot-auto?mode=kingdom-check";
    if(mode==="worker"){
     // The coordinator owns the global lock and safely claims/releases worker slots.
     const response=await fetch(url,{method:"POST",headers:{authorization:"Bearer "+cronSecret,"content-type":"application/json"},body:"{}",signal:AbortSignal.timeout(240000)});
     const data=await response.json().catch(()=>({}));
     if(!response.ok)return res.status(502).json({error:data.error||"Worker run failed.",details:data});
     return res.status(200).json({ok:true,mode:"redeem",result:data});
    }
    const response=await fetch(url,{method:"POST",headers:{authorization:"Bearer "+cronSecret,"content-type":"application/json"},body:"{}",signal:AbortSignal.timeout(240000)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)return res.status(502).json({error:data.error||"Kingdom validation failed.",details:data});
    return res.status(200).json({ok:true,mode:"kingdom-check",result:data});
   }
   return res.status(400).json({error:"Invalid gift-code action."});
  }
  if(action!=="SEND")return res.status(400).json({error:"Invalid action."});
  const target=String(body.target||"").trim(),WEBHOOK=webhookFor(target);
  if(!WEBHOOK)return res.status(503).json({error:"That custom-message destination is not configured."});
  if(!rateLimit(req,res,"custom-message-send",10,60*1000))return res.status(429).json({error:"Too many messages. Please wait a moment."});
  const rawMessage=clean(body.message,4096);
  if(!rawMessage)return res.status(400).json({error:"Message is required."});
  const explicitMentions=Array.isArray(body.mentions)?body.mentions:[];
  const hasEveryone=/@everyone/.test(rawMessage)||explicitMentions.includes("everyone");
  const hasHere=/@here/.test(rawMessage)||explicitMentions.includes("here");
  const message=rawMessage;
  const title=clean(body.title,256),description=clean(message.replace(/@everyone|@here/g," ").replace(/\\s{2,}/g," ").trim(),4096),footer=clean(body.footer,2048),image=imageUrl(body.imageUrl);
  const embed={title,description,color:hexColor(body.color),timestamp:new Date().toISOString(),fields:[],footer:{text:footer||"Kingshot Auto Redeem"}};
  if(image)embed.image={url:image};
  if(!title)delete embed.title;
  if(!description)delete embed.description;
  const mentionTokens=[...(hasEveryone?["@everyone"]:[]),...(hasHere?["@here"]:[])];
  const content=[...new Set(mentionTokens)].join(" ");
  const payload={...(content?{content}:{}),allowed_mentions:{parse:[...(hasEveryone||hasHere?["everyone"]:[])]},embeds:[embed]};
  const wr=await fetch(WEBHOOK,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)});
  if(!wr.ok){
   const retryAfter=Number(wr.headers.get("retry-after")||"0"),detail=await wr.text().catch(()=>"");
   return res.status(502).json({error:"Discord rejected the message ("+wr.status+")."+(retryAfter?" Retry after "+Math.ceil(retryAfter)+"s.":"")+(detail?" "+detail.slice(0,180):"")});
  }
  try { await broadcastPush({title:title||"Message from the Kingshot team",body:description||"Open Kingshot Auto Redeemer to read the latest message.",url:"/",image,tag:"developer-message-"+crypto.randomUUID()}); } catch(error) { console.error("Developer push notification failed:",error instanceof Error?error.message:error); }
  return res.status(200).json({ok:true});
 }catch(e){return res.status(502).json({error:e?.message||"Custom message service unavailable."})}
}
