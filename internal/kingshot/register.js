import {rateLimit}from"../../lib/request-rate-limit.js";
import {verifyKingdom}from"./mightpulse.js";

const SUPABASE_URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;

if(!SUPABASE_KEY)throw Error("Supabase service key is not configured on the server.");

async function rpc(name,body){
 const r=await fetch(SUPABASE_URL+"/rest/v1/rpc/"+name,{method:"POST",headers:{apikey:SUPABASE_KEY,authorization:"Bearer "+SUPABASE_KEY,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 const d=await r.json().catch(()=>null);
 if(!r.ok)throw Error(d?.message||"Supabase request failed.");
 return Array.isArray(d)?d[0]:d;
}

export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
 if(!rateLimit(req,res,"register",60,60000))return res.status(429).json({error:"Too many registration requests. Please try again shortly."});
 const body=req.body||{};
 const playerId=String(body.playerId??"").replace(/\D/g,"");
 const kingdomId=String(body.kingdomId??"").replace(/\D/g,"");
 const playerName=String(body.playerName??"").trim().slice(0,120);
 const avatarUrl=String(body.avatarUrl??"").trim().slice(0,500);
 if(!/^\d{5,20}$/.test(playerId))return res.status(400).json({error:"Invalid player ID."});
 if(kingdomId&&!/^\d{1,10}$/.test(kingdomId))return res.status(400).json({error:"Invalid kingdom ID."});
 try{
  const r=await fetch(SUPABASE_URL+"/rest/v1/rpc/register_kingshot_player_v2",{method:"POST",headers:{"apikey":SUPABASE_KEY,"authorization":"Bearer "+SUPABASE_KEY,"content-type":"application/json"},body:JSON.stringify({p_player_id:playerId,p_kingdom_id:kingdomId||null,p_player_name:playerName||null,p_avatar_url:avatarUrl||null}),signal:AbortSignal.timeout(10000)});
  const d=await r.json().catch(()=>null);
  if(!r.ok)return res.status(502).json({error:d?.message||d?.hint||"Could not register this player."});
  const result=Array.isArray(d)?d[0]:d;
  let verified=null;
  try{
   verified=await verifyKingdom(playerId);
   if(verified.notFound){
    await rpc("mark_kingshot_player_stale",{p_player_id:playerId,p_reason:"MIGHTPULSE_PLAYER_NOT_FOUND"});
    return res.status(200).json({registered:true,alreadyRegistered:Boolean(result?.already_registered),registrationStatus:result?.registration_status||((result?.already_registered)?"ALREADY_REGISTERED":"NEW"),kingdomVerified:false,stale:true,player:result?.player||result});
   }
   await rpc("record_kingshot_kingdom_revalidation",{p_player_id:playerId,p_kingdom_id:verified.kingdomId,p_player_name:verified.name||playerName||null,p_avatar_url:verified.avatarUrl||avatarUrl||null});
  }catch(error){
   return res.status(200).json({registered:true,alreadyRegistered:Boolean(result?.already_registered),registrationStatus:result?.registration_status||((result?.already_registered)?"ALREADY_REGISTERED":"NEW"),kingdomVerified:false,verificationPending:true,player:result?.player||result});
  }
  return res.status(200).json({registered:true,alreadyRegistered:Boolean(result?.already_registered),registrationStatus:result?.registration_status||((result?.already_registered)?"ALREADY_REGISTERED":"NEW"),kingdomVerified:true,verifiedKingdomId:verified.kingdomId,player:result?.player||result});
 }catch(e){return res.status(504).json({error:"Registration service timed out."})}
}
