import {redeemKingshot} from"../internal/kingshot/redeem.js";

const SUPABASE_URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const GIFT_SOURCE_URL="https://kingshot.net/api/gift-codes";
const PUBLIC_GIFT_SOURCES=[
 {name:"gamesradar",url:"https://www.gamesradar.com/games/strategy/kingshot-codes-gift/"},
 {name:"kingshot-guides",url:"https://kingshotguides.com/guide/active-giftcodes-and-how-to-redeem/"},
 {name:"beebom",url:"https://beebom.com/kingshot-codes/"},
 {name:"kingshotmastery",url:"https://kingshotmastery.com/gift-codes"},
 {name:"supercheats",url:"https://www.supercheats.com/kingshot-codes"}
];
// Verified long-running fallback for codes that have been omitted from the upstream API feed.
// Revalidated against public Kingshot code listings; the redemption endpoint remains the final authority.
const VERIFIED_FALLBACK_CODES=[{code:"VIP777",expiresAt:Date.parse("2026-12-31T23:59:59Z"),createdAt:Date.parse("2026-08-03T00:00:00Z")}];

if(!SUPABASE_KEY)throw Error("Supabase service key is not configured on the server.");

async function rpc(name,body){
 const r=await fetch(SUPABASE_URL+"/rest/v1/rpc/"+name,{method:"POST",headers:{"apikey":SUPABASE_KEY,"authorization":"Bearer "+SUPABASE_KEY,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 const d=await r.json().catch(()=>null);
 if(!r.ok)throw Error(d?.message||"Supabase request failed");
 return d;
}

import {extractPageCodes, extractPublicSourceCodes, mergeCodes, normalizeCodes} from "../internal/kingshot/gift-codes.js";

const HANDLED_STATUSES=new Set(["SUCCESS","RECEIVED","SAME TYPE EXCHANGE","TIME_ERROR","CDK_NOT_FOUND","USAGE_LIMIT"]);
const WORKER_COUNT=3;
const PLAYER_CONCURRENCY=6;
// Kingdom-reset validation has its own upstream-aware lane limit. Redemption
// concurrency stays at 6; only the daily MightPulse validation burst is paced.
const KINGDOM_VALIDATION_CONCURRENCY=3;
const MIGHTPULSE_RATE_LIMIT_BACKOFF_MS=[15000,30000,60000];
// Keep each shard bounded so a slow upstream cannot pin a Vercel invocation.
// A player redemption can take up to 30s at the upstream boundary, so 4m gives
// the six-lane pool enough room for normal bursts while leaving recovery time.
const WORKER_MAX_RUNTIME_MS=4*60*1000;
const WORKER_REQUEST_TIMEOUT_MS=4*60*1000;
const UPSTREAM_RETRYABLE=/timeout|timed out|abort|429|rate limit|too many requests|502|503|504/i;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const KINGDOM_RESET_HOUR=5;
const KINGDOM_RESET_MINUTE=30;
const DISCORD_WEBHOOK_URL=process.env.DISCORD_KINGSHOT_WEBHOOK_URL||process.env.DISCORD_SCRAPER_WEBHOOK_URL;
async function sendDiscordEvent({title,description,fields=[],color=0x5865F2}){
 if(!DISCORD_WEBHOOK_URL)return;
 const payload={username:"Kingshot Auto Redeem",allowed_mentions:{parse:[]},embeds:[{
  title:String(title||"Kingshot Auto Redeem").slice(0,256),
  description:description?String(description).slice(0,4096):undefined,
  color,
  fields:fields.slice(0,25).map(f=>({name:String(f.name||"Info").slice(0,256),value:String(f.value??"—").slice(0,1024),inline:Boolean(f.inline)})),
  timestamp:new Date().toISOString(),
  footer:{text:"Kingshot Redeemer"}
 }]};
 for(let attempt=0;attempt<3;attempt++){
  try{
   const response=await fetch(DISCORD_WEBHOOK_URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)});
   if(response.ok)return true;
   const retryAfter=Number(response.headers.get("retry-after")||"0");
   if((response.status===429||response.status>=500)&&attempt<2){
    const wait=Math.min(3000,Math.max(500,Number.isFinite(retryAfter)&&retryAfter>0?retryAfter*1000:750*(attempt+1)));
    await new Promise(resolve=>setTimeout(resolve,wait));
    continue;
   }
   console.error("Discord webhook rejected:",response.status,await response.text().catch(()=>""));
   return false;
  }catch(error){
   if(attempt<2){
    await new Promise(resolve=>setTimeout(resolve,750*(attempt+1)));
    continue;
   }
   console.error("Discord webhook failed:",error?.message||error);
   return false;
  }
 }
 return false;
}

function getKingshotResetBoundary(now=Date.now()){
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(now));
 const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
 const year=Number(values.year),month=Number(values.month),day=Number(values.day),hour=Number(values.hour),minute=Number(values.minute);
 const afterReset=hour>KINGDOM_RESET_HOUR||(hour===KINGDOM_RESET_HOUR&&minute>=KINGDOM_RESET_MINUTE);
 const dateKey=year+"-"+String(month).padStart(2,"0")+"-"+String(day).padStart(2,"0");
 return {dateKey,afterReset};
}

function needsKingdomResetCheck(lastCheckedAt,now=Date.now()){
 if(!lastCheckedAt)return true;
 const last=Date.parse(lastCheckedAt);
 if(Number.isNaN(last))return true;
 const current=getKingshotResetBoundary(now);
 const previous=getKingshotResetBoundary(last);
 if(current.dateKey!==previous.dateKey)return current.afterReset;
 return current.afterReset&&!previous.afterReset;
}

async function fetchCurrentKingshotPlayer(playerId){
 const key=process.env.MIGHTPULSE_API_KEY||process.env.KSS_API_KEY;
 if(!key)throw Error("MightPulse API key is not configured on the server.");
 let lastError=null;
 for(let attempt=0;attempt<3;attempt++){
  try{
   const r=await fetch("https://api.mightpulse.com/v1/players/"+encodeURIComponent(playerId)+"?include=base",{
    headers:{Authorization:"Bearer "+key},
    signal:AbortSignal.timeout(15000)
   });
   const d=await r.json().catch(()=>({}));
   if(r.status===404)return {notFound:true};
   if(!r.ok){
    const error=Error(d?.message||d?.error||"MightPulse revalidation failed.");
    error.status=r.status;
    const retryAfter=Number(r.headers.get("retry-after")||"0");
    if(Number.isFinite(retryAfter)&&retryAfter>0)error.retryAfterMs=Math.min(90000,retryAfter*1000);
    throw error;
   }
   return {player:d.player||d};
  }catch(error){
   lastError=error;
   const status=Number(error?.status||0);
   const message=String(error?.message||"");
   const rateLimited=status===429||/rate[_ -]?limited|rate limit|too many requests/i.test(message);
   const retryable=UPSTREAM_RETRYABLE.test(message)||[429,502,503,504].includes(status);
   if(attempt<2&&retryable){
    if(rateLimited){
     const base=MIGHTPULSE_RATE_LIMIT_BACKOFF_MS[Math.min(attempt,MIGHTPULSE_RATE_LIMIT_BACKOFF_MS.length-1)];
     const jitter=Math.floor(Math.random()*2000);
     await sleep(Math.min(90000,Number(error?.retryAfterMs)||base)+jitter);
    }else{
     await sleep(750*(attempt+1));
    }
    continue;
   }
   throw error;
  }
 }
 throw lastError||Error("MightPulse revalidation failed.");
}

async function claimKingdomResetCheck(player){
 if(!needsKingdomResetCheck(player.last_kingdom_check_at))return false;
 const result=await rpc("claim_kingshot_kingdom_reset_check",{p_player_id:player.player_id});
 return Boolean(result?.claimed);
}

async function ensureCurrentKingdom(player){
 if(!(await claimKingdomResetCheck(player)))return {player,revalidated:false};
 let claimed=true;
 try{
  const fresh=await fetchCurrentKingshotPlayer(player.player_id);
  if(fresh.notFound){
   await rpc("mark_kingshot_player_stale",{p_player_id:player.player_id,p_reason:"MIGHTPULSE_PLAYER_NOT_FOUND"});
   await sendDiscordEvent({title:"🗑️ Deleted Kingshot account filtered",description:"The scheduled kingdom-reset revalidation could not find this registered player. The registration is now stale and excluded from future auto-redeem cycles.",fields:[{name:"Player ID",value:String(player.player_id),inline:true},{name:"Last kingdom",value:String(player.kingdom_id||"Unknown"),inline:true},{name:"Check",value:"Reset-cycle player revalidation",inline:true}],color:0xFEE75C});
   return {stale:true};
  }
  const p=fresh.player||{};
  const currentKingdom=String(p.kid??p.kingdom_id??"").replace(/\D/g,"");
  if(!currentKingdom)throw Error("MightPulse returned no kingdom for this player.");
  const result=await rpc("record_kingshot_kingdom_revalidation",{
   p_player_id:player.player_id,
   p_kingdom_id:currentKingdom,
   p_player_name:p.nick_name||p.name||p.nickname||null,
   p_avatar_url:p.avatar_url||p.avatar||p.avatarUrl||null
  });
  const updated=result?.player||player;
  claimed=false;
  if(result?.kingdom_changed){
   console.log("Kingshot kingdom changed:",{playerId:player.player_id,from:result.old_kingdom_id,to:result.new_kingdom_id});
   await sendDiscordEvent({title:"🔄 Kingdom changed",description:"A registered player's current Kingshot kingdom changed.",fields:[{name:"Player ID",value:String(player.player_id),inline:true},{name:"Previous",value:String(result.old_kingdom_id||"Unknown"),inline:true},{name:"Current",value:String(result.new_kingdom_id||currentKingdom),inline:true}],color:0x5865F2});
  }
  return {player:updated,revalidated:true,kingdomChanged:Boolean(result?.kingdom_changed)};
 }catch(error){
  if(claimed)await rpc("release_kingshot_kingdom_reset_check",{p_player_id:player.player_id}).catch(releaseError=>console.error("Kingdom check claim release failed:",releaseError?.message||releaseError));
  throw error;
 }
}
async function revalidatePlayer(player,{force=false}={}){
 try{
  // Forced/manual checks deliberately bypass the reset-cycle claim/cooldown.
  // They still use the same MightPulse fetch and Supabase revalidation RPC,
  // but never enter the redemption path.
  if(force){
   const fresh=await fetchCurrentKingshotPlayer(player.player_id);
   if(fresh.notFound){
    await rpc("mark_kingshot_player_stale",{p_player_id:player.player_id,p_reason:"MIGHTPULSE_PLAYER_NOT_FOUND"});
    return {stale:true};
   }
   const p=fresh.player||{};
   const currentKingdom=String(p.kid??p.kingdom_id??"").replace(/\D/g,"");
   if(!currentKingdom)throw Error("MightPulse returned no kingdom for this player.");
   const result=await rpc("record_kingshot_kingdom_revalidation",{
    p_player_id:player.player_id,
    p_kingdom_id:currentKingdom,
    p_player_name:p.nick_name||p.name||p.nickname||null,
    p_avatar_url:p.avatar_url||p.avatar||p.avatarUrl||null
   });
   if(result?.kingdom_changed){
    console.log("Kingshot manual kingdom changed:",{playerId:player.player_id,from:result.old_kingdom_id,to:result.new_kingdom_id});
    await sendDiscordEvent({title:"🔄 Kingdom changed",description:"A manual kingdom check detected a registered player's kingdom change.",fields:[{name:"Player ID",value:String(player.player_id),inline:true},{name:"Previous",value:String(result.old_kingdom_id||"Unknown"),inline:true},{name:"Current",value:String(result.new_kingdom_id||currentKingdom),inline:true}],color:0x5865F2});
   }
   return {player:result?.player||player,revalidated:true,kingdomChanged:Boolean(result?.kingdom_changed)};
  }

  if(!player?.kingdom_id){
   const fresh=await fetchCurrentKingshotPlayer(player.player_id);
   if(fresh.notFound){
    await rpc("mark_kingshot_player_stale",{p_player_id:player.player_id,p_reason:"MIGHTPULSE_PLAYER_NOT_FOUND"});
    return {stale:true};
   }
   const p=fresh.player||{};
   const currentKingdom=String(p.kid??p.kingdom_id??"").replace(/\D/g,"");
   if(!currentKingdom)throw Error("MightPulse returned no kingdom for this player.");
   const result=await rpc("record_kingshot_kingdom_revalidation",{
    p_player_id:player.player_id,
    p_kingdom_id:currentKingdom,
    p_player_name:p.nick_name||p.name||p.nickname||null,
    p_avatar_url:p.avatar_url||p.avatar||p.avatarUrl||null
   });
   player=result?.player||player;
  }
  const kingdomState=await ensureCurrentKingdom(player);
  if(kingdomState.stale)return {stale:true};
  return {
   player:kingdomState.player||player,
   revalidated:Boolean(kingdomState.revalidated),
   kingdomChanged:Boolean(kingdomState.kingdomChanged)
  };
 }catch(error){
  console.error("Kingshot player validation failed:",player?.player_id,error?.message||error);
  return {revalidationError:1};
 }
}

async function updateScraperHealth(source,codeCount,error=null){
 try{
  // Keep scraper health/history in Supabase, but do not spam Discord with
  // per-source zero-code alerts. The primary API/page and merged feed remain
  // observable through worker logs and scraper-run history.
  await rpc("record_kingshot_scraper_health",{p_source:source,p_code_count:codeCount,p_error:error});
 }catch(error){console.error("Scraper health update failed:",source,error?.message||error)}
}

function classifyError(error){const m=String(error?.message||error||"").toLowerCase();if(/timeout|timed out|abort/.test(m))return"TIMEOUT";if(/unauthorized|forbidden|401|403/.test(m))return"AUTH";if(/429|rate limit|too frequent/.test(m))return"RATE_LIMIT";if(/404|not found/.test(m))return"NOT_FOUND";if(/parse|json|invalid api response/.test(m))return"PARSE";if(/supabase|database|rpc/.test(m))return"DATABASE";if(/mightpulse|player/.test(m))return"UPSTREAM_PLAYER";if(/kingshot|gift|redemption/.test(m))return"UPSTREAM_REDEMPTION";return"UNKNOWN"}
async function recordScraperRun(source,httpStatus,codes,parseOk,error){await rpc("kingshot_record_scraper_run",{p_source:source,p_http_status:httpStatus,p_code_count:Array.isArray(codes)?codes.length:0,p_codes:Array.isArray(codes)?codes.map(x=>x.code):[],p_parse_ok:Boolean(parseOk),p_error_category:error?classifyError(error):null,p_error_message:error?.message||error||null}).catch(()=>{});}

async function fetchSource(url,kind){
 const sourceName=kind==="api"?"kingshot-api":kind==="page"?"kingshot-page":kind==="aggregator"?"whiteout-bot-aggregator":kind.slice(7);
 try{
  let response=null,lastError=null;
  for(let attempt=0;attempt<3;attempt++){
   try{
    response=await fetch(url,{headers:kind==="api"||kind==="aggregator"
     ?{"accept":"application/json","user-agent":"Nex-Kingshot-Redeemer/1.1",...(kind==="aggregator"?{"X-API-Key":String(process.env.KINGSHOT_AGGREGATOR_API_KEY||"")}:{})}
     :{"accept":"text/html,application/xhtml+xml","accept-language":"en-US,en;q=0.9","cache-control":"no-cache","user-agent":"Mozilla/5.0 (compatible; Nex-Kingshot-Redeemer/1.1; +https://kingshot-autoredeemer.vercel.app/)"},
     signal:AbortSignal.timeout(15000)});
    if(response.ok||![408,425,429,500,502,503,504].includes(response.status))break;
    lastError=Error("HTTP "+response.status);
   }catch(error){lastError=error}
   if(attempt<2)await sleep(700*(attempt+1));
  }
  if(!response){
   await recordScraperRun(sourceName,null,[],false,lastError||Error("Source request failed"));
   await updateScraperHealth(sourceName,0,lastError?.message||"Source request failed");
   return kind==="api"||kind==="aggregator"?{data:null,codes:[],ok:false,httpStatus:null,error:lastError?.message||"Source request failed",source:sourceName}:{html:"",codes:[],ok:false,httpStatus:null,error:lastError?.message||"Source request failed",source:sourceName};
  }
  const body=await response.text();
  if(!response.ok){const error=Error("HTTP "+response.status);await recordScraperRun(sourceName,response.status,[],false,error);await updateScraperHealth(sourceName,0,error.message);return kind==="api"||kind==="aggregator"?{data:null,codes:[],ok:false,httpStatus:response?.status||null,error:"HTTP "+response.status,source:sourceName}:{html:"",codes:[],ok:false,httpStatus:response?.status||null,error:"HTTP "+response.status,source:sourceName};}
  if(kind==="api"||kind==="aggregator"){
   let data=null;try{data=JSON.parse(body)}catch{}
   const valid=data&&(kind==="api"?data?.status==="success":Array.isArray(data?.codes));
   const codes=valid?(kind==="api"?normalizeCodes(data):extractAggregatorCodes(data)):[];
   const parseError=valid?null:Error("Invalid API response");
   await updateScraperHealth(sourceName,codes.length,parseError?.message||null);
   await recordScraperRun(sourceName,response.status,codes,Boolean(valid),parseError);
   return {data,codes,ok:Boolean(valid),httpStatus:response.status,error:parseError?.message||null,source:sourceName};
  }
  const codes=kind==="page"?extractPageCodes(body):extractPublicSourceCodes(body,sourceName);
  await updateScraperHealth(sourceName,codes.length,null);
  await recordScraperRun(sourceName,response.status,codes,true,null);
  return {html:body,codes,ok:true,httpStatus:response.status,error:null,source:sourceName};
 }catch(error){
  await updateScraperHealth(sourceName,0,error?.message||"Source request failed");
  await recordScraperRun(sourceName,null,[],false,error);
  return kind==="api"||kind==="aggregator"?{data:null,codes:[],ok:false,httpStatus:null,error:error?.message||"Source request failed",source:sourceName}:{html:"",codes:[],ok:false,httpStatus:null,error:error?.message||"Source request failed",source:sourceName};
 }

}

async function redeemForPlayer(player,codes){
 // New registrations may not have a kingdom yet. Populate it immediately
 // instead of waiting for the next daily reset revalidation.
 if(!player.kingdom_id){
  try{
   const fresh=await fetchCurrentKingshotPlayer(player.player_id);
   if(fresh.notFound){
    await rpc("mark_kingshot_player_stale",{p_player_id:player.player_id,p_reason:"MIGHTPULSE_PLAYER_NOT_FOUND"});
    await sendDiscordEvent({title:"🗑️ Deleted Kingshot account filtered",description:"A newly registered player could not be found during initial validation and was excluded from auto-redeem.",fields:[{name:"Player ID",value:String(player.player_id),inline:true}],color:0xFEE75C});
    return {attempted:0,success:0,alreadyHandled:0,skipped:1,stale:1};
   }
   const p=fresh.player||{};
   const currentKingdom=String(p.kid??p.kingdom_id??"").replace(/\D/g,"");
   if(!currentKingdom)throw Error("MightPulse returned no kingdom for this player.");
   const result=await rpc("record_kingshot_kingdom_revalidation",{
    p_player_id:player.player_id,
    p_kingdom_id:currentKingdom,
    p_player_name:p.nick_name||p.name||p.nickname||null,
    p_avatar_url:p.avatar_url||p.avatar||p.avatarUrl||null
   });
   player=result?.player||player;
   console.log("Kingshot initial player validation:",{playerId:player.player_id,kingdomId:player.kingdom_id});
  }catch(error){
   console.error("Initial Kingshot player validation failed:",player.player_id,error?.message||error);
   return {attempted:0,success:0,alreadyHandled:0,skipped:1,revalidationError:1};
  }
 }
 const kingdomState=await ensureCurrentKingdom(player);
 const kingdomCheck=Boolean(kingdomState.revalidated);
 const kingdomChanged=Boolean(kingdomState.kingdomChanged);
 if(kingdomState.stale)return {attempted:0,success:0,alreadyHandled:0,skipped:1,stale:1,kingdomCheck,kingdomChanged};
 if(!kingdomState.player?.kingdom_id)return {attempted:0,success:0,alreadyHandled:0,skipped:1,revalidationError:1,kingdomCheck,kingdomChanged};
 player=kingdomState.player;
 const history=await rpc("list_kingshot_player_redemptions",{p_player_id:player.player_id});
 const handled=new Set((Array.isArray(history)?history:[])
  .filter(row=>HANDLED_STATUSES.has(String(row?.status||"").toUpperCase()))
  .map(row=>String(row?.gift_code||"").toUpperCase()));

 // Process only the newest outstanding code for each player per run.
 // This keeps the request comfortably below pg_net's 5s HTTP timeout and
 // respects Kingshot's per-player TOO FREQUENT rate limit. Older missed
 // active codes are picked up on subsequent runs.
 if(!codes.length)return {attempted:0,success:0,alreadyHandled:0,skipped:1,kingdomCheck,kingdomChanged,handledCodeCounts:{}};
 const item=codes.find(code=>!handled.has(code.code.toUpperCase()));
 if(!item){
  const handledCodeCounts={};
  for(const code of codes)if(handled.has(code.code.toUpperCase()))handledCodeCounts[code.code]=(handledCodeCounts[code.code]||0)+1;
  return {attempted:0,success:0,alreadyHandled:codes.length,skipped:0,kingdomCheck,kingdomChanged,handledCodeCounts};
 }

 const claimed=await rpc("claim_kingshot_redemption",{p_player_id:player.player_id,p_code:item.code});
 if(!claimed)return {attempted:0,success:0,alreadyHandled:0,skipped:1,kingdomCheck,kingdomChanged};

 const redemptionStartedAt=Date.now();
 const d=await redeemKingshot({playerId:player.player_id,code:item.code,kid:player.kingdom_id});
 const completedAt=Date.now();
 const status=String(d?.status||"ERROR").toUpperCase();
 const message=d?.message||d?.error||"";
 await rpc("record_kingshot_redemption",{p_player_id:player.player_id,p_code:item.code,p_status:status,p_err_code:d?.errCode??null,p_message:(d?.errorCategory?"["+d.errorCategory+"] ":"")+message});

 const firstSeenAt=Number.isFinite(Date.parse(item.firstSeenAt||""))?Date.parse(item.firstSeenAt):null;
 const redemptionTelemetry={code:item.code,resultAt:new Date(completedAt).toISOString(),status,redemptionLatencyMs:Math.max(0,completedAt-redemptionStartedAt),discoveryToResultMs:firstSeenAt==null?null:Math.max(0,completedAt-firstSeenAt)};
 return {attempted:1,success:status==="SUCCESS"?1:0,alreadyReceived:status==="RECEIVED"?1:0,alreadyHandled:0,skipped:0,kingdomCheck,kingdomChanged,redemptionCode:item.code,redemptionStatus:status,redemptionErrorCategory:d?.errorCategory||null,redemptionErrCode:d?.errCode??null,redemptionMessage:message?String(message).slice(0,240):null,redemptionTelemetry};
}

async function runWithConcurrency(players,fn,limit,{deadline=Infinity}={}){
 const results=new Array(players.length);
 let next=0;
 let deadlineSkipped=0;
 async function worker(){
  while(true){
   const i=next++;
   if(i>=players.length)return;
   if(Date.now()>=deadline){
    deadlineSkipped++;
    results[i]={attempted:0,success:0,alreadyHandled:0,skipped:1,deadlineSkipped:1};
    continue;
   }
   try{results[i]=await fn(players[i])}catch(error){results[i]={error:error?.message||"Player processing failed",errorCategory:classifyError(error)}}
  }
 }
 await Promise.all(Array.from({length:Math.min(limit,players.length)},worker));
 if(deadlineSkipped)console.warn("Kingshot worker shard deadline reached; deferred players:",deadlineSkipped);
 return results;
}

function workerBucket(value){
 const input=String(value||"");
 let hash=2166136261;
 for(let i=0;i<input.length;i++){
  hash^=input.charCodeAt(i);
  hash=Math.imul(hash,16777619);
 }
 return (hash>>>0)%WORKER_COUNT;
}

function summarizeWorkerResults(results){
 const redemptionDiagnostics=results.reduce((map,r)=>{
  if(!r?.redemptionStatus)return map;
  const status=String(r.redemptionStatus).toUpperCase();
  if(status==="SUCCESS"||status==="RECEIVED"||status==="SAME TYPE EXCHANGE")return map;
  const category=String(r.redemptionErrorCategory||"UNKNOWN");
  const errCode=r.redemptionErrCode==null?"none":String(r.redemptionErrCode);
  const key=category+" / "+errCode+" / "+status;
  const existing=map[key]||{count:0,category,errCode,status,message:r.redemptionMessage||null};
  existing.count++;
  if(!existing.message&&r.redemptionMessage)existing.message=r.redemptionMessage;
  map[key]=existing;
  return map;
 },{});
 const statusCounts=results.reduce((map,r)=>{
  if(!r?.redemptionStatus)return map;
  const status=String(r.redemptionStatus).toUpperCase();
  map[status]=(map[status]||0)+1;
  return map;
 },{});
 const topRedemptionFailures=Object.values(redemptionDiagnostics).sort((x,y)=>y.count-x.count).slice(0,8);
 const workerErrorDiagnostics=results.reduce((map,r)=>{
  if(!r?.error)return map;
  const category=String(r.errorCategory||classifyError(r.error));
  const message=String(r.error).replace(/\\s+/g," ").trim().slice(0,240)||"Player processing failed.";
  const key=category+" / "+message;
  const existing=map[key]||{count:0,category,message};
  existing.count++;
  map[key]=existing;
  return map;
 },{});
 const topWorkerErrors=Object.values(workerErrorDiagnostics).sort((a,b)=>b.count-a.count).slice(0,8);
 const codeTelemetry=results.reduce((map,r)=>{
  const t=r?.redemptionTelemetry;
  if(!t?.code)return map;
  const code=String(t.code);
  const existing=map[code]||{attempts:0,successes:0,firstResultAt:null,firstSuccessAt:null,firstResultLatencyMs:null,totalRedemptionLatencyMs:0};
  existing.attempts++;
  if(t.status==="SUCCESS"){existing.successes++;if(!existing.firstSuccessAt||t.resultAt<existing.firstSuccessAt)existing.firstSuccessAt=t.resultAt;}
  if(!existing.firstResultAt||t.resultAt<existing.firstResultAt){existing.firstResultAt=t.resultAt;existing.firstResultLatencyMs=Number.isFinite(t.discoveryToResultMs)?t.discoveryToResultMs:null;}
  existing.totalRedemptionLatencyMs+=Number(t.redemptionLatencyMs||0);
  map[code]=existing;
  return map;
 },{});
 for(const value of Object.values(codeTelemetry)){value.avgRedemptionLatencyMs=value.attempts?Math.round(value.totalRedemptionLatencyMs/value.attempts):null;delete value.totalRedemptionLatencyMs;}
 const codeCounts=results.reduce((map,r)=>{
  for(const [code,count] of Object.entries(r?.handledCodeCounts||{}))map[code]=(map[code]||0)+Number(count||0);
  if(r?.redemptionCode){
   const code=String(r.redemptionCode);
   const status=String(r.redemptionStatus||"UNKNOWN").toUpperCase();
   map[code]=map[code]||0;
   map[code+"_status_"+status]=(map[code+"_status_"+status]||0)+1;
  }
  return map;
 },{});
 return {
  attempted:results.reduce((n,r)=>n+(r?.attempted||0),0),
  success:results.reduce((n,r)=>n+(r?.success||0),0),
  alreadyHandled:results.reduce((n,r)=>n+(r?.alreadyHandled||0),0),
  alreadyReceived:results.reduce((n,r)=>n+(r?.alreadyReceived||0),0),
  skipped:results.reduce((n,r)=>n+(r?.skipped||0),0),
  errors:results.reduce((n,r)=>n+(r?.error?1:0),0),
  stale:results.reduce((n,r)=>n+(r?.stale?1:0),0),
  redemptionStatuses:statusCounts,
  codeCounts,
  codeTelemetry,
  redemptionFailures:topRedemptionFailures,
  workerErrors:topWorkerErrors
 };
}

async function runWorkerShard(slot,codes,players){
 const claim=await rpc("claim_kingshot_worker_slot",{p_slot:slot});
 if(!claim?.claimed){
  return {slot,claimed:false,skipped:true,reason:claim?.reason||"SLOT_ALREADY_RUNNING"};
 }
 const workerToken=claim.token;
 try{
  const assigned=(Array.isArray(players)?players:[]).filter(player=>workerBucket(player?.player_id)===slot);
  const deadline=Date.now()+WORKER_MAX_RUNTIME_MS;
  const results=await runWithConcurrency(assigned,p=>redeemForPlayer(p,codes),PLAYER_CONCURRENCY,{deadline});
  const totals=summarizeWorkerResults(results);
  totals.deadlineSkipped=results.reduce((n,r)=>n+(r?.deadlineSkipped||0),0);
  const summary={slot,players:assigned.length,...totals};
  await rpc("finish_kingshot_worker_slot",{
   p_slot:slot,
   p_token:workerToken,
   p_status:totals.errors||totals.stale?"COMPLETED_WITH_WARNINGS":"COMPLETED",
   p_error:null,
   p_summary:summary
  }).catch(error=>console.error("Worker slot state update failed:",slot,error?.message||error));
  console.log("Kingshot worker shard:",summary);
  return {claimed:true,...summary};
 }catch(error){
  await rpc("finish_kingshot_worker_slot",{
   p_slot:slot,
   p_token:workerToken,
   p_status:"FAILED",
   p_error:error?.message||"Worker shard failed.",
   p_summary:{slot,errorCategory:classifyError(error)}
  }).catch(releaseError=>console.error("Worker slot failure state update failed:",slot,releaseError?.message||releaseError));
  throw error;
 }
}

export default async function handler(req,res){
 if(!["GET","POST"].includes(req.method))return res.status(405).json({error:"Method not allowed"});
 const cycleStartedAt=Date.now();
 const cronSecret=process.env.CRON_SECRET;
 const schedulerToken=req.headers["x-kingshot-scheduler-token"];
 const requestUrl=new URL(req.url||"/","https://kingshot-autoredeemer.vercel.app");
 const mode=requestUrl.searchParams.get("mode");
 const slot=Number(requestUrl.searchParams.get("slot"));

 if(mode==="worker"){
  // Child shards are internal-only. They may use the same CRON_SECRET as the
  // coordinator or the scheduler token that authenticated the parent run.
  let workerAuthorized=Boolean(cronSecret&&req.headers.authorization==="Bearer "+cronSecret);
  if(!workerAuthorized&&schedulerToken){
   try{workerAuthorized=Boolean(await rpc("verify_kingshot_scheduler_token",{p_token:String(schedulerToken)}))}catch{}
  }
  if(!workerAuthorized)return res.status(401).json({error:"Unauthorized"});
  if(!Number.isInteger(slot)||slot<0||slot>=WORKER_COUNT)return res.status(400).json({error:"Invalid worker slot"});
  let body=req.body;
  if(typeof body==="string"){try{body=JSON.parse(body)}catch{return res.status(400).json({error:"Invalid worker payload"})}}
  const codes=Array.isArray(body?.codes)?body.codes:[];
  const players=Array.isArray(body?.players)?body.players:[];
  try{
   const result=await runWorkerShard(slot,codes,players);
   return res.status(200).json({ok:true,...result});
  }catch(error){
   console.error("Kingshot worker shard:",slot,error);
   return res.status(502).json({error:error?.message||"Worker shard failed.",errorCategory:classifyError(error),slot});
  }
 }

 let authorized=Boolean(cronSecret&&req.headers.authorization==="Bearer "+cronSecret);
 if(!authorized&&schedulerToken){
  try{authorized=Boolean(await rpc("verify_kingshot_scheduler_token",{p_token:String(schedulerToken)}))}catch{}
 }
 if(!authorized)return res.status(401).json({error:"Unauthorized"});

 // Manual diagnostic mode: validate every registered player against MightPulse
 // without discovering codes, claiming redemptions, or starting worker shards.
 if(mode==="kingdom-check"){
  let manualWorkerToken=null;
  try{
   // Reuse the global worker lock so a manual validation cannot overlap a
   // scheduled redemption cycle. This mode never discovers codes or redeems.
   const lock=await rpc("claim_kingshot_worker_run",{});
   if(!lock?.claimed)return res.status(200).json({ok:true,mode:"kingdom-check",skipped:true,reason:"WORKER_ALREADY_RUNNING"});
   manualWorkerToken=lock.token;
   await rpc("heartbeat_kingshot_worker_run",{p_token:manualWorkerToken}).catch(()=>{});

   const players=await rpc("list_kingshot_autoredeem_players",{});
   const list=Array.isArray(players)?players:[];
   const results=await runWithConcurrency(list,player=>revalidatePlayer(player,{force:true}),KINGDOM_VALIDATION_CONCURRENCY);
   const summary=results.reduce((a,result)=>{
    if(result?.revalidationError){a.errors++;return a;}
    if(result?.stale){a.stale++;return a;}
    if(result?.revalidated)a.checked++;
    if(result?.kingdomChanged)a.changed++;
    if(result?.player?.kingdom_id)a.validated++;
    return a;
   },{checked:0,changed:0,stale:0,errors:0,validated:0});
   const status=summary.errors||summary.stale?"COMPLETED_WITH_WARNINGS":"COMPLETED";
   await rpc("finish_kingshot_worker_run",{
    p_token:manualWorkerToken,
    p_status:status,
    p_error:null,
    p_summary:{mode:"kingdom-check",players:list.length,...summary}
   }).catch(error=>console.error("Manual worker state update failed:",error?.message||error));
   manualWorkerToken=null;
   console.log("Kingshot manual kingdom check:",{players:list.length,...summary});
   await sendDiscordEvent({title:"🔍 Manual kingdom check",description:"A forced kingdom revalidation completed without starting redemption.",fields:[
    {name:"Players",value:String(list.length),inline:true},
    {name:"Checked",value:String(summary.checked),inline:true},
    {name:"Kingdom changes",value:String(summary.changed),inline:true},
    {name:"Stale accounts",value:String(summary.stale),inline:true},
    {name:"Errors",value:String(summary.errors),inline:true},
    {name:"Validated",value:String(summary.validated),inline:true}
   ],color:summary.errors||summary.stale?0xFEE75C:0x57F287});
   return res.status(200).json({ok:true,mode:"kingdom-check",forced:true,...summary,players:list.length});
  }catch(error){
   console.error("Manual kingdom check failed:",error);
   if(manualWorkerToken)await rpc("finish_kingshot_worker_run",{p_token:manualWorkerToken,p_status:"FAILED",p_error:error?.message||"Manual kingdom check failed.",p_summary:{mode:"kingdom-check",errorCategory:classifyError(error)}}).catch(releaseError=>console.error("Manual worker failure state update failed:",releaseError?.message||releaseError));
   return res.status(502).json({ok:false,mode:"kingdom-check",error:error?.message||"Manual kingdom check failed.",errorCategory:classifyError(error)});
  }
 }

 let workerToken=null;
 try{
  const lock=await rpc("claim_kingshot_worker_run",{});
  if(!lock?.claimed)return res.status(200).json({ok:true,skipped:true,reason:"WORKER_ALREADY_RUNNING"});
  workerToken=lock.token;
  await rpc("heartbeat_kingshot_worker_run",{p_token:workerToken}).catch(()=>{});
  const [apiSource,pageSource,publicSources,adminRows]=await Promise.all([
   fetchSource(GIFT_SOURCE_URL,"api"),
   fetchSource("https://kingshot.net/gift-codes","page"),
   Promise.all(PUBLIC_GIFT_SOURCES.map(source=>fetchSource(source.url,"public:"+source.name))),
   rpc("list_kingshot_admin_gift_codes",{})
  ]);
  const data=apiSource.data;
  const apiCodes=apiSource.codes;
  const pageCodes=pageSource.codes;
  const publicCodes=publicSources.flatMap((result,index)=>result.codes.length?result.codes.map(row=>({...row,source:PUBLIC_GIFT_SOURCES[index].name})):[]);
  const adminCodes=(Array.isArray(adminRows)?adminRows:[]).filter(row=>row?.active!==false).map(row=>({
   code:String(row?.code||"").trim(),
   expiresAt:null,
   createdAt:row?.source_date?Date.parse(String(row.source_date)):Date.parse(String(row?.first_seen_at||"")),
   source:"admin",
   adminAdded:Boolean(row?.admin_added)
  })).filter(row=>row.code&&row.code.length>=6&&row.code.length<=32);
  let codes=mergeCodes([apiCodes,pageCodes,publicCodes,VERIFIED_FALLBACK_CODES,adminCodes]);
  if(!codes.length)throw Error("Kingshot gift-code sources returned no active codes.");
  console.log("Kingshot auto feed:",{apiActive:data?.data?.activeCount??null,apiCodes:apiCodes.map(x=>x.code),pageCodes:pageCodes.map(x=>x.code),publicSources:publicCodes.map(x=>({code:x.code,source:x.source})),adminCodes:adminCodes.map(x=>x.code),merged:codes.map(x=>x.code)});
  const knownCodes=new Set((Array.isArray(adminRows)?adminRows:[]).map(row=>String(row?.code||"").toUpperCase()));

  const persistedCodeRows=await Promise.all(codes.map(item=>rpc("upsert_kingshot_gift_code",{
   p_code:item.code,
   p_source_date:item.createdAt&&!Number.isNaN(item.createdAt)?new Date(item.createdAt).toISOString().slice(0,10):null,
   p_expires_at:item.expiresAt&&!Number.isNaN(item.expiresAt)?new Date(item.expiresAt).toISOString():null
  })));
  const firstSeenByCode=new Map(persistedCodeRows.map(row=>[String(row?.code||"").toUpperCase(),row?.first_seen_at||null]));
  codes=codes.map(item=>({...item,firstSeenAt:firstSeenByCode.get(String(item.code).toUpperCase())||null}));
  const expiredRows=await rpc("list_kingshot_expired_gift_codes",{}).catch(error=>{
   console.error("Expired-code lookup failed:",error?.message||error);
   return [];
  });
  const expiredCodes=new Set((Array.isArray(expiredRows)?expiredRows:[])
   .map(row=>String(row?.gift_code||"").trim().toUpperCase())
   .filter(Boolean));
  const now=Date.now();
  const activeCodes=codes.filter(item=>{
   const sourceExpired=item.expiresAt&&!Number.isNaN(item.expiresAt)&&item.expiresAt<=now;
   return !sourceExpired&&!expiredCodes.has(item.code.toUpperCase());
  });
  console.log("Kingshot auto expiry filter:",{
   discovered:codes.length,
   expired:expiredCodes.size,
   filtered:codes.length-activeCodes.length,
   expiredCodes:[...expiredCodes].slice(0,50),
   sourceExpiredCodes:codes.filter(item=>item.expiresAt&&!Number.isNaN(item.expiresAt)&&item.expiresAt<=now).map(item=>item.code).slice(0,50),
   remaining:activeCodes.map(x=>x.code)
  });
  const newCodes=activeCodes.filter(item=>!knownCodes.has(String(item.code).toUpperCase()));
  for(const item of newCodes)await sendDiscordEvent({title:"🎁 New Kingshot gift code",description:"A new active gift code was discovered by the multi-source scraper.",fields:[{name:"Gift code",value:String(item.code),inline:true},{name:"Sources",value:String((item.sources||[item.source||"merged"]).join(", ")),inline:true},{name:"Confidence",value:Math.round(Number(item.confidence||0)*100)+"% "+String(item.confidenceTier||"unverified"),inline:true},{name:"Expires",value:item.expiresAt&&!Number.isNaN(item.expiresAt)?new Date(item.expiresAt).toISOString():"Not specified",inline:true}]});
  const players=await rpc("list_kingshot_autoredeem_players",{});
  const list=Array.isArray(players)?players:[];

  // Phase 1: kingdom revalidation is completed BEFORE any redemption worker
  // starts. This prevents the 05:30 IST reset burst from competing with the
  // three redemption shards for Supabase/MightPulse capacity.
  await rpc("heartbeat_kingshot_worker_run",{p_token:workerToken}).catch(()=>{});
  const kingdomResults=await runWithConcurrency(list,player=>revalidatePlayer(player),KINGDOM_VALIDATION_CONCURRENCY);
  const validPlayers=[];
  const kingdomSummary=kingdomResults.reduce((a,result)=>{
   if(result?.revalidationError){
    a.errors++;
    return a;
   }
   if(result?.stale){a.stale++;return a;}
   if(result?.revalidated)a.checked++;
   if(result?.kingdomChanged)a.changed++;
   if(result?.player?.kingdom_id)validPlayers.push(result.player);
   return a;
  },{checked:0,changed:0,stale:0,errors:0});
  console.log("Kingshot kingdom check:",{players:list.length,...kingdomSummary,validPlayers:validPlayers.length});

  if(kingdomSummary.checked||kingdomSummary.changed||kingdomSummary.stale||kingdomSummary.errors){
   await sendDiscordEvent({
    title:"🔍 Kingdom check",
    description:"Kingdom revalidation completed before the redemption worker pool started.",
    fields:[
     {name:"Players checked",value:String(kingdomSummary.checked),inline:true},
     {name:"Kingdom changes",value:String(kingdomSummary.changed),inline:true},
     {name:"Stale accounts",value:String(kingdomSummary.stale),inline:true},
     {name:"Check errors",value:String(kingdomSummary.errors),inline:true},
     {name:"Validated for redemption",value:String(validPlayers.length),inline:true}
    ],
    color:kingdomSummary.errors||kingdomSummary.stale?0xFEE75C:0x57F287
   });
  }

  // Phase 2: only the already-validated players enter the redemption pool.
  const workerUrlBase="https://"+(req.headers["x-forwarded-host"]||req.headers.host||"kingshot-autoredeemer.vercel.app")+"/api/kingshot-auto?mode=worker&slot=";
  const childHeaders={"content-type":"application/json"};
  if(cronSecret)childHeaders.authorization="Bearer "+cronSecret;
  else if(schedulerToken)childHeaders["x-kingshot-scheduler-token"]=String(schedulerToken);
  else throw Error("No internal worker authorization is configured.");

  const assignments=Array.from({length:WORKER_COUNT},()=>[]);
  for(const player of validPlayers)assignments[workerBucket(player?.player_id)].push(player);
  await rpc("heartbeat_kingshot_worker_run",{p_token:workerToken}).catch(()=>{});
  const workerRuns=await Promise.all(assignments.map(async(assigned,workerIndex)=>{
   try{
    const response=await fetch(workerUrlBase+workerIndex,{
     method:"POST",
     headers:childHeaders,
     body:JSON.stringify({codes:activeCodes,players:assigned}),
     signal:AbortSignal.timeout(120000)
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(payload?.error||"Worker shard returned HTTP "+response.status);
    return payload;
   }catch(error){
    console.error("Kingshot worker fan-out failed:",workerIndex,error?.message||error);
    return {slot:workerIndex,claimed:false,error:error?.message||"Worker shard failed.",errorCategory:classifyError(error),players:assigned.length};
   }
  }));
  const workerFailures=workerRuns.filter(result=>result?.error||result?.claimed===false&&result?.reason!=="SLOT_ALREADY_RUNNING");
  const totals=workerRuns.reduce((a,r)=>{
   a.attempted+=(r?.attempted||0);a.success+=(r?.success||0);a.alreadyReceived+=(r?.alreadyReceived||0);a.alreadyHandled+=(r?.alreadyHandled||0);a.skipped+=(r?.skipped||0);a.errors+=(r?.errors||0)+(r?.error?1:0);a.deadlineSkipped+=(r?.deadlineSkipped||0);return a;
  },{attempted:0,success:0,alreadyReceived:0,alreadyHandled:0,skipped:0,errors:0,stale:0,deadlineSkipped:0,kingdomChecks:kingdomSummary.checked,kingdomChanges:kingdomSummary.changed});
  const topRedemptionFailures=workerRuns.flatMap(result=>Array.isArray(result?.redemptionFailures)?result.redemptionFailures:[]);
  const workerErrorDiagnostics=Object.values(workerRuns.flatMap(result=>Array.isArray(result?.workerErrors)?result.workerErrors:[])
   .reduce((map,item)=>{
    const key=String(item.category||"UNKNOWN")+" / "+String(item.message||"Player processing failed.");
    const existing=map[key]||{count:0,category:String(item.category||"UNKNOWN"),message:String(item.message||"Player processing failed.")};
    existing.count+=Number(item.count||0);
    map[key]=existing;
    return map;
   },{})).sort((a,b)=>b.count-a.count).slice(0,8);
  const codeCounts=workerRuns.reduce((map,r)=>{
 for(const [key,count] of Object.entries(r?.codeCounts||{}))map[key]=(map[key]||0)+Number(count||0);
 return map;
},{});
  const codeTelemetry=workerRuns.reduce((map,r)=>{
   for(const [code,value] of Object.entries(r?.codeTelemetry||{})){
    const existing=map[code]||{attempts:0,successes:0,firstResultAt:null,firstSuccessAt:null,firstResultLatencyMs:null,totalRedemptionLatencyMs:0};
    existing.attempts+=Number(value?.attempts||0);
    existing.successes+=Number(value?.successes||0);
    if(value?.firstResultAt&&(!existing.firstResultAt||value.firstResultAt<existing.firstResultAt)){existing.firstResultAt=value.firstResultAt;existing.firstResultLatencyMs=value.firstResultLatencyMs??null;}
    if(value?.firstSuccessAt&&(!existing.firstSuccessAt||value.firstSuccessAt<existing.firstSuccessAt))existing.firstSuccessAt=value.firstSuccessAt;
    existing.totalRedemptionLatencyMs+=Number(value?.avgRedemptionLatencyMs||0)*Number(value?.attempts||0);
    map[code]=existing;
   }
   return map;
  },{});
  for(const value of Object.values(codeTelemetry)){value.avgRedemptionLatencyMs=value.attempts?Math.round(value.totalRedemptionLatencyMs/value.attempts):null;delete value.totalRedemptionLatencyMs;}
  const sourceResults=[apiSource,pageSource,...publicSources];
  const healthySources=sourceResults.filter(x=>x?.ok).length;
  const sourceCount=sourceResults.length;
  const sourceHealthPct=sourceCount?Math.round(healthySources/sourceCount*100):0;
  const cycleDurationMs=Math.max(0,Date.now()-cycleStartedAt);
  const mergedFailures=Object.values(topRedemptionFailures.reduce((map,item)=>{
   const key=String(item.category)+"/"+String(item.errCode)+"/"+String(item.status);
   const current=map[key]||{...item,count:0};
   current.count+=Number(item.count||0);
   map[key]=current;
   return map;
  },{})).sort((x,y)=>y.count-x.count).slice(0,8);
  console.log("Kingshot auto worker pool:",{workers:WORKER_COUNT,assignments:assignments.map(x=>x.length),workerFailures:workerFailures.length,attempted:totals.attempted,success:totals.success,workerErrors:workerErrorDiagnostics,redemptionFailures:mergedFailures});
  const summary={source:"multi-source",sources:sourceResults.length,workers:WORKER_COUNT,codes:activeCodes.length,discoveredCodes:codes.length,expiredCodesFiltered:codes.length-activeCodes.length,players:list.length,validatedPlayers:validPlayers.length,...totals,workerFailures:workerFailures.length,workerErrors:workerErrorDiagnostics,redemptionFailures:mergedFailures,codeTelemetry};
  await rpc("finish_kingshot_worker_run",{p_token:workerToken,p_status:totals.errors||totals.stale?"COMPLETED_WITH_WARNINGS":"COMPLETED",p_error:null,p_summary:summary}).catch(error=>console.error("Worker state update failed:",error?.message||error));
  const anomalyReasons=[];
  if(totals.errors||workerFailures.length)anomalyReasons.push("worker errors");
  if(totals.deadlineSkipped)anomalyReasons.push("deadline deferrals");
  if(!activeCodes.length)anomalyReasons.push("no active codes");
  if(sourceHealthPct<50)anomalyReasons.push("scraper source health below 50%");
  if(list.length&&validPlayers.length<Math.floor(list.length*0.7))anomalyReasons.push("over 30% of players failed validation");
  const statusMap=workerRuns.reduce((map,r)=>{for(const [status,count] of Object.entries(r?.redemptionStatuses||{}))map[status]=(map[status]||0)+count;return map},{});
  if(anomalyReasons.length)await sendDiscordEvent({title:"🚨 Auto-redeem anomaly detected",description:anomalyReasons.join(" · "),fields:[
   {name:"Reasons",value:anomalyReasons.join("\n"),inline:false},
   {name:"Cycle runtime",value:(cycleDurationMs/1000).toFixed(1)+"s",inline:true},
   {name:"Source health",value:healthySources+"/"+sourceCount+" healthy",inline:true},
   {name:"Validated",value:String(validPlayers.length)+"/"+String(list.length),inline:true},
   {name:"Worker diagnostics",value:workerErrorDiagnostics.length?workerErrorDiagnostics.map(x=>x.category+" · "+x.message+" · x"+x.count).join("\n").slice(0,1024):"None",inline:false}
  ],color:0xED4245});
  if(totals.attempted||totals.errors||totals.stale||workerFailures.length||newCodes.length)await sendDiscordEvent({title:"📊 Auto-redeem cycle",description:"Scheduled Kingshot worker pool completed a cycle with activity.",fields:[{name:"Players",value:String(list.length),inline:true},{name:"Validated",value:String(validPlayers.length),inline:true},{name:"Workers",value:String(WORKER_COUNT),inline:true},{name:"Codes",value:String(activeCodes.length),inline:true},{name:"Attempts",value:String(totals.attempted),inline:true},{name:"Successes",value:String(totals.success),inline:true},{name:"Already received",value:String(totals.alreadyReceived),inline:true},{name:"Already redeemed/handled",value:String(totals.alreadyHandled),inline:true},{name:"Errors",value:String(totals.errors),inline:true},{name:"Stale",value:String(totals.stale),inline:true},{name:"Worker failures",value:String(workerFailures.length),inline:true},{name:"Deferred by deadline",value:String(totals.deadlineSkipped),inline:true},{name:"Runtime",value:(cycleDurationMs/1000).toFixed(1)+"s",inline:true},{name:"Sources",value:healthySources+"/"+sourceCount+" healthy",inline:true},{name:"Redemption statuses",value:Object.entries(workerRuns.reduce((map,r)=>{for(const [status,count] of Object.entries(r?.redemptionStatuses||{}))map[status]=(map[status]||0)+count;return map},{})).map(([status,count])=>`${status}: ${count}`).join("\n").slice(0,1024)||"None",inline:false},{name:"Code breakdown",value:Object.entries(codeCounts).filter(([k])=>!k.includes("_status_")).map(([code,count])=>`${code}: ${count} handled`).join("\n").slice(0,1024)||"None",inline:false},{name:"Speed telemetry",value:Object.entries(codeTelemetry).filter(([code])=>newCodes.some(item=>item.code===code)).map(([code,t])=>code+": first API result "+(t.firstResultLatencyMs!=null?(t.firstResultLatencyMs/1000).toFixed(1)+"s":"—")+" · "+(t.avgRedemptionLatencyMs!=null?(t.avgRedemptionLatencyMs/1000).toFixed(1)+"s avg API":"—")+(t.firstSuccessAt?" · first SUCCESS":" · no SUCCESS")).join("\n").slice(0,1024)||"None",inline:false},{name:"Redemption failures",value:mergedFailures.length?mergedFailures.map(x=>`${x.category}/${x.errCode}/${x.status}: ${x.count}`).join("\n").slice(0,1024):"None",inline:false},{name:"Worker diagnostics",value:workerErrorDiagnostics.length?workerErrorDiagnostics.map(x=>x.category+" · "+x.message+" · x"+x.count).join("\n").slice(0,1024):"None",inline:false}],color:totals.errors||totals.stale||workerFailures.length?0xFEE75C:0x57F287});
  return res.status(200).json({ok:true,...summary});
 }catch(e){
  console.error("Kingshot auto redeem:",e);
  if(workerToken)await rpc("finish_kingshot_worker_run",{p_token:workerToken,p_status:"FAILED",p_error:e?.message||"Auto redemption failed.",p_summary:{errorCategory:classifyError(e)}}).catch(error=>console.error("Worker failure state update failed:",error?.message||error));
  await sendDiscordEvent({title:"❌ Auto-redeem worker error",description:e?.message||"Auto redemption failed.",color:0xED4245});
  return res.status(502).json({error:e.message||"Auto redemption failed.",errorCategory:classifyError(e)});
 }
}
