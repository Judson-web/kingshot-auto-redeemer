import crypto from"node:crypto";
import {rateLimit}from"../lib/request-rate-limit.js";

const PASS=process.env.CUSTOM_MESSAGE_PASSKEY||"";
const COOKIE="__Host-ks_message_session";
const TTL=12*60*60*1000;
const ROLE_CACHE=new Map();

function parseConfiguredDestinations(){
 const entries=String(process.env.CUSTOM_MESSAGE_DESTINATIONS||"").split(",").map(x=>x.trim()).filter(Boolean).map(x=>{
  const [key,...name]=x.split(":");
  return [key.trim(),name.join(":").trim()||key.trim()];
 });
 const map=new Map(entries);
 for(const key of Object.keys(process.env)){
  const m=key.match(/^CUSTOM_MESSAGE_WEBHOOK_([A-Za-z0-9_]+)_URL$/);
  if(m&&!map.has(m[1]))map.set(m[1],m[1]);
 }
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
function sign(value){return crypto.createHmac("sha256",PASS).update(value).digest("base64url")}
function token(){const exp=Date.now()+TTL,nonce=crypto.randomBytes(24).toString("base64url"),body=exp+"."+nonce;return body+"."+sign(body)}
function validSession(req){
 if(!PASS)return false;
 const raw=String(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE+"="));
 if(!raw)return false;
 const value=decodeURIComponent(raw.slice(COOKIE.length+1)),parts=value.split(".");
 if(parts.length!==3)return false;
 const [exp,,sig]=parts,body=exp+"."+parts[1];
 if(!/^\d+$/.test(exp)||Number(exp)<Date.now())return false;
 const expected=sign(body),a=Buffer.from(sig),b=Buffer.from(expected);
 return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function setCookie(res,value,maxAge=TTL){res.setHeader("Set-Cookie",COOKIE+"="+encodeURIComponent(value)+"; Max-Age="+Math.floor(maxAge/1000)+"; Path=/; HttpOnly; Secure; SameSite=Strict")}
function clearCookie(res){res.setHeader("Set-Cookie",COOKIE+"=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict")}
function clean(v,max){return String(v??"").trim().slice(0,max)}
function hexColor(v){const s=clean(v,20);return /^#?[0-9a-fA-F]{6}$/.test(s)?parseInt(s.replace("#",""),16):0x5865F2}
function imageUrl(v){const s=clean(v,2048);if(!s)return"";try{const u=new URL(s);return u.protocol==="https:"?u.toString():""}catch{return""}}
function escapeRegExp(value){return String(value).replace(/[.*+?^$()|[\\]\\\\]/g,"\\\\$&")}

async function resolveGuildId(target){
 const webhook=webhookFor(target);
 if(!webhook)return"";
 try{
  const r=await fetch(webhook,{signal:AbortSignal.timeout(5000)});
  if(!r.ok)return"";
  const data=await r.json();
  return /^\d{17,20}$/.test(String(data?.guild_id||""))?String(data.guild_id):"";
 }catch{return""}
}

async function fetchGuildRoles(guildId){
 const token=process.env.DISCORD_BOT_TOKEN||"";
 if(!token)return {roles:[],error:"DISCORD_BOT_TOKEN is not configured."};
 if(!/^\d{17,20}$/.test(String(guildId)))return {roles:[],error:"Discord guild could not be resolved."};
 try{
  const r=await fetch("https://discord.com/api/v10/guilds/"+guildId+"/roles",{headers:{Authorization:"Bot "+token},signal:AbortSignal.timeout(8000)});
  const data=await r.json().catch(()=>null);
  if(!r.ok)return {roles:[],error:"Discord roles request failed ("+r.status+")."};
  return {roles:Array.isArray(data)?data.filter(x=>x&&/^\d{17,20}$/.test(String(x.id))&&typeof x.name==="string").map(x=>({id:String(x.id),name:x.name,managed:Boolean(x.managed)})).sort((a,b)=>a.name.localeCompare(b.name)):[],error:""};
 }catch(e){return {roles:[],error:"Discord roles request timed out or failed."}}
}
async function getGuildRoles(guildId){
 const key=String(guildId||"");
 const cached=ROLE_CACHE.get(key);
 if(cached&&cached.expires>Date.now())return cached.items;
 const items=await fetchGuildRoles(key);
 ROLE_CACHE.set(key,{expires:Date.now()+60000,items});
 return items;
}
async function resolveRoleMentions(message,guildId){
 const roles=await getGuildRoles(guildId);
 let out=message;
 const roleIds=[];
 for(const role of roles){
  const escaped=escapeRegExp(role.name).replace(/\s+/g,"\\s+");
  if(!escaped)continue;
  const pattern=new RegExp("(^|\\s)@"+escaped+"(?=\\s|$|[.,!?;:])","giu");
  if(pattern.test(out)){
   out=out.replace(pattern,(match,prefix)=>prefix+"<@&"+role.id+">");
   if(!roleIds.includes(role.id))roleIds.push(role.id);
  }
 }
 return {message:out,roleIds};
}
async function resolveDestinationNames(){
 const items=[...DESTINATIONS.entries()].map(([key,name])=>({key,name}));
 const token=process.env.DISCORD_BOT_TOKEN||"";
 if(!token)return items;
 await Promise.all(items.map(async item=>{
  if(!/^\d{17,20}$/.test(item.key))return;
  try{
   const r=await fetch("https://discord.com/api/v10/guilds/"+item.key,{headers:{Authorization:"Bot "+token},signal:AbortSignal.timeout(5000)});
   if(r.ok){const data=await r.json();if(data?.name)item.name=data.name}
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
  if(action==="CHECK"){const ok=validSession(req);return res.status(ok?200:401).json({ok})}
  if(!validSession(req))return res.status(401).json({error:"Unauthorized."});
  if(action==="DESTINATIONS")return res.status(200).json({destinations:await resolveDestinationNames()});
  if(action==="ROLES"){
   const target=String(body.target||"").trim();
   if(!DESTINATIONS.has(target))return res.status(400).json({error:"Unknown Discord destination."});
   const guildId=await resolveGuildId(target);
   if(!guildId)return res.status(502).json({error:"Could not resolve the Discord server for this webhook."});
   const result=await fetchGuildRoles(guildId);
   if(result.error)return res.status(502).json({error:result.error});
   ROLE_CACHE.set(guildId,{expires:Date.now()+60000,items:result.roles});
   return res.status(200).json({roles:result.roles,guildId});
  }
  if(action!=="SEND")return res.status(400).json({error:"Invalid action."});

  const target=String(body.target||"").trim(),WEBHOOK=webhookFor(target);
  if(!WEBHOOK)return res.status(503).json({error:"That custom-message destination is not configured."});
  if(!rateLimit(req,res,"custom-message-send",10,60*1000))return res.status(429).json({error:"Too many messages. Please wait a moment."});

  const rawMessage=clean(body.message,4096);
  if(!rawMessage)return res.status(400).json({error:"Message is required."});

  const guildId=await resolveGuildId(target);
  const resolved=await resolveRoleMentions(rawMessage,guildId);
  const title=clean(body.title,256);
  const description=clean(resolved.message.replace(/@everyone|@here|<@&\d{17,20}>|<@!?\d{17,20}>/g," ").replace(/\s{2,}/g," ").trim(),4096);
  const footer=clean(body.footer,2048);
  const image=imageUrl(body.imageUrl);
  const embed={title,description,color:hexColor(body.color),timestamp:new Date().toISOString(),footer:{text:footer||"Kingshot Auto Redeem"}};
  if(image)embed.image={url:image};
  if(!title)delete embed.title;
  if(!description)delete embed.description;

  const explicitMentions=Array.isArray(body.mentions)?body.mentions:[];
  const roleMentions=[...resolved.message.matchAll(/<@&(\d{17,20})>/g)].map(m=>m[1]);
  roleMentions.push(...explicitMentions.filter(x=>x&&x.type==="role"&&/^\d{17,20}$/.test(String(x.id))).map(x=>String(x.id)));
  const userMentions=[...resolved.message.matchAll(/<@!?([0-9]{17,20})>/g)].map(m=>m[1]);
  const hasEveryone=/@everyone/.test(resolved.message)||explicitMentions.some(x=>x&&x.type==="everyone");
  const hasHere=/@here/.test(resolved.message)||explicitMentions.some(x=>x&&x.type==="here");
  const mentionContent=[...new Set([
   ...roleMentions.map(id=>"<@&"+id+">"),
   ...userMentions.map(id=>"<@"+id+">"),
   ...(hasEveryone?["@everyone"]:[]),
   ...(hasHere?["@here"]:[])
  ])].join(" ");

  const allowedMentions={parse:[]};
  if(hasEveryone)allowedMentions.parse.push("everyone");
  if(roleMentions.length)allowedMentions.roles=[...new Set(roleMentions)];
  if(userMentions.length)allowedMentions.users=[...new Set(userMentions)];

  const payload={
   username:"Kingshot Auto Redeem",
   ...(mentionContent?{content:mentionContent}:{}),
   allowed_mentions:allowedMentions,
   embeds:[embed]
  };
  const wr=await fetch(WEBHOOK,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)});
  if(!wr.ok){
   const retryAfter=Number(wr.headers.get("retry-after")||"0"),detail=await wr.text().catch(()=>"");
   return res.status(502).json({error:"Discord rejected the message ("+wr.status+")."+(retryAfter?" Retry after "+Math.ceil(retryAfter)+"s.":"")+(detail?" "+detail.slice(0,180):"")});
  }
  return res.status(200).json({ok:true});
 }catch(e){return res.status(502).json({error:e?.message||"Custom message service unavailable."})}
}
