import { isDiscordOwner } from "../lib/discord-identity.js";
import crypto from"node:crypto";
import {rateLimit}from"../lib/request-rate-limit.js";
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
const DEVELOPER_COOKIE="__Host-ks_developer_session";
const SUPABASE_URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const OWNER_DISCORD_ID="871756466900598815";
const hashToken=value=>crypto.createHash("sha256").update(String(value||"")).digest("hex");
function cookieValue(req,name){
 const item=String(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="));
 if(!item)return "";
 try{return decodeURIComponent(item.slice(name.length+1))}catch{return ""}
}
async function validSession(req){
 // Reuse the same verified Discord developer-account session as /developer.
 // Only the configured owner Discord identity can access this private console.
 const raw=cookieValue(req,DEVELOPER_COOKIE);
 if(!raw||raw.length>256||!SUPABASE_KEY)return false;
 try{
  const tokenHash=hashToken(raw);
  const sessionResponse=await fetch(SUPABASE_URL+"/rest/v1/rpc/kingshot_developer_account_session_get",{
   method:"POST",headers:{apikey:SUPABASE_KEY,authorization:"Bearer "+SUPABASE_KEY,"content-type":"application/json"},
   body:JSON.stringify({p_token_hash:tokenHash}),signal:AbortSignal.timeout(5000)
  });
  if(!sessionResponse.ok)return false;
  const userId=await sessionResponse.json();
  if(typeof userId!=="string"||!userId)return false;
  const userResponse=await fetch(SUPABASE_URL+"/auth/v1/admin/users/"+encodeURIComponent(userId),{
   headers:{apikey:SUPABASE_KEY,authorization:"Bearer "+SUPABASE_KEY},signal:AbortSignal.timeout(5000)
  });
  if(!userResponse.ok)return false;
  const user=await userResponse.json();
  return isDiscordOwner(user,OWNER_DISCORD_ID);
 }catch{return false}
}
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
  const escaped=RegExp.escape(role.name).replace(/\s+/g,"\s+");
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
  if(!rateLimit(req,res,"custom-message-post",60,60000))return res.status(429).json({error:"Too many requests. Retry shortly."});
 try{
  const body=req.body||{},action=String(body.action||"").toUpperCase();
  if(action==="LOGIN")return res.status(410).json({error:"Separate console login has been retired. Use the existing verified Discord developer session."});
  if(action==="LOGOUT")return res.status(200).json({ok:true,redirect:"/profile"});
  if(action==="CHECK"){const valid=await validSession(req);return res.status(valid?200:401).json({ok:valid})}
  if(action==="PUSH_STATUS"){
   if(!(await validSession(req)))return res.status(401).json({error:"Unauthorized. Open your account profile and verify your Discord session."});
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
   if(!(await validSession(req)))return res.status(401).json({error:"Unauthorized. Sign in to the private console first."});
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
   if(!(await validSession(req)))return res.status(401).json({error:"Unauthorized."});
   return res.status(200).json({destinations:await resolveDestinationNames()});
  }
  if(action!=="SCHEDULE_RUN"&&!(await validSession(req)))return res.status(401).json({error:"Unauthorized."});

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
    if(expiryDate!==null&&expiryDate<=Date.now())return res.status(400).json({error:"A manually approved code cannot have an expiry in the past."});
    const approvedAt=new Date().toISOString();
    const approvedFields={active:true,admin_added:true,suppressed:false,expires_at:expiryInput,last_seen_at:approvedAt,validation_status:"verified",validated_at:approvedAt,validation_player_id:null,validation_message:"Manual approval: trusted-source confirmation accepted; canary verification skipped."};
    const existing=await db("kingshot_gift_codes?code=eq."+encodeURIComponent(code)+"&select=id,code");
    if(Array.isArray(existing)&&existing.length){
     const updated=await db("kingshot_gift_codes?code=eq."+encodeURIComponent(code),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(approvedFields)});
     return res.status(200).json({ok:true,code:updated?.[0]||{code,active:true,validation_status:"verified"},restored:true,manuallyApproved:true,verificationSkipped:true});
    }
    const created=await db("kingshot_gift_codes",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({code,first_seen_at:approvedAt,...approvedFields})});
    return res.status(200).json({ok:true,code:created?.[0]||{code,active:true,validation_status:"verified"},manuallyApproved:true,verificationSkipped:true});
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
    const patch={active:false,suppressed:true,expires_at:expiresAt};if(active){patch.active=false;patch.suppressed=false;patch.validation_status="pending";patch.validated_at=null;patch.validation_player_id=null;patch.validation_message="Awaiting player verification";}
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
  const adminBase=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
  const adminKey=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  const adminDb=async(path,options={})=>{
   if(!adminKey)throw Error("Announcement storage is not configured.");
   const response=await fetch(adminBase+"/rest/v1/"+path,{...options,headers:{apikey:adminKey,authorization:"Bearer "+adminKey,"content-type":"application/json",Prefer:"return=representation",...(options.headers||{})},signal:AbortSignal.timeout(12000)});
   const data=await response.json().catch(()=>null);
   if(!response.ok)throw Error(data?.message||"Announcement database request failed ("+response.status+").");
   return data;
  };
  if(action==="ANNOUNCEMENT_ATTACHMENT_UPLOAD"){
   const encoded=String(body.fileBase64||"");
   const mime=clean(body.mimeType,80).toLowerCase();
   const allowed=new Set(["image/png","image/jpeg","image/webp","image/gif"]);
   if(!allowed.has(mime))return res.status(400).json({error:"Use a PNG, JPEG, WebP, or GIF image."});
   if(!encoded||encoded.length>4_200_000)return res.status(413).json({error:"Image attachments must be 3 MB or smaller."});
   const bytes=Buffer.from(encoded,"base64");
   if(!bytes.length||bytes.length>3*1024*1024)return res.status(413).json({error:"Image attachments must be 3 MB or smaller."});
   const ext=({"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif"})[mime];
   const objectPath=OWNER_DISCORD_ID+"/"+crypto.randomUUID()+"."+ext;
   const upload=await fetch(adminBase+"/storage/v1/object/announcement-attachments/"+objectPath,{method:"POST",headers:{apikey:adminKey,authorization:"Bearer "+adminKey,"content-type":mime,"x-upsert":"false"},body:bytes,signal:AbortSignal.timeout(15000)});
   if(!upload.ok)return res.status(502).json({error:"Could not store the announcement attachment."});
   const signed=await fetch(adminBase+"/storage/v1/object/sign/announcement-attachments/"+objectPath,{method:"POST",headers:{apikey:adminKey,authorization:"Bearer "+adminKey,"content-type":"application/json"},body:JSON.stringify({expiresIn:31536000}),signal:AbortSignal.timeout(10000)});
   const signedData=await signed.json().catch(()=>({}));
   if(!signed.ok||!signedData.signedURL)return res.status(502).json({error:"Attachment stored, but a delivery URL could not be created."});
   const baseUrl=adminBase.replace(/\/$/,"");
   return res.status(200).json({ok:true,objectPath,imageUrl:signedData.signedURL.startsWith("http")?signedData.signedURL:baseUrl+"/storage/v1"+signedData.signedURL});
  }
  if(action==="ANNOUNCEMENT_ROLES"){
   const guildId=clean(body.guildId,25);
   if(!/^\d{17,20}$/.test(guildId))return res.status(400).json({error:"Choose a valid Discord server."});
   const token=process.env.DISCORD_BOT_TOKEN||"";
   if(!token)return res.status(503).json({error:"Discord bot is not configured."});
   const response=await fetch("https://discord.com/api/v10/guilds/"+guildId+"/roles",{headers:{Authorization:"Bot "+token},signal:AbortSignal.timeout(8000)});
   if(!response.ok)return res.status(502).json({error:"Could not load roles for that Discord server."});
   const roles=await response.json();
   return res.status(200).json({roles:Array.isArray(roles)?roles.filter(x=>x&&x.id&&x.name&&!x.managed).map(x=>({id:x.id,name:x.name})):[]});
  }
  if(action==="SCHEDULE_CREATE"){
   if(!rateLimit(req,res,"announcement-schedule",10,60000))return res.status(429).json({error:"Too many scheduled announcements."});
   const title=clean(body.title,256),message=clean(body.message,4096),target=clean(body.target,40);
   const deliveryMode=["discord","website","both"].includes(body.deliveryMode)?body.deliveryMode:"both";
   const startsAt=Date.parse(body.startsAt||"");
   const intervalSeconds=body.intervalSeconds===null||body.intervalSeconds===""?null:Number(body.intervalSeconds);
   const endsAt=body.endsAt?new Date(body.endsAt).toISOString():null;
   const timezone=clean(body.timezone||"UTC",64);
   const roleIds=Array.isArray(body.roleIds)?[...new Set(body.roleIds.map(x=>String(x)).filter(x=>/^\d{17,20}$/.test(x)))].slice(0,25):[];
   if(!message||!Number.isFinite(startsAt)||startsAt<Date.now()-60000)return res.status(400).json({error:"Enter a message and a future start time."});
   if(intervalSeconds!==null&&(!Number.isInteger(intervalSeconds)||intervalSeconds<60||intervalSeconds>31536000))return res.status(400).json({error:"Repeat interval must be between one minute and one year."});
   if(endsAt&&Date.parse(endsAt)<=startsAt)return res.status(400).json({error:"The end time must be after the start time."});
   let guildId=null,channelId=null;
   if(deliveryMode!=="website"){
    if(!webhookFor(target))return res.status(400).json({error:"Choose a configured Discord destination."});
    const destination=await resolveDestinationNames();
    if(!destination.some(x=>x.key===target))return res.status(400).json({error:"Unknown Discord destination."});
    guildId=/^\d{17,20}$/.test(target)?target:null;
    channelId=clean(body.channelId,25)||null;
    if(roleIds.length){
     if(!guildId)return res.status(400).json({error:"Role mentions require a Discord server destination."});
     const token=process.env.DISCORD_BOT_TOKEN||"";
     const rr=await fetch("https://discord.com/api/v10/guilds/"+guildId+"/roles",{headers:{Authorization:"Bot "+token},signal:AbortSignal.timeout(8000)});
     if(!rr.ok)return res.status(400).json({error:"Could not validate selected server roles."});
     const available=new Set((await rr.json()).map(x=>String(x.id)));
     if(roleIds.some(id=>!available.has(id)))return res.status(400).json({error:"A selected role does not belong to the destination server."});
    }
   }
   const rows=await adminDb("discord_scheduled_announcements",{method:"POST",body:JSON.stringify({target,delivery_mode:deliveryMode,title,message,footer:clean(body.footer,2048),color:/^#[0-9a-fA-F]{6}$/.test(body.color||"")?body.color:"#5865F2",image_url:imageUrl(body.imageUrl)||null,attachment_path:clean(body.attachmentPath,300)||null,guild_id:guildId,channel_id:channelId,role_ids:roleIds,starts_at:new Date(startsAt).toISOString(),ends_at:endsAt,interval_seconds:intervalSeconds,timezone,next_run_at:new Date(startsAt).toISOString(),created_by:OWNER_DISCORD_ID})});
   return res.status(200).json({ok:true,announcement:rows?.[0]||null});
  }
  if(action==="SCHEDULE_LIST"){
   const rows=await adminDb("discord_scheduled_announcements?select=id,title,delivery_mode,starts_at,ends_at,interval_seconds,timezone,next_run_at,status,last_error&order=next_run_at.asc&limit=50");
   return res.status(200).json({announcements:rows||[]});
  }
  if(action==="SCHEDULE_UPDATE"){
   const id=clean(body.id,40),status=body.status==="paused"?"paused":body.status==="scheduled"?"scheduled":"cancelled";
   if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({error:"Invalid announcement ID."});
   const rows=await adminDb("discord_scheduled_announcements?id=eq."+encodeURIComponent(id)+"&status=in.(scheduled,paused)",{method:"PATCH",body:JSON.stringify({status,lease_token:null,lease_until:null,updated_at:new Date().toISOString()})});
   return res.status(200).json({ok:true,updated:Array.isArray(rows)&&rows.length>0});
  }
  if(action==="SCHEDULE_RUN"){
   const secret=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
   if(!process.env.CRON_SECRET||secret!==process.env.CRON_SECRET)return res.status(401).json({error:"Unauthorized worker request."});
   const claimed=await adminDb("rpc/claim_due_discord_announcements",{method:"POST",body:JSON.stringify({p_limit:10})});
   let sent=0,failed=0;
   for(const item of Array.isArray(claimed)?claimed:[]){
    try{
     let currentImage=item.image_url||"";
     if(item.delivery_mode!=="website"){
      const webhook=webhookFor(item.target);
      if(!webhook)throw Error("Discord destination is no longer configured.");
      const roleIds=Array.isArray(item.role_ids)?item.role_ids.filter(x=>/^\d{17,20}$/.test(String(x))):[];
      const mentions=roleIds.map(id=>"<@&"+id+">").join(" ");
      const content=[mentions,item.message].filter(Boolean).join("\n");
      const embed={title:item.title||undefined,description:item.message,color:hexColor(item.color),timestamp:new Date().toISOString(),footer:{text:item.footer||"Kingshot Auto Redeem"}};
      if(item.attachment_path){const signed=await fetch(adminBase+"/storage/v1/object/sign/announcement-attachments/"+item.attachment_path,{method:"POST",headers:{apikey:adminKey,authorization:"Bearer "+adminKey,"content-type":"application/json"},body:JSON.stringify({expiresIn:3600}),signal:AbortSignal.timeout(8000)});const signedData=await signed.json().catch(()=>({}));if(!signed.ok||!signedData.signedURL)throw Error("Could not access the scheduled image attachment.");currentImage=signedData.signedURL.startsWith("http")?signedData.signedURL:adminBase+"/storage/v1"+signedData.signedURL;}
      if(currentImage)embed.image={url:currentImage};
      const response=await fetch(webhook,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content,embeds:[embed],allowed_mentions:{parse:[],roles:roleIds}}),signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw Error("Discord delivery failed ("+response.status+").");
     }
     if(item.delivery_mode!=="discord"){
      const {broadcastPush}=await import("../internal/push-notifications.js");
      await broadcastPush({title:item.title||"Message from the Kingshot team",body:item.message.slice(0,220),url:"/",image:currentImage,tag:"scheduled-announcement-"+item.id+"-"+Date.now()});
     }
     const next=item.interval_seconds?new Date(Date.now()+Number(item.interval_seconds)*1000).toISOString():null;
     await adminDb("discord_scheduled_announcements?id=eq."+item.id+"&lease_token=eq."+item.lease_token,{method:"PATCH",body:JSON.stringify({last_run_at:new Date().toISOString(),next_run_at:next,status:next?"scheduled":"completed",lease_token:null,lease_until:null,last_error:null,updated_at:new Date().toISOString()})});
     sent++;
    }catch(error){
     const retry=new Date(Date.now()+Math.min(3600,60*Math.pow(2,Math.min(5,Number(item.attempts)||1)))*1000).toISOString();
     await adminDb("discord_scheduled_announcements?id=eq."+item.id+"&lease_token=eq."+item.lease_token,{method:"PATCH",body:JSON.stringify({next_run_at:retry,lease_token:null,lease_until:null,last_error:clean(error?.message,500),status:Number(item.attempts)>=5?"failed":"scheduled",updated_at:new Date().toISOString()})}).catch(()=>{});
     failed++;
    }
   }
   return res.status(200).json({ok:true,claimed:Array.isArray(claimed)?claimed.length:0,sent,failed});
  }
  if(action!=="SEND")return res.status(400).json({error:"Invalid action."});
  const deliveryMode=body.deliveryMode==="discord"?"discord":"both";
  const target=String(body.target||"").trim(),WEBHOOK=webhookFor(target);
  if(!WEBHOOK)return res.status(503).json({error:"That custom-message destination is not configured."});
  if(!rateLimit(req,res,"custom-message-send",10,60*1000))return res.status(429).json({error:"Too many messages. Please wait a moment."});
  const rawMessage=clean(body.message,4096);
  if(!rawMessage)return res.status(400).json({error:"Message is required."});
  const explicitMentions=Array.isArray(body.mentions)?body.mentions:[];
  const hasEveryone=/@everyone/.test(rawMessage)||explicitMentions.includes("everyone");
  const hasHere=/@here/.test(rawMessage)||explicitMentions.includes("here");
  const message=rawMessage;
  const title=clean(body.title,256),description=clean(message.replace(/@everyone|@here/g," ").replace(/\s{2,}/g," ").trim(),4096),footer=clean(body.footer,2048),image=imageUrl(body.imageUrl);
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
  if(deliveryMode==="both"){
   try { await broadcastPush({title:title||"Message from the Kingshot team",body:description||"Open Kingshot Auto Redeemer to read the latest message.",url:"/",image,tag:"developer-message-"+crypto.randomUUID()}); } catch(error) { console.error("Developer push notification failed:",error instanceof Error?error.message:error); }
  }
  return res.status(200).json({ok:true});
 }catch(e){return res.status(502).json({error:e?.message||"Custom message service unavailable."})}
}
