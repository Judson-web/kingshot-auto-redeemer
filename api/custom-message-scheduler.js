import crypto from"node:crypto";
const SECRET=process.env.CUSTOM_MESSAGE_SCHEDULER_SECRET||"";
const SUPABASE_URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY||"";
function authorized(req){
 if(!SECRET)return false;
 const raw=String(req.headers.authorization||"");
 const supplied=raw.startsWith("Bearer ")?raw.slice(7):"";
 const a=Buffer.from(supplied),b=Buffer.from(SECRET);
 return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function parseConfiguredDestinations(){
 const entries=String(process.env.CUSTOM_MESSAGE_DESTINATIONS||"").split(",").map(x=>x.trim()).filter(Boolean).map(x=>{const[key,...name]=x.split(":");return[key.trim(),name.join(":").trim()||key.trim()]});
 const map=new Map(entries);
 for(const key of Object.keys(process.env)){const m=key.match(/^CUSTOM_MESSAGE_WEBHOOK_([A-Za-z0-9_]+)_URL$/);if(m&&!map.has(m[1]))map.set(m[1],m[1])}
 if(!map.has("1494360495694549134")&&(process.env.DISCORD_KINGSHOT_WEBHOOK_URL||process.env.DISCORD_SCRAPER_WEBHOOK_URL))map.set("1494360495694549134","Kingshot");
 return map;
}
function webhookFor(key){const k=String(key||"").trim();if(!/^[A-Za-z0-9_-]{1,40}$/.test(k))return"";if(k==="1494360495694549134")return process.env.DISCORD_KINGSHOT_WEBHOOK_URL||process.env.DISCORD_SCRAPER_WEBHOOK_URL||"";return process.env["CUSTOM_MESSAGE_WEBHOOK_"+k.toUpperCase()+"_URL"]||""}
function clean(v,max){return String(v??"").trim().slice(0,max)}
function hexColor(v){const s=clean(v,20);return/^#?[0-9a-fA-F]{6}$/.test(s)?parseInt(s.replace("#",""),16):0x5865F2}
function imageUrl(v){const s=clean(v,2048);if(!s)return"";try{const u=new URL(s);return u.protocol==="https:"?u.toString():""}catch{return""}}
async function db(path,options={}){
 if(!SUPABASE_KEY)throw Error("Supabase service key is not configured.");
 const r=await fetch(SUPABASE_URL+"/rest/v1/"+path,{...options,headers:{apikey:SUPABASE_KEY,Authorization:"Bearer "+SUPABASE_KEY,"content-type":"application/json",...(options.headers||{})},signal:AbortSignal.timeout(8000)});
 const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{}
 if(!r.ok)throw Error(data?.message||data?.hint||text||("Supabase request failed ("+r.status+")"));
 return data;
}
function payloadFor(row){
 const raw=clean(row.message,4096),mentions=Array.isArray(row.mentions)?row.mentions:[];
 const hasEveryone=/@everyone/.test(raw)||mentions.includes("everyone"),hasHere=/@here/.test(raw)||mentions.includes("here");
 const description=clean(raw.replace(/@everyone|@here/g," ").replace(/\s{2,}/g," ").trim(),4096);
 const embed={title:clean(row.title,256),description,color:hexColor(row.color),timestamp:new Date().toISOString(),footer:{text:clean(row.footer,2048)||"Kingshot Auto Redeem"}};
 const image=imageUrl(row.image_url);if(image)embed.image={url:image};if(!embed.title)delete embed.title;if(!embed.description)delete embed.description;
 const content=[...(hasEveryone?["@everyone"]:[]),...(hasHere?["@here"]:[])].join(" ");
 return {...(content?{content}:{}),allowed_mentions:{parse:[...(hasEveryone||hasHere?["everyone"]:[])]},embeds:[embed]};
}
export default async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
 if(!authorized(req))return res.status(401).json({error:"Unauthorized."});
 try{
  const rows=await db("rpc/claim_due_custom_messages",{method:"POST",body:JSON.stringify({p_limit:10})})||[];
  let sent=0,failed=0;
  for(const row of rows){
   try{
    const webhook=webhookFor(row.target);
    if(!webhook)throw Error("Scheduled destination is no longer configured.");
    const wr=await fetch(webhook,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payloadFor(row)),signal:AbortSignal.timeout(8000)});
    if(!wr.ok){const detail=await wr.text().catch(()=>"");throw Error("Discord rejected the message ("+wr.status+")."+(detail?" "+detail.slice(0,180):""))}
    await db("kingshot_scheduled_messages?id=eq."+encodeURIComponent(row.id),{method:"PATCH",body:JSON.stringify({status:"SENT",sent_at:new Date().toISOString(),updated_at:new Date().toISOString(),error:null})});sent++;
   }catch(e){
    await db("kingshot_scheduled_messages?id=eq."+encodeURIComponent(row.id),{method:"PATCH",body:JSON.stringify({status:"FAILED",error:String(e?.message||e).slice(0,500),updated_at:new Date().toISOString()})}).catch(()=>{});failed++;
   }
  }
  return res.status(200).json({ok:true,claimed:rows.length,sent,failed});
 }catch(e){return res.status(500).json({error:e?.message||"Scheduler unavailable."})}
}
