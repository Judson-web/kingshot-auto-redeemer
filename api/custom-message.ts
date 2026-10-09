import crypto from"node:crypto";
import {rateLimit}from"../lib/request-rate-limit.ts";
const PASS=process.env.CUSTOM_MESSAGE_PASSKEY||"";
function parseConfiguredDestinations(){
 const entries=String(process.env.CUSTOM_MESSAGE_DESTINATIONS||"").split(",").map(x=>x.trim()).filter(Boolean).map(x=>{
  const [key,...name]=x.split(":");
  return [key.trim(),name.join(":").trim()||key.trim()];
 });
 const map=new Map<string,string>(entries as Array<[string,string]>);
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
 let value;
 try{value=decodeURIComponent(raw.slice(COOKIE.length+1))}catch{return false}
 const parts=value.split(".");
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
const ROLE_CACHE=new Map<string,{expires:number;items:Array<{id:string;name:string}>}>();
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
  const escaped=String(role.name).replace(/[.*+?^${}()|[\]\\]/g,match=>"\\"+match).replace(/\s+/g,"\\s+");
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
  if(action==="DESTINATIONS"){
   if(!validSession(req))return res.status(401).json({error:"Unauthorized."});
   return res.status(200).json({destinations:await resolveDestinationNames()});
  }
  if(!validSession(req))return res.status(401).json({error:"Unauthorized."});
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
  const embed:Record<string,unknown>={title,description,color:hexColor(body.color),timestamp:new Date().toISOString(),fields:[],footer:{text:footer||"Kingshot Auto Redeem"}};
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
  return res.status(200).json({ok:true});
 }catch(e){return res.status(502).json({error:e?.message||"Custom message service unavailable."})}
}
