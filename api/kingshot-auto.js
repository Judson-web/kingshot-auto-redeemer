import {redeemKingshot} from"../internal/kingshot/redeem.js";
import { revalidatePlayer } from "../internal/kingshot/kingdom-validation.js";

const SUPABASE_URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const GIFT_SOURCE_URL="https://kingshot.net/api/gift-codes";
const PUBLIC_GIFT_SOURCES=[
 // Disabled: source repeatedly returned HTTP 200 but no parseable active codes.
 {name:"kingshot-guides",url:"https://kingshotguides.com/guide/active-giftcodes-and-how-to-redeem/"},
 {name:"beebom",url:"https://beebom.com/kingshot-codes/"},
 {name:"kingshotmastery",url:"https://kingshotmastery.com/gift-codes"},
 {name:"pocketgamer",url:"https://www.pocketgamer.com/kingshot/codes/"}
];
// Verified long-running fallback for codes that have been omitted from the upstream API feed.
// Revalidated against public Kingshot code listings; the redemption endpoint remains the final authority.
const VERIFIED_FALLBACK_CODES=[{code:"VIP777",expiresAt:Date.parse("2026-12-31T23:59:59Z"),createdAt:Date.parse("2026-08-03T00:00:00Z")},{code:"Hangul2026",expiresAt:null,createdAt:Date.parse("2026-10-09T00:00:00Z"),source:"verified-manual-fallback"}];

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
const KINGDOM_VALIDATION_CONCURRENCY=3;
const WORKER_MAX_RUNTIME_MS=4*60*1000;
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

import { fetchSource, classifyScraperError } from "../internal/kingshot/scraper.js";
import { runWithConcurrency, runWorkerShard, workerBucket } from "../internal/kingshot/worker.js";
async function redeemForPlayer(player,codes){
const kingdomState=await revalidatePlayer(player,{rpc,notify:sendDiscordEvent});
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

 const discoveryAt=Number.isFinite(item.discoveredAt)?item.discoveredAt:null;
 const redemptionTelemetry={code:item.code,resultAt:new Date(completedAt).toISOString(),status,redemptionLatencyMs:Math.max(0,completedAt-redemptionStartedAt),discoveryToResultMs:discoveryAt==null?null:Math.max(0,completedAt-discoveryAt)};
 return {attempted:1,success:status==="SUCCESS"?1:0,alreadyReceived:status==="RECEIVED"?1:0,alreadyHandled:0,skipped:0,kingdomCheck,kingdomChanged,redemptionCode:item.code,redemptionStatus:status,redemptionErrorCategory:d?.errorCategory||null,redemptionErrCode:d?.errCode??null,redemptionMessage:message?String(message).slice(0,240):null,redemptionTelemetry};
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
   const result=await runWorkerShard(slot,codes,players,{rpc,redeemForPlayer},{workerCount:WORKER_COUNT,concurrency:PLAYER_CONCURRENCY,maxRuntimeMs:WORKER_MAX_RUNTIME_MS});
   return res.status(200).json({ok:true,...result});
  }catch(error){
   console.error("Kingshot worker shard:",slot,error);
   return res.status(502).json({error:error?.message||"Worker shard failed.",errorCategory:classifyScraperError(error),slot});
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
   const results=await runWithConcurrency(list,player=>revalidatePlayer(player,{rpc,notify:sendDiscordEvent},{force:true}),KINGDOM_VALIDATION_CONCURRENCY);
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
   if(manualWorkerToken)await rpc("finish_kingshot_worker_run",{p_token:manualWorkerToken,p_status:"FAILED",p_error:error?.message||"Manual kingdom check failed.",p_summary:{mode:"kingdom-check",errorCategory:classifyScraperError(error)}}).catch(releaseError=>console.error("Manual worker failure state update failed:",releaseError?.message||releaseError));
   return res.status(502).json({ok:false,mode:"kingdom-check",error:error?.message||"Manual kingdom check failed.",errorCategory:classifyScraperError(error)});
  }
 }

 let workerToken=null;
 try{
  const lock=await rpc("claim_kingshot_worker_run",{});
  if(!lock?.claimed)return res.status(200).json({ok:true,skipped:true,reason:"WORKER_ALREADY_RUNNING"});
  workerToken=lock.token;
  await rpc("heartbeat_kingshot_worker_run",{p_token:workerToken}).catch(()=>{});
  const [apiSource,pageSource,publicSources,adminRows]=await Promise.all([
   fetchSource(rpc,GIFT_SOURCE_URL,"api"),
   fetchSource(rpc,"https://kingshot.net/gift-codes","page"),
   Promise.all(PUBLIC_GIFT_SOURCES.map(source=>fetchSource(rpc,source.url,"public:"+source.name))),
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
  const codesDiscoveredAt=Date.now();
  console.log("Kingshot auto feed:",{apiActive:data?.data?.activeCount??null,apiCodes:apiCodes.map(x=>x.code),pageCodes:pageCodes.map(x=>x.code),publicSources:publicCodes.map(x=>({code:x.code,source:x.source})),adminCodes:adminCodes.map(x=>x.code),merged:codes.map(x=>x.code)});
  const knownCodes=new Set((Array.isArray(adminRows)?adminRows:[]).map(row=>String(row?.code||"").toUpperCase()));

  const persistedCodeRows=await Promise.all(codes.map(item=>rpc("upsert_kingshot_gift_code",{
   p_code:item.code,
   p_source_date:item.createdAt&&!Number.isNaN(item.createdAt)?new Date(item.createdAt).toISOString().slice(0,10):null,
   p_expires_at:item.expiresAt&&!Number.isNaN(item.expiresAt)?new Date(item.expiresAt).toISOString():null
  })));
  codes=codes.map(item=>({...item,discoveredAt:codesDiscoveredAt}));
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
  const kingdomResults=await runWithConcurrency(list,player=>revalidatePlayer(player,{rpc,notify:sendDiscordEvent}),KINGDOM_VALIDATION_CONCURRENCY);
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
  for(const player of validPlayers)assignments[workerBucket(player?.player_id,WORKER_COUNT)].push(player);
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
    return {slot:workerIndex,claimed:false,error:error?.message||"Worker shard failed.",errorCategory:classifyScraperError(error),players:assigned.length};
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
  if(totals.attempted||totals.errors||totals.stale||workerFailures.length||newCodes.length)await sendDiscordEvent({title:"📊 Auto-redeem cycle",description:"Scheduled Kingshot worker pool completed a cycle with activity.",fields:[{name:"Players",value:String(list.length),inline:true},{name:"Validated",value:String(validPlayers.length),inline:true},{name:"Workers",value:String(WORKER_COUNT),inline:true},{name:"Codes",value:String(activeCodes.length),inline:true},{name:"Attempts",value:String(totals.attempted),inline:true},{name:"Successes",value:String(totals.success),inline:true},{name:"Already received",value:String(totals.alreadyReceived),inline:true},{name:"Already redeemed/handled",value:String(totals.alreadyHandled),inline:true},{name:"Errors",value:String(totals.errors),inline:true},{name:"Stale",value:String(totals.stale),inline:true},{name:"Worker failures",value:String(workerFailures.length),inline:true},{name:"Deferred by deadline",value:String(totals.deadlineSkipped),inline:true},{name:"Runtime",value:(cycleDurationMs/1000).toFixed(1)+"s",inline:true},{name:"Sources",value:healthySources+"/"+sourceCount+" healthy",inline:true},{name:"Redemption statuses",value:Object.entries(workerRuns.reduce((map,r)=>{for(const [status,count] of Object.entries(r?.redemptionStatuses||{}))map[status]=(map[status]||0)+count;return map},{})).map(([status,count])=>`${status}: ${count}`).join("\n").slice(0,1024)||"None",inline:false},{name:"Code breakdown",value:Object.entries(codeCounts).filter(([k])=>!k.includes("_status_")).map(([code,count])=>`${code}: ${count} handled`).join("\n").slice(0,1024)||"None",inline:false},{name:"Speed telemetry",value:Object.entries(codeTelemetry).filter(([,t])=>Number(t?.attempts||0)>0).map(([code,t])=>code+": first result "+(t.firstResultLatencyMs!=null?(t.firstResultLatencyMs/1000).toFixed(1)+"s":"—")+" · "+(t.avgRedemptionLatencyMs!=null?(t.avgRedemptionLatencyMs/1000).toFixed(1)+"s avg API":"—")+(t.firstSuccessAt?" · first SUCCESS":" · no SUCCESS")).join("\n").slice(0,1024)||"None",inline:false},{name:"Redemption failures",value:mergedFailures.length?mergedFailures.map(x=>`${x.category}/${x.errCode}/${x.status}: ${x.count}`).join("\n").slice(0,1024):"None",inline:false},{name:"Worker diagnostics",value:workerErrorDiagnostics.length?workerErrorDiagnostics.map(x=>x.category+" · "+x.message+" · x"+x.count).join("\n").slice(0,1024):"None",inline:false}],color:totals.errors||totals.stale||workerFailures.length?0xFEE75C:0x57F287});
  return res.status(200).json({ok:true,...summary});
 }catch(e){
  console.error("Kingshot auto redeem:",e);
  if(workerToken)await rpc("finish_kingshot_worker_run",{p_token:workerToken,p_status:"FAILED",p_error:e?.message||"Auto redemption failed.",p_summary:{errorCategory:classifyScraperError(e)}}).catch(error=>console.error("Worker failure state update failed:",error?.message||error));
  await sendDiscordEvent({title:"❌ Auto-redeem worker error",description:e?.message||"Auto redemption failed.",color:0xED4245});
  return res.status(502).json({error:e.message||"Auto redemption failed.",errorCategory:classifyScraperError(e)});
 }
}
