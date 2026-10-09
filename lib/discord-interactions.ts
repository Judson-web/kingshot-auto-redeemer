import crypto from"node:crypto";

const DISCORD_API="https://discord.com/api/v10";
const PUBLIC_KEY=process.env.DISCORD_PUBLIC_KEY||process.env.DISCORD_APPLICATION_PUBLIC_KEY||"";
const BOT_TOKEN=process.env.DISCORD_BOT_TOKEN||"";

function getRawBody(req){
 return new Promise((resolve,reject)=>{
  const chunks=[];
  req.on("data",chunk=>chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)));
  req.on("end",()=>resolve(Buffer.concat(chunks).toString("utf8")));
  req.on("error",reject);
 });
}
function verifySignature(timestamp,raw,signature){
 if(!PUBLIC_KEY||!timestamp||!signature)return false;
 try{
  const keyBytes=Buffer.from(PUBLIC_KEY,"hex");
  if(keyBytes.length!==32)return false;
  const der=Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),keyBytes]);
  return crypto.verify(null,Buffer.from(timestamp+raw),crypto.createPublicKey({key:der,format:"der",type:"spki"}),Buffer.from(signature,"hex"));
 }catch{return false}
}
function option(options,name){return options?.find(x=>x.name===name)?.value}
function field(name,value,inline=true){return {name,value:String(value??"—").slice(0,1024),inline}}
function safe(value,fallback="—"){const v=String(value??"").trim();return v||fallback}
function formatPower(value){
 const n=Number(value);
 if(!Number.isFinite(n))return safe(value);
 if(n>=1e9)return (n/1e9).toFixed(2)+"B";
 if(n>=1e6)return (n/1e6).toFixed(2)+"M";
 if(n>=1e3)return (n/1e3).toFixed(1)+"K";
 return String(n);
}
async function discordRequest(path,method="POST",body){
 return fetch(DISCORD_API+path,{method,headers:{Authorization:"Bot "+BOT_TOKEN,"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
}
async function interactionCallback(id,token,body){
 return fetch(DISCORD_API+"/interactions/"+id+"/"+token+"/callback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
}
async function followup(token,body){
 return fetch(DISCORD_API+"/webhooks/"+(await getApplicationId())+"/"+token,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
}
let appIdCache=null;
async function getApplicationId(){
 if(appIdCache)return appIdCache;
 const r=await discordRequest("/users/@me","GET");
 if(!r.ok)throw Error("Discord bot authentication failed.");
 const d=await r.json();
 appIdCache=String(d.id);
 return appIdCache;
}
async function fetchPlayer(id){
 const key=process.env.MIGHTPULSE_API_KEY||process.env.KSS_API_KEY;
 if(!key)throw Error("MightPulse API key is not configured.");
 const r=await fetch("https://api.mightpulse.com/v1/players/"+encodeURIComponent(id)+"?include=base",{headers:{Authorization:"Bearer "+key},signal:AbortSignal.timeout(15000)});
 const d=await r.json().catch(()=>({}));
 if(r.status===404)return null;
 if(!r.ok)throw Error(d?.message||d?.error||"MightPulse could not load this player.");
 return d.player||d;
}
async function registerPlayer(req,id){
 const host=String(req.headers["x-forwarded-host"]||req.headers.host||"").split(",")[0].trim();
 const proto=String(req.headers["x-forwarded-proto"]||"https").split(",")[0].trim();
 if(!host)throw Error("Registration service host is unavailable.");
 const r=await fetch(proto+"://"+host+"/api/kingshot-register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({playerId:id}),signal:AbortSignal.timeout(20000)});
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(d?.error||"Could not register this player.");
 return d;
}
function playerEmbed(p,privateView){
 const alliance=p.alliance||{};
 const id=safe(p.governor_id||p.fid||p.uid);
 const e={title:"👤 Kingshot Player",description:"MightPulse player lookup",color:0x5865F2,thumbnail:p.avatar_url?{url:String(p.avatar_url)}:undefined,fields:[
  field("Name",safe(p.nick_name||p.name)),
  field("Kingdom",safe(p.kid)),
  field("Power",formatPower(p.power)),
  field("Town Center",safe(p.town_center_level)),
  field("VIP",safe(p.vip)),
  field("Alliance",alliance.name?String(alliance.name)+" ["+safe(alliance.abbr)+" ]":"—"),
  field("Alliance Rank",safe(alliance.rank_label||alliance.rank)),
  field("Kills",formatPower(p.kills)),
  field("Coordinates",p.x!=null&&p.y!=null?p.x+" / "+p.y:"—"),
  field("Online",p.online?"Yes":"No")
 ],footer:{text:"MightPulse data · Kingshot Auto Redeem"}};
 if(privateView)e.fields.unshift(field("Player ID",id,false));
 return e;
}
async function handleCommand(req,interaction){
 const name=String(interaction.data?.name||"");
 const opts=interaction.data?.options||[];
 if(name==="player"){
  const id=String(option(opts,"id")||"").trim();
  if(!/^\d{5,20}$/.test(id))return {content:"❌ Enter a valid Kingshot Player ID.",flags:64};
  await interactionCallback(interaction.id,interaction.token,{type:5,data:{}});
  try{
   const p=await fetchPlayer(id);
   if(!p)return followup(interaction.token,{content:"❌ Player not found."});
   return followup(interaction.token,{embeds:[playerEmbed(p,false)]});
  }catch(e){return followup(interaction.token,{content:"❌ "+safe(e.message,"Player lookup failed.")})}
 }
 if(name==="register"){
  const id=String(option(opts,"player_id")||"").trim();
  if(!/^\d{5,20}$/.test(id))return {content:"❌ Enter a valid Kingshot Player ID.",flags:64};
  await interactionCallback(interaction.id,interaction.token,{type:5,data:{flags:64}});
  try{
   const d=await registerPlayer(req,id);
   const kingdom=d.verifiedKingdomId||d.player?.kingdom_id||d.player?.kid;
   const status=d.registrationStatus||"REGISTERED";
   return followup(interaction.token,{content:"✅ **Auto-redeem enabled**\nRegistration: **"+status+"**\nKingdom: **"+safe(kingdom)+"**\n\nEligible gift codes will be processed automatically.",flags:64});
  }catch(e){return followup(interaction.token,{content:"❌ "+safe(e.message,"Registration failed."),flags:64})}
 }
 return {content:"Unknown command.",flags:64};
}
export const config={api:{bodyParser:false}};
export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
 const raw=await getRawBody(req);
 const signature=String(req.headers["x-signature-ed25519"]||"");
 const timestamp=String(req.headers["x-signature-timestamp"]||"");
 if(!verifySignature(timestamp,raw,signature))return res.status(401).send("invalid request signature");
 let interaction;
 try{interaction=JSON.parse(raw)}catch{return res.status(400).json({error:"Invalid JSON"})}
 if(interaction.type===1)return res.status(200).json({type:1});
 if(interaction.type!==2)return res.status(400).json({error:"Unsupported interaction"});
 try{
  const result=await handleCommand(req,interaction);
  if(result?.status){return res.status(200).end()}
  if(result?.ok===false)return res.status(500).end();
  if(result?.content||result?.embeds)return res.status(200).json({type:4,data:result});
  return res.status(200).end();
 }catch(e){
  try{await interactionCallback(interaction.id,interaction.token,{type:4,data:{content:"❌ "+safe(e.message,"Something went wrong."),flags:64}})}catch{}
  return res.status(200).end();
 }
}
