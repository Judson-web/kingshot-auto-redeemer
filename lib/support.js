import {rateLimit} from"../lib/request-rate-limit.js";

const SUPABASE_URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const DISCORD_WEBHOOK_URL=process.env.DISCORD_KINGSHOT_WEBHOOK_URL||process.env.DISCORD_SCRAPER_WEBHOOK_URL;
async function notifySupport(ticket){
 if(!DISCORD_WEBHOOK_URL)return;
 const payload={username:"Kingshot Auto Redeem",allowed_mentions:{parse:[]},embeds:[{title:"🎫 New support request",description:"A new support ticket is waiting for review.",color:0x5865F2,fields:[
  {name:"Player ID",value:String(ticket?.player_id||"Unknown"),inline:true},
  {name:"Status",value:String(ticket?.status||"PENDING"),inline:true},
  {name:"Reason",value:String(ticket?.reason||"No reason").slice(0,900),inline:false},
  {name:"Time (UTC)",value:new Date().toISOString().replace("T"," ").replace(".000Z"," UTC"),inline:false}
 ],footer:{text:"Kingshot Support"}}]};
 try{await fetch(DISCORD_WEBHOOK_URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(7000)})}catch(error){console.error("Support Discord notification failed:",error?.message||error)}
}
export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
 if(!rateLimit(req,res,"support",6,60000))return res.status(429).json({error:"Too many support requests. Please try again shortly."});
 try{
  const body=req.body||{},playerId=String(body.playerId||"").trim(),reason=String(body.reason||"").trim().slice(0,1000);
  if(!/^[0-9]{5,20}$/.test(playerId))return res.status(400).json({error:"Enter a valid Player ID."});
  if(reason.length<5)return res.status(400).json({error:"Please provide a little more detail about the request."});
  const r=await fetch(SUPABASE_URL+"/rest/v1/rpc/submit_kingshot_support_ticket",{method:"POST",headers:{"apikey":SUPABASE_KEY,"authorization":"Bearer "+SUPABASE_KEY,"content-type":"application/json"},body:JSON.stringify({p_player_id:playerId,p_reason:reason}),signal:AbortSignal.timeout(8000)});
  const d=await r.json().catch(()=>null);
  if(!r.ok)return res.status(400).json({error:d?.message||"Could not submit the support request."});
  const ticket=Array.isArray(d)?d[0]:d;
  await notifySupport(ticket);
  return res.status(200).json({ok:true,ticket});
 }catch(e){return res.status(502).json({error:e.message||"Support service unavailable."})}
}
