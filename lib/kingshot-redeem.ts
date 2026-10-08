import crypto from"node:crypto";

const clean=s=>String(s??"").replace(/[^\x20-\x7E]/g,"").trim();
const errorCategories={SUCCESS:"SUCCESS",RECEIVED:"ALREADY_REDEEMED", "SAME TYPE EXCHANGE":"ALREADY_REDEEMED",TIME_ERROR:"EXPIRED",CDK_NOT_FOUND:"INVALID_CODE",USAGE_LIMIT:"USAGE_LIMIT",ROLE_NOT_EXIST:"PLAYER_NOT_FOUND",STATE_MISMATCH:"KINGDOM_MISMATCH",SIGN_ERROR:"UPSTREAM_AUTH",TIMEOUT_RETRY:"RATE_LIMIT",LOGIN_EXPIRED_MID_PROCESS:"UPSTREAM_AUTH"};
const labels={
 SUCCESS:["Redeemed successfully.","Your gift rewards should be available in-game."],
 RECEIVED:["Already claimed.","This account has already redeemed this code."],
 "SAME TYPE EXCHANGE":["Already claimed.","This code was already redeemed for this reward type."],
 TIME_ERROR:["Code expired.","This gift code is no longer valid."],
 CDK_NOT_FOUND:["Code not found.","Check the gift code and try again."],
 USAGE_LIMIT:["Usage limit reached.","This gift code has reached its redemption limit."],
 ROLE_NOT_EXIST:["Player not found.","The Player ID and kingdom could not be resolved."],
 STATE_MISMATCH:["Kingdom mismatch.","The supplied kingdom does not match this player."],
 SIGN_ERROR:["Redemption unavailable.","The upstream signature was rejected."],
 TIMEOUT_RETRY:["Try again shortly.","The gift service is rate-limiting or temporarily unavailable."]
};

export async function redeemKingshot({playerId,code,kid}){
 const fid=clean(playerId).replace(/\D/g,""),giftCode=clean(code),kingdom=clean(kid).replace(/\D/g,"");
 if(!/^\d{5,20}$/.test(fid))return {httpStatus:400,error:"Invalid player ID."};
 if(!/^\d{1,10}$/.test(kingdom))return {httpStatus:400,error:"Invalid kingdom ID."};
 if(!/^[A-Za-z0-9_-]{1,64}$/.test(giftCode))return {httpStatus:400,error:"Invalid gift code."};
 const secret=process.env.KINGSHOT_API_SECRET;
 if(!secret)return {httpStatus:503,error:"Kingshot redemption secret is not configured on the server."};
 const payload={fid,cdk:giftCode,kid:kingdom,time:String(Math.floor(Date.now()/1000))};
 const encoded=Object.keys(payload).sort().map(k=>k+"="+payload[k]).join("&");
 const sign=crypto.createHash("md5").update(encoded+secret).digest("hex");
 try{
  const r=await fetch("https://kingshot-giftcode.centurygame.com/api/gift_code",{
   method:"POST",
   headers:{
    accept:"application/json, text/plain, */*",
    "accept-encoding":"gzip, deflate",
    "accept-language":"en-US,en;q=0.9",
    "content-type":"application/x-www-form-urlencoded",
    origin:"https://kingshot-giftcode.centurygame.com",
    referer:"https://kingshot-giftcode.centurygame.com/",
    "sec-fetch-dest":"empty","sec-fetch-mode":"cors","sec-fetch-site":"same-origin",
    "user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
   },
   body:new URLSearchParams({...payload,sign}),
   signal:AbortSignal.timeout(30000)
  });
  const raw=await r.text();
  let d={};
  try{d=JSON.parse(raw)}catch{
   const snippet=raw.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,180);
   return {httpStatus:502,error:snippet?"Kingshot returned a non-JSON response: "+snippet:"Kingshot returned an invalid response."};
  }
  if([429,502,503,504].includes(r.status))return {httpStatus:503,errorCategory:r.status===429?"RATE_LIMIT":"UPSTREAM_UNAVAILABLE",error:"Kingshot is rate-limiting or temporarily unavailable. Try again shortly."};
  const msg=String(d.msg||"Unknown Error").replace(/\.$/,"").toUpperCase();
  let status=msg;
  if(msg==="RECEIVED"&&d.err_code===40008)status="RECEIVED";
  if(msg==="SAME TYPE EXCHANGE"&&d.err_code===40011)status="SAME TYPE EXCHANGE";
  if(msg==="TIME ERROR"&&d.err_code===40007)status="TIME_ERROR";
  if(msg==="CDK NOT FOUND"&&d.err_code===40014)status="CDK_NOT_FOUND";
  if(msg==="USED"&&d.err_code===40005)status="USAGE_LIMIT";
  if(msg==="TOO FREQUENT"&&d.err_code===40019)status="TIMEOUT_RETRY";
  if(msg==="NOT LOGIN")status="LOGIN_EXPIRED_MID_PROCESS";
  if(d.err_code===40001&&msg.includes("NOT EXIST"))status="ROLE_NOT_EXIST";
  const [statusLabel,message]=labels[status]||[status,"Kingshot returned: "+msg];
  const ok=["SUCCESS","RECEIVED","SAME TYPE EXCHANGE"].includes(status);
  return {httpStatus:ok?200:400,ok,status,errorCategory:errorCategories[status]||"UPSTREAM_ERROR",statusLabel,message,errCode:d.err_code??null};
 }catch(e){
  return {httpStatus:504,errorCategory:"TIMEOUT",error:"Kingshot redemption request timed out."};
 }
}