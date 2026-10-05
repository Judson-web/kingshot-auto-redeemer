import crypto from"node:crypto";
import {rateLimit}from"../lib/request-rate-limit.js";
const PASS=process.env.CUSTOM_MESSAGE_PASSKEY||"";
// Custom-message destinations are isolated from the worker/log webhook.
const DESTINATIONS=Object.fromEntries(String(process.env.CUSTOM_MESSAGE_DESTINATIONS||"").split(",").map(x=>x.trim()).filter(Boolean).map(x=>{const [key,...name]=x.split(":");return [key.trim(),name.join(":").trim()||key.trim()]}));
function webhookFor(key){const k=String(key||"").trim();if(!/^[A-Za-z0-9_-]{1,40}$/.test(k)||!DESTINATIONS[k])return "";if(k==="1494360495694549134")return process.env.DISCORD_KINGSHOT_WEBHOOK_URL||process.env.DISCORD_SCRAPER_WEBHOOK_URL||"";return process.env["CUSTOM_MESSAGE_WEBHOOK_"+k.toUpperCase()+"_URL"]||""}
const COOKIE="__Host-ks_message_session";
const TTL=12*60*60*1000;
function b64(v){return Buffer.from(v).toString("base64url")}
function unb64(v){return Buffer.from(v,"base64url").toString("utf8")}
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
 const expected=sign(body);
 const a=Buffer.from(sig),b=Buffer.from(expected);
 return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function setCookie(res,value,maxAge=TTL){res.setHeader("Set-Cookie",COOKIE+"="+encodeURIComponent(value)+"; Max-Age="+Math.floor(maxAge/1000)+"; Path=/; HttpOnly; Secure; SameSite=Strict")}
function clearCookie(res){res.setHeader("Set-Cookie",COOKIE+"=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict")}
function clean(v,max){return String(v??"").trim().slice(0,max)}
function hexColor(v){const s=clean(v,20);return /^#?[0-9a-fA-F]{6}$/.test(s)?parseInt(s.replace("#",""),16):0x5865F2}
function imageUrl(v){const s=clean(v,2048);if(!s)return "";try{const u=new URL(s);return u.protocol==="https:"?u.toString():""}catch{return ""}}
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
export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
 try{
  const body=req.body||{},action=String(body.action||"").toUpperCase();
  if(action==="LOGIN"){
   if(!rateLimit(req,res,"custom-message-login",5,15*60*1000))return res.status(429).json({error:"Too many attempts. Try again later."});
   if(!PASS)return res.status(503).json({error:"Custom message access is not configured."});
   const supplied=String(body.passkey||"");
   const a=Buffer.from(supplied),b=Buffer.from(PASS);
   const ok=a.length===b.length&&crypto.timingSafeEqual(a,b);
   if(!ok)return res.status(401).json({error:"Invalid passkey."});
   setCookie(res,token());
   return res.status(200).json({ok:true,expiresIn:TTL});
  }
  if(action==="LOGOUT"){clearCookie(res);return res.status(200).json({ok:true})}
  if(action==="CHECK")return res.status(validSession(req)?200:401).json({ok:validSession(req)});
  if(action==="DESTINATIONS"){if(!validSession(req))return res.status(401).json({error:"Unauthorized."});return res.status(200).json({destinations:Object.entries(DESTINATIONS).map(([key,name])=>({key,name}))})}
  if(!validSession(req))return res.status(401).json({error:"Unauthorized."});
  if(action!=="SEND")return res.status(400).json({error:"Invalid action."});
  const target=String(body.target||"").trim();
  const WEBHOOK=webhookFor(target);
  if(!WEBHOOK)return res.status(503).json({error:"That custom-message destination is not configured."});
  if(!rateLimit(req,res,"custom-message-send",10,60*1000))return res.status(429).json({error:"Too many messages. Please wait a moment."});
  const rawMessage=clean(body.message,4096);
  if(!rawMessage)return res.status(400).json({error:"Message is required."});
  const message=await resolveRoleMentions(rawMessage,target);
  const title=clean(body.title,256),description=clean(body.message,4096),footer=clean(body.footer,2048),image=imageUrl(body.imageUrl);
  const embed={title,description,color:hexColor(body.color),timestamp:new Date().toISOString(),footer:{text:footer||"Kingshot Auto Redeem"}};
  if(image)embed.image={url:image};
  if(!title)delete embed.title;
  if(!description)delete embed.description;
  const mentionTokens=[...message.matchAll(/@everyone|@here|<@!?\d+>|<@&\d+>/g)].map(m=>m[0]);
const content=[...new Set(mentionTokens)].join(" ");
const payload={username:"Kingshot Auto Redeem",...(content?{content}:{}),allowed_mentions:{parse:["everyone","roles","users"]},embeds:[embed]};
  const wr=await fetch(WEBHOOK,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)});
  if(!wr.ok){
   const retryAfter=Number(wr.headers.get("retry-after")||"0"),detail=await wr.text().catch(()=>"");
   return res.status(502).json({error:"Discord rejected the message ("+wr.status+")."+(retryAfter?" Retry after "+Math.ceil(retryAfter)+"s.":"")+(detail?" "+detail.slice(0,180):"")});
  }
  return res.status(200).json({ok:true});
 }
 catch(e){return res.status(502).json({error:e?.message||"Custom message service unavailable."})}
}
// Destination configuration is loaded from Vercel production environment variables.
