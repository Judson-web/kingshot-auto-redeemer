import {rateLimit}from"../../lib/request-rate-limit.js";
import {getPlayer}from"./mightpulse.js";

export default async function handler(req,res){
 if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
 if(!rateLimit(req,res,"player-lookup",30,60000))return res.status(429).json({error:"Too many player lookups. Please try again shortly."});
 const id=String(req.query?.id||"").trim();
 if(!/^\d{5,20}$/.test(id))return res.status(400).json({error:"Invalid player ID."});
 try{
  const player=await getPlayer(id);
  return res.status(200).json({player});
 }catch(e){
  if(e?.status===404)return res.status(404).json({error:e.message||"MightPulse could not find this player."});
  if(/timed out|abort/i.test(e?.message||""))return res.status(504).json({error:"MightPulse request timed out."});
  return res.status(502).json({error:e?.message||"MightPulse request failed."});
 }
}
