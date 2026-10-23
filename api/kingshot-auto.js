import { neon } from "@neondatabase/serverless";
import {redeemKingshot} from"../internal/kingshot/redeem.js";
import { revalidatePlayer, needsKingdomResetCheck } from "../internal/kingshot/kingdom-validation.js";
import { selectKingdomCheckBatch, selectScheduledKingdomCheckBatch, summarizeKingdomCheckResults } from "../internal/kingshot/kingdom-check-flow.js";
import { broadcastPush } from "../internal/push-notifications.js";
import { buildNewGiftCodeAlert, buildGiftCodeValidationAlert, buildGiftCodeVerificationErrorAlert } from "../lib/discord-gift-code-alerts.js";

const SUPABASE_URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const APP_ORIGIN=process.env.VERCEL_ENV==="production"&&process.env.VERCEL_PROJECT_PRODUCTION_URL?"https://"+process.env.VERCEL_PROJECT_PRODUCTION_URL:process.env.VERCEL_URL?"https://"+process.env.VERCEL_URL:"https://kingshot-autoredeemer.vercel.app";
const GIFT_SOURCE_URL="https://kingshot.net/api/gift-codes";
const PUBLIC_GIFT_SOURCES=[
 // Keep only sources whose active-code sections have a useful signal-to-noise ratio.
 {name:"beebom",url:"https://beebom.com/kingshot-codes/"},
 {name:"pocketgamer",url:"https://www.pocketgamer.com/kingshot/codes/"}
];
// Verified long-running fallback for codes that have been omitted from the upstream API feed.
// Revalidated against public Kingshot code listings; the redemption endpoint remains the final authority.
const VERIFIED_FALLBACK_CODES=[{code:"VIP777",expiresAt:Date.parse("2026-12-31T23:59:59Z"),createdAt:Date.parse("2026-08-03T00:00:00Z"),source:"verified-manual-fallback"},{code:"Hangul2026",expiresAt:null,createdAt:Date.parse("2026-10-09T00:00:00Z"),source:"verified-manual-fallback"}];

if(!SUPABASE_KEY)throw Error("Supabase service key is not configured on the server.");

// Retry only known idempotent reads. Redemption claims, result writes, worker
// leases and all other mutations must never be replayed automatically.
const RETRYABLE_READ_RPCS=new Set([
 "verify_kingshot_scheduler_token",
 "kingshot_get_source_cooldown",
 "list_kingshot_admin_gift_codes",
 "list_kingshot_autoredeem_players",
 "list_kingshot_player_redemptions",
 "list_kingshot_player_redemptions_bulk",
 "list_kingshot_expired_gift_codes",
 "list_kingshot_redemption_recovery_queue"
]);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function rpc(name,body){
 const maxAttempts=RETRYABLE_READ_RPCS.has(name)?2:1;
 let lastError;
 for(let attempt=1;attempt<=maxAttempts;attempt++){
  const startedAt=Date.now();
  let r;
  try{
   r=await fetch(SUPABASE_URL+"/rest/v1/rpc/"+name,{method:"POST",headers:{"apikey":SUPABASE_KEY,"authorization":"Bearer "+SUPABASE_KEY,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  }catch(error){
   lastError=error;
   if(attempt<maxAttempts){
    console.warn("Supabase read RPC transport retry:",{operation:name,attempt,maxAttempts,durationMs:Date.now()-startedAt,errorName:error?.name||null});
    await sleep(250*attempt);
    continue;
   }
   console.error("Supabase RPC transport failed:",{operation:name,attempt,durationMs:Date.now()-startedAt,errorName:error?.name||null,message:String(error?.message||error).slice(0,200)});
   throw error;
  }
  const durationMs=Date.now()-startedAt;
  if(durationMs>=1500)console.warn("Supabase RPC slow:",{operation:name,durationMs,status:r.status,attempt});
  const d=await r.json().catch(()=>null);
  if(!r.ok){
   const code=typeof d?.code==="string"?d.code.slice(0,40):null;
   const message=String(d?.message||d?.error_description||"Supabase request failed").replace(/\s+/g," ").trim().slice(0,240);
   if(attempt<maxAttempts&&(r.status===429||r.status>=500)){
    console.warn("Supabase read RPC response retry:",{operation:name,status:r.status,attempt,maxAttempts,code});
    await sleep(250*attempt);
    continue;
   }
   // Keep operation, HTTP status, and PostgreSQL/PostgREST code for diagnosis.
   // Do not log request bodies, player identifiers, codes, or authorization headers.
   console.error("Supabase RPC failed:",{operation:name,status:r.status,code,message,attempt});
   throw Error("Supabase RPC "+name+" failed (HTTP "+r.status+(code?", code "+code:"")+"): "+message);
  }
  return d;
 }
 throw lastError||Error("Supabase RPC "+name+" failed after retries.");
}

import {extractPageCodes, extractPublicSourceCodes, mergeCodes, normalizeCodes, isCredibleGiftCodeCandidate, isCanaryEligibleGiftCodeCandidate} from "../internal/kingshot/gift-codes.js";
import { getHandledGiftCodes, selectNextOutstandingCode } from "../internal/kingshot/redemption-history.js";
const WORKER_COUNT=4;
// Four durable shards × two concurrent redemptions keep each shard small while bounding upstream pressure.
const PLAYER_CONCURRENCY=2;
const KINGDOM_VALIDATION_CONCURRENCY=3;
const KINGDOM_SCHEDULED_VALIDATION_BATCH_SIZE=6;
// Temporary operational switch: disable background Kingdom Check without disabling redemption.
// Manual mode=kingdom-check intentionally bypasses this flag.
const KINGDOM_AUTO_CHECK_ENABLED=String(process.env.KINGDOM_AUTO_CHECK_ENABLED??"true").trim().toLowerCase()!=="false";
const MANUAL_KINGDOM_VALIDATION_CONCURRENCY=2;
const WORKER_MAX_RUNTIME_MS=3*60*1000;
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
async function recordRedemptionSafely(rpcClient,payload){
 let lastError;
 for(let attempt=1;attempt<=2;attempt++){
  try{
   return await rpcClient("record_kingshot_redemption",payload);
  }catch(error){
   lastError=error;
   console.error("Redemption result persistence failed:",{attempt,maxAttempts:2,status:String(payload?.p_status||"UNKNOWN"),error:String(error?.message||error).slice(0,200)});
   if(attempt<2)await new Promise(resolve=>setTimeout(resolve,250));
  }
 }
 // Never repeat the upstream redemption just because persistence failed: its
 // outcome may already have consumed the code. Fail closed and surface the
 // persistence failure for operator follow-up.
 throw new Error("Redemption outcome could not be durably recorded after retry: "+String(lastError?.message||lastError).slice(0,180));
}

const NEON_RECOVERY_URL=String(process.env.NEON_RECOVERY_DATABASE_URL||"").trim();
const neonJournal=NEON_RECOVERY_URL?neon(NEON_RECOVERY_URL):null;
async function journalStart(playerId,code){
 if(!neonJournal)throw new Error("Independent recovery journal is not configured; refusing redemption.");
 const rows=await neonJournal.query("insert into public.redemption_journal(player_id,gift_code,state) values($1,$2,'in_flight') on conflict(player_id,gift_code) do update set state='in_flight',status=null,err_code=null,message=null,last_error=null,updated_at=now() where public.redemption_journal.state in ('supabase_recorded','cancelled') returning id",[String(playerId),String(code)]);
 if(!rows.length)throw new Error("Recovery journal already has an unresolved attempt; redemption blocked.");
 return rows[0].id;
}
async function journalCancel(playerId,code,reason){
 if(!neonJournal)return;
 await neonJournal.query("update public.redemption_journal set state='cancelled',last_error=$3,updated_at=now() where player_id=$1 and upper(gift_code)=upper($2) and state='in_flight'",[String(playerId),String(code),String(reason||"Supabase claim declined").slice(0,240)]);
}
async function journalResult(playerId,code,status,errCode,message){
 if(!neonJournal)throw new Error("Independent recovery journal unavailable after upstream response; operator review required.");
 await neonJournal.query("update public.redemption_journal set state='result_recorded',status=$3,err_code=$4,message=$5,updated_at=now(),last_error=null where player_id=$1 and upper(gift_code)=upper($2) and state='in_flight'",[String(playerId),String(code),String(status),errCode??null,String(message||"").slice(0,240)]);
}
async function drainNeonRecoveryJournal(rpcClient){
 if(!neonJournal)return {disabled:true,recovered:0,failed:0};
 const rows=await neonJournal.query("select id,player_id,gift_code,status,err_code,message from public.redemption_journal where state='result_recorded' order by updated_at asc limit 50");
 let recovered=0,failed=0;
 for(const row of rows){
  try{
   await recordRedemptionSafely(rpcClient,{p_player_id:String(row.player_id),p_code:String(row.gift_code),p_status:String(row.status),p_err_code:row.err_code??null,p_message:String(row.message||"Recovered from independent Neon journal")});
   await neonJournal.query("update public.redemption_journal set state='supabase_recorded',attempts=attempts+1,last_error=null,updated_at=now() where id=$1",[row.id]);recovered++;
  }catch(error){
   await neonJournal.query("update public.redemption_journal set attempts=attempts+1,last_error=$2,updated_at=now() where id=$1",[row.id,String(error?.message||error).slice(0,240)]).catch(()=>{});failed++;
  }
 }
 if(rows.length)console.warn("Neon redemption journal recovery:",{found:rows.length,recovered,failed});
 return {recovered,failed};
}

async function drainRedemptionRecoveryQueue(rpcClient){
 await drainNeonRecoveryJournal(rpcClient).catch(error=>console.error("Neon recovery drain failed:",error?.message||error));
 const rows=await rpcClient("list_kingshot_redemption_recovery_queue",{p_limit:50});
 let recovered=0,failed=0;
 for(const row of Array.isArray(rows)?rows:[]){
  try{
   await recordRedemptionSafely(rpcClient,{p_player_id:String(row.player_id),p_code:String(row.gift_code),p_status:String(row.status),p_err_code:row.err_code??null,p_message:String(row.message||"Recovered durable redemption result")});
   await rpcClient("finish_kingshot_redemption_recovery",{p_id:Number(row.id),p_ok:true,p_error:null}); recovered++;
  }catch(error){
   await rpcClient("finish_kingshot_redemption_recovery",{p_id:Number(row.id),p_ok:false,p_error:String(error?.message||error).slice(0,240)}).catch(()=>{}); failed++;
  }
 }
 if(rows?.length)console.log("Redemption recovery queue:",{found:rows.length,recovered,failed});
 return {recovered,failed};
}

async function redeemForPlayer(player,codes,rpcClient=rpc){
const kingdomState=KINGDOM_AUTO_CHECK_ENABLED
 ? await revalidatePlayer(player,{rpc:rpcClient,notify:sendDiscordEvent})
 : {player,revalidated:false,kingdomChanged:false,stale:false,automaticCheckDisabled:true};
 const kingdomCheck=Boolean(kingdomState.revalidated);
 const kingdomChanged=Boolean(kingdomState.kingdomChanged);
 if(kingdomState.stale)return {attempted:0,success:0,alreadyHandled:0,skipped:1,stale:1,kingdomCheck,kingdomChanged};
 if(!kingdomState.player?.kingdom_id)return {attempted:0,success:0,alreadyHandled:0,skipped:1,revalidationError:1,kingdomCheck,kingdomChanged};
 player=kingdomState.player;
 const history=await rpcClient("list_kingshot_player_redemptions",{p_player_id:player.player_id});
 const handled=getHandledGiftCodes(history);

 // Process only the newest outstanding code for each player per run.
 // This keeps the request comfortably below pg_net's 5s HTTP timeout and
 // respects Kingshot's per-player TOO FREQUENT rate limit. Older missed
 // active codes are picked up on subsequent runs.
 if(!codes.length)return {attempted:0,success:0,alreadyHandled:0,skipped:1,kingdomCheck,kingdomChanged,handledCodeCounts:{}};
 const item=selectNextOutstandingCode(codes,handled);
 if(!item){
  const handledCodeCounts={};
  for(const code of codes)if(handled.has(code.code.toUpperCase()))handledCodeCounts[code.code]=(handledCodeCounts[code.code]||0)+1;
  return {attempted:0,success:0,alreadyHandled:codes.length,skipped:0,kingdomCheck,kingdomChanged,handledCodeCounts};
 }

 const neonIntentId=await journalStart(player.player_id,item.code);
 let claimed;
 try{claimed=await rpcClient("claim_kingshot_redemption",{p_player_id:player.player_id,p_code:item.code});}catch(error){await journalCancel(player.player_id,item.code,"Supabase claim unavailable: "+String(error?.message||error).slice(0,180));throw error;}
 if(!claimed){await journalCancel(player.player_id,item.code,"Supabase redemption claim declined");return {attempted:0,success:0,alreadyHandled:0,skipped:1,kingdomCheck,kingdomChanged};}

 const recoveryClaim=await rpcClient("begin_kingshot_redemption_recovery",{p_player_id:String(player.player_id),p_code:item.code});
 if(!recoveryClaim){await journalCancel(player.player_id,item.code,"Supabase recovery claim declined");return {attempted:0,success:0,alreadyHandled:1,skipped:1,kingdomCheck,kingdomChanged,recoveryBlocked:true};}
 const redemptionStartedAt=Date.now();
 let d;
 try{
  d=await redeemKingshot({playerId:player.player_id,code:item.code,kid:player.kingdom_id});
 }catch(error){
  // The upstream may have accepted the request before the connection failed.
  // Preserve an explicit review marker; never automatically replay this attempt.
  await neonJournal?.query("update public.redemption_journal set state='needs_review',last_error=$3,updated_at=now() where player_id=$1 and upper(gift_code)=upper($2) and state='in_flight'",[String(player.player_id),String(item.code),String(error?.message||error).slice(0,240)]).catch(queueError=>console.error("Could not mark Neon outcome uncertain:",queueError?.message||queueError));
  await rpcClient("mark_kingshot_redemption_recovery_uncertain",{p_player_id:String(player.player_id),p_code:item.code,p_error:String(error?.message||error).slice(0,240)}).catch(queueError=>console.error("Could not mark uncertain redemption:",queueError?.message||queueError));
  throw error;
 }
 const completedAt=Date.now();
 const status=String(d?.status||"ERROR").toUpperCase();
 const message=d?.message||d?.error||"";
 const persistencePayload={p_player_id:String(player.player_id),p_code:item.code,p_status:status,p_err_code:d?.errCode??null,p_message:(d?.errorCategory?"["+d.errorCategory+"] ":"")+message};
 try{await journalResult(player.player_id,item.code,status,d?.errCode??null,persistencePayload.p_message);}catch(error){console.error("Neon result journal write failed; falling back to Supabase history:",String(error?.message||error).slice(0,240));}
 await rpcClient("complete_kingshot_redemption_recovery",{p_player_id:String(player.player_id),p_code:item.code,p_status:status,p_err_code:d?.errCode??null,p_message:persistencePayload.p_message});
 await recordRedemptionSafely(rpcClient,persistencePayload);
 await rpcClient("resolve_kingshot_redemption_recovery",{p_player_id:String(player.player_id),p_code:item.code}).catch(error=>console.error("Recovery queue resolve failed:",error?.message||error));
 await neonJournal.query("update public.redemption_journal set state='supabase_recorded',attempts=attempts+1,last_error=null,updated_at=now() where player_id=$1 and upper(gift_code)=upper($2) and state='result_recorded'",[String(player.player_id),String(item.code)]).catch(error=>console.error("Neon journal acknowledgement failed:",error?.message||error));

 const discoveryAt=Number.isFinite(item.discoveredAt)?item.discoveredAt:null;
 const redemptionTelemetry={code:item.code,resultAt:new Date(completedAt).toISOString(),status,redemptionLatencyMs:Math.max(0,completedAt-redemptionStartedAt),discoveryToResultMs:discoveryAt==null?null:Math.max(0,completedAt-discoveryAt)};
 return {attempted:1,success:status==="SUCCESS"?1:0,alreadyReceived:status==="RECEIVED"?1:0,alreadyHandled:0,skipped:0,kingdomCheck,kingdomChanged,redemptionCode:item.code,redemptionStatus:status,redemptionErrorCategory:d?.errorCategory||null,redemptionErrCode:d?.errCode??null,redemptionMessage:message?String(message).slice(0,240):null,redemptionTelemetry};
}

export default async function handler(req,res){
 if(!["GET","POST"].includes(req.method))return res.status(405).json({error:"Method not allowed"});
 const cycleStartedAt=Date.now();
 let currentStage="request-authentication";
 const cronSecret=process.env.CRON_SECRET;
 const schedulerToken=req.headers["x-kingshot-scheduler-token"];
 const requestUrl=new URL(req.url||"/",APP_ORIGIN);
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
  const requestedCodes=Array.isArray(body?.codes)?body.codes:[];
  const players=Array.isArray(body?.players)?body.players:[];
  try{
   // Recovery queues are global, not shard-local. Drain them once per cycle
   // instead of making all four shards scan and race over the same queue.
   // Slot 0 is the designated recovery drainer; the other shards preserve
   // their runtime for the player partition assigned to them.
   if(slot===0)await drainRedemptionRecoveryQueue(rpc);
   const adminRows=await rpc("list_kingshot_admin_gift_codes",{});
   const suppressedCodes=new Set((Array.isArray(adminRows)?adminRows:[]).filter(row=>row?.suppressed===true).map(row=>String(row?.code||"").trim().toUpperCase()).filter(Boolean));
   const verifiedCodes=new Set((Array.isArray(adminRows)?adminRows:[]).filter(r=>r?.validation_status==="verified"&&r?.active!==false&&r?.suppressed!==true).map(r=>String(r?.code||"").trim().toUpperCase()));
   const codes=requestedCodes.filter(item=>item&&typeof item.code==="string"&&!suppressedCodes.has(item.code.trim().toUpperCase())&&verifiedCodes.has(item.code.trim().toUpperCase()));
   // Partition before loading history. The coordinator sends the full player list
   // to each shard, so querying history for every player here caused three large,
   // redundant database scans per cycle and amplified PostgREST timeout pressure.
   const assignedPlayers=players.filter(player=>workerBucket(player?.player_id,WORKER_COUNT)===slot);
   // Enforce bans at the worker boundary, not only in registration/admin flows.
   // Fail closed if ban state cannot be read: unknown ban state must never permit redemption.
   const bannedIds=new Set();
   const banPageSize=1000;
   for(let offset=0;;offset+=banPageSize){
    const bansResponse=await fetch(SUPABASE_URL+"/rest/v1/kingshot_player_bans?select=player_id&order=player_id.asc",{headers:{"apikey":SUPABASE_KEY,"authorization":"Bearer "+SUPABASE_KEY,"Range":offset+"-"+(offset+banPageSize-1)},signal:AbortSignal.timeout(10000)});
    if(!bansResponse.ok)throw Error("Unable to verify player bans before redemption (HTTP "+bansResponse.status+").");
    const bansRows=await bansResponse.json();
    if(!Array.isArray(bansRows))throw Error("Unable to verify player bans before redemption: invalid response.");
    for(const row of bansRows){const id=String(row?.player_id||"").trim();if(id)bannedIds.add(id)}
    if(bansRows.length<banPageSize)break;
   }
   const eligiblePlayers=assignedPlayers.filter(player=>player?.enabled!==false&&!bannedIds.has(String(player?.player_id||"").trim()));
   const restrictedPlayersSkipped=assignedPlayers.length-eligiblePlayers.length;
   if(restrictedPlayersSkipped)console.warn("Kingshot worker skipped disabled/restricted players:",{slot,count:restrictedPlayersSkipped});
   const playerIds=[...new Set(eligiblePlayers.map(player=>String(player?.player_id||"").trim()).filter(Boolean))];
   const historyRows=playerIds.length
    ? await rpc("list_kingshot_player_redemptions_bulk",{p_player_ids:playerIds})
    : [];
   const historiesByPlayer=new Map();
   for(const row of Array.isArray(historyRows)?historyRows:[]){
    const id=String(row?.player_id||"");
    if(!historiesByPlayer.has(id))historiesByPlayer.set(id,[]);
    const {player_id,...history}=row;
    historiesByPlayer.get(id).push(history);
   }
   const shardRpc=async(name,body)=>{
    if(name==="list_kingshot_player_redemptions"){
     const id=String(body?.p_player_id||"");
     if(!historiesByPlayer.has(id))return [];
     return historiesByPlayer.get(id);
    }
    return rpc(name,body);
   };
   const result=await runWorkerShard(slot,codes,eligiblePlayers,{rpc:shardRpc,redeemForPlayer:(player,codes)=>redeemForPlayer(player,codes,shardRpc)},{workerCount:WORKER_COUNT,concurrency:PLAYER_CONCURRENCY,maxRuntimeMs:WORKER_MAX_RUNTIME_MS});
   return res.status(200).json({ok:true,...result,restrictedPlayersSkipped,bannedPlayersSkipped:restrictedPlayersSkipped});
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

 // Manual diagnostic mode: process a stable, bounded batch of registered players
 // against MightPulse. Keyset pagination avoids skipping records if stale players
 // are removed between calls. This mode never discovers codes or starts redemption.
 if(mode==="kingdom-check"){
  let manualWorkerToken=null;
  try{
   const lock=await rpc("claim_kingshot_worker_run",{});
   if(!lock?.claimed)return res.status(200).json({ok:true,mode:"kingdom-check",skipped:true,reason:"WORKER_ALREADY_RUNNING"});
   manualWorkerToken=lock.token;
   await rpc("heartbeat_kingshot_worker_run",{p_token:manualWorkerToken}).catch(()=>{});

   const players=await rpc("list_kingshot_autoredeem_players",{});
   const list=Array.isArray(players)?players:[];
   const requestedBatchSize=requestUrl.searchParams.has("batch-size")
    ? Number(requestUrl.searchParams.get("batch-size"))
    : undefined;
   const batch=selectKingdomCheckBatch(list,{
    after:requestUrl.searchParams.get("after"),
    batchSize:requestedBatchSize
   });
   const results=await runWithConcurrency(
    batch.players,
    player=>revalidatePlayer(player,{rpc,notify:sendDiscordEvent},{force:true}),
    MANUAL_KINGDOM_VALIDATION_CONCURRENCY
   );
   const summary=summarizeKingdomCheckResults(results);
   const status=summary.errors||summary.stale||summary.deferred
    ?"COMPLETED_WITH_WARNINGS"
    :"COMPLETED";
   const runSummary={
    mode:"kingdom-check",
    players:batch.players.length,
    batchSize:batch.batchSize,
    after:batch.after,
    nextCursor:batch.nextCursor,
    hasMore:batch.hasMore,
    remainingCount:batch.remainingCount,
    ...summary
   };
   await rpc("finish_kingshot_worker_run",{
    p_token:manualWorkerToken,
    p_status:status,
    p_error:null,
    p_summary:runSummary
   }).catch(error=>console.error("Manual worker state update failed:",error?.message||error));
   manualWorkerToken=null;
   console.log("Kingshot manual kingdom check:",runSummary);

   if(requestUrl.searchParams.get("notify-summary")!=="false"){
    await sendDiscordEvent({title:"🔍 Manual kingdom check batch",description:"A bounded batch of forced kingdom revalidation completed without starting redemption.",fields:[
     {name:"Batch players",value:String(batch.players.length),inline:true},
     {name:"Checked",value:String(summary.checked),inline:true},
     {name:"Kingdom changes",value:String(summary.changed),inline:true},
     {name:"Stale accounts",value:String(summary.stale),inline:true},
     {name:"Errors",value:String(summary.errors),inline:true},
     {name:"Deferred (cooldown/budget)",value:String(summary.deferred),inline:true},
     {name:"Validated",value:String(summary.validated),inline:true},
     {name:"More batches",value:batch.hasMore?"Yes":"No",inline:true}
    ],color:summary.errors||summary.stale||summary.deferred?0xFEE75C:0x57F287});
   }
   return res.status(200).json({
    ok:true,
    mode:"kingdom-check",
    forced:true,
    ...summary,
    players:batch.players.length,
    batchSize:batch.batchSize,
    nextCursor:batch.nextCursor,
    hasMore:batch.hasMore,
    remainingCount:batch.remainingCount
   });
  }catch(error){
   console.error("Manual kingdom check failed:",error);
   if(manualWorkerToken)await rpc("finish_kingshot_worker_run",{
    p_token:manualWorkerToken,
    p_status:"FAILED",
    p_error:error?.message||"Manual kingdom check failed.",
    p_summary:{mode:"kingdom-check",errorCategory:classifyScraperError(error)}
   }).catch(releaseError=>console.error("Manual worker failure state update failed:",releaseError?.message||releaseError));
   return res.status(502).json({ok:false,mode:"kingdom-check",error:error?.message||"Manual kingdom check failed.",errorCategory:classifyScraperError(error)});
  }
 }
 let workerToken=null;
 try{
  currentStage="worker-run-lock";
  const lock=await rpc("claim_kingshot_worker_run",{});
  if(!lock?.claimed)return res.status(200).json({ok:true,skipped:true,reason:"WORKER_ALREADY_RUNNING"});
  workerToken=lock.token;
  await rpc("heartbeat_kingshot_worker_run",{p_token:workerToken}).catch(()=>{});
  // Keep community-source requests sequential instead of bursting all providers at once.
  // This reduces 429 risk without rotating identities or bypassing upstream quotas.
  currentStage="gift-code-source-fetch";
  const apiSource=await fetchSource(rpc,GIFT_SOURCE_URL,"api");
  await new Promise(resolve=>setTimeout(resolve,250));
  const pageSource=await fetchSource(rpc,"https://kingshot.net/gift-codes","page");
  const publicSources=[];
  for(const source of PUBLIC_GIFT_SOURCES){
   await new Promise(resolve=>setTimeout(resolve,250));
   publicSources.push(await fetchSource(rpc,source.url,"public:"+source.name));
  }
  // Opt-in community aggregator: never guess an endpoint or make unauthenticated calls.
  const aggregatorUrl=String(process.env.KINGSHOT_AGGREGATOR_URL||"").trim();
  const aggregatorKey=String(process.env.KINGSHOT_AGGREGATOR_API_KEY||"").trim();
  if(aggregatorUrl&&aggregatorKey){
   await new Promise(resolve=>setTimeout(resolve,250));
   publicSources.push(await fetchSource(rpc,aggregatorUrl,"aggregator"));
  }
  currentStage="gift-code-merge-and-persist";
  const adminRows=await rpc("list_kingshot_admin_gift_codes",{});
  const data=apiSource.data;
  const apiCodes=apiSource.codes;
  const pageCodes=pageSource.codes;
  const publicCodes=publicSources.flatMap(result=>result.codes.length?result.codes.map(row=>({...row,source:row.source||result.source})):[]);
  const suppressedCodes=new Set((Array.isArray(adminRows)?adminRows:[]).filter(row=>row?.suppressed===true).map(row=>String(row?.code||"").trim().toUpperCase()).filter(Boolean));
  const adminCodes=(Array.isArray(adminRows)?adminRows:[]).filter(row=>row?.active!==false&&row?.suppressed!==true).map(row=>({
   code:String(row?.code||"").trim(),
   expiresAt:null,
   createdAt:row?.source_date?Date.parse(String(row.source_date)):Date.parse(String(row?.first_seen_at||"")),
   source:"admin",
   adminAdded:Boolean(row?.admin_added)
  })).filter(row=>row.code&&row.code.length>=6&&row.code.length<=32);
  let codes=mergeCodes([apiCodes,pageCodes,publicCodes,VERIFIED_FALLBACK_CODES,adminCodes]).filter(item=>!suppressedCodes.has(String(item.code||"").trim().toUpperCase()));
  if(!codes.length)throw Error("Kingshot gift-code sources returned no active codes.");
  const codesDiscoveredAt=Date.now();
  console.log("Kingshot auto feed:",{apiActive:data?.data?.activeCount??null,apiCodes:apiCodes.map(x=>x.code),pageCodes:pageCodes.map(x=>x.code),publicSources:publicCodes.map(x=>({code:x.code,source:x.source})),adminCodes:adminCodes.map(x=>x.code),merged:codes.map(x=>x.code)});
  const knownCodes=new Set((Array.isArray(adminRows)?adminRows:[]).map(row=>String(row?.code||"").toUpperCase()));
  const previouslyVerifiedCodes=new Set((Array.isArray(adminRows)?adminRows:[]).filter(row=>row?.validation_status==="verified"&&row?.active!==false&&row?.suppressed!==true).map(row=>String(row?.code||"").trim().toUpperCase()).filter(Boolean));

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
  let activeCodes=codes.filter(item=>{
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
  for(const item of newCodes.filter(isCredibleGiftCodeCandidate))await sendDiscordEvent(buildNewGiftCodeAlert(item));
  const players=await rpc("list_kingshot_autoredeem_players",{});
  const list=Array.isArray(players)?players:[];
  // The reset can make every account due at once. Validate a small rotating
  // batch per minute so a slow provider cannot push this whole redemption cycle
  // beyond pg_net's 30-second request timeout. Future retry deadlines are
  // filtered before scheduling; successful checks naturally rotate by timestamp.
  const validationNow=Date.now();
  const duePlayers=KINGDOM_AUTO_CHECK_ENABLED ? list.filter(player=>
   (!player?.kingdom_id || needsKingdomResetCheck(player?.last_kingdom_check_at,validationNow))
  ) : [];
  const scheduledBatch=selectScheduledKingdomCheckBatch(duePlayers,{
   nowMs:validationNow,
   batchSize:KINGDOM_SCHEDULED_VALIDATION_BATCH_SIZE
  });
  const validationPlayers=scheduledBatch.players;
  currentStage="kingdom-revalidation";
  const validationDeadline=Date.now()+25000;

  // Phase 1: revalidate only this bounded batch before the redemption workers.
  // Everyone with an existing kingdom remains eligible unless an actual check
  // proves the registration stale; queued/retrying players are not penalized.
  await rpc("heartbeat_kingshot_worker_run",{p_token:workerToken}).catch(()=>{});
  const kingdomResults=KINGDOM_AUTO_CHECK_ENABLED
   ? await runWithConcurrency(validationPlayers,player=>revalidatePlayer(player,{rpc,notify:sendDiscordEvent}),KINGDOM_VALIDATION_CONCURRENCY,{deadline:validationDeadline})
   : [];
  const validPlayerMap=new Map(list
   .filter(player=>player?.kingdom_id)
   .map(player=>[String(player.player_id),player]));
  const kingdomSummary=kingdomResults.reduce((a,result)=>{
   if(result?.deadlineSkipped){a.deferred++;return a;}
   if(result?.deferred){
    a.deferred++;
    return a;
   }
   if(result?.revalidationError){
    a.errors++;
    return a;
   }
   if(result?.stale){a.stale++;return a;}
   if(result?.revalidated)a.checked++;
   if(result?.kingdomChanged)a.changed++;
   return a;
  },{checked:0,changed:0,stale:0,errors:0,deferred:0});
  for(const result of kingdomResults){
   const id=String(result?.player?.player_id||"");
   if(!id)continue;
   if(result?.stale || !result?.player?.kingdom_id)validPlayerMap.delete(id);
   else validPlayerMap.set(id,result.player);
  }
  const validPlayers=[...validPlayerMap.values()];
  console.log("Kingshot kingdom check:",{
   automaticChecksEnabled:KINGDOM_AUTO_CHECK_ENABLED,
   players:list.length,
   candidates:duePlayers.length,
   scheduledBatch:validationPlayers.length,
   queued:scheduledBatch.queuedCount,
   retryWaiting:scheduledBatch.retryWaitingCount,
   ...kingdomSummary,
   validationBudgetMs:25000,
   validPlayers:validPlayers.length
  });
  // One canary per cycle. The real endpoint can consume the reward on this player.
  const apiCandidateKeys=new Set(apiCodes.map(item=>String(item.code||"").trim().toUpperCase()));
  const pageCandidateKeys=new Set(pageCodes.map(item=>String(item.code||"").trim().toUpperCase()));
  const pendingCandidates=persistedCodeRows
   .filter(r=>r&&r.validation_status==="pending"&&r.suppressed!==true)
   .map(r=>({code:String(r.code||"").trim()}))
   .filter(r=>{
    const codeKey=r.code.toUpperCase();
    const evidence=activeCodes.find(c=>c.code.toUpperCase()===codeKey);
    const matchedFirstPartyApiAndPage=apiCandidateKeys.has(codeKey)&&pageCandidateKeys.has(codeKey);
    return Boolean(r.code&&evidence&&isCanaryEligibleGiftCodeCandidate(evidence,matchedFirstPartyApiAndPage)&&!expiredCodes.has(codeKey));
   });
  const canaryCandidate=pendingCandidates[0];let verificationAttempt=null;
  if(canaryCandidate&&validPlayers.length){
   for(const player of validPlayers){
    try{
     const history=await rpc("list_kingshot_player_redemptions",{p_player_id:player.player_id});
     const handled=getHandledGiftCodes(history);
     if(handled.has(canaryCandidate.code.toUpperCase()))continue;
     await journalStart(player.player_id,canaryCandidate.code);
     let claim;
     try{claim=await rpc("claim_kingshot_redemption",{p_player_id:player.player_id,p_code:canaryCandidate.code});}
     catch(error){await journalCancel(player.player_id,canaryCandidate.code,"Supabase canary claim unavailable: "+String(error?.message||error).slice(0,180));throw error;}
     if(!claim){await journalCancel(player.player_id,canaryCandidate.code,"Supabase canary claim declined");continue;}
     let result;
     try{result=await redeemKingshot({playerId:player.player_id,code:canaryCandidate.code,kid:player.kingdom_id});}
     catch(error){
      await neonJournal?.query("update public.redemption_journal set state='needs_review',last_error=$3,updated_at=now() where player_id=$1 and upper(gift_code)=upper($2) and state='in_flight'",[String(player.player_id),String(canaryCandidate.code),String(error?.message||error).slice(0,240)]).catch(()=>{});
      throw error;
     }
     const status=String(result?.status||"ERROR").toUpperCase(),message=String(result?.message||result?.error||"");
     const canaryMessage=(result?.errorCategory?"["+result.errorCategory+"] ":"")+message;
     try{await journalResult(player.player_id,canaryCandidate.code,status,result?.errCode??null,canaryMessage);}
     catch(error){console.error("Canary Neon result journal write failed; falling back to Supabase history:",String(error?.message||error).slice(0,240));}
     await recordRedemptionSafely(rpc,{p_player_id:player.player_id,p_code:canaryCandidate.code,p_status:status,p_err_code:result?.errCode??null,p_message:canaryMessage});
     await neonJournal?.query("update public.redemption_journal set state='supabase_recorded',attempts=attempts+1,last_error=null,updated_at=now() where player_id=$1 and upper(gift_code)=upper($2) and state='result_recorded'",[String(player.player_id),String(canaryCandidate.code)]).catch(error=>console.error("Canary Neon journal acknowledgement failed:",error?.message||error));
     // This response identifies an account eligibility restriction, not an invalid code.
     // Treat only this exact response as verification success so the code is released to all players.
     let validationStatus="pending";if(["SUCCESS","RECEIVED","SAME TYPE EXCHANGE","RECHARGE_MONEY ERROR"].includes(status))validationStatus="verified";else if(status==="CDK_NOT_FOUND")validationStatus="invalid";else if(status==="TIME_ERROR")validationStatus="expired";else if(status==="USAGE_LIMIT")validationStatus="usage_limit";
     await rpc("set_kingshot_gift_code_validation",{p_code:canaryCandidate.code,p_status:validationStatus,p_player_id:String(player.player_id),p_message:message||status});
     verificationAttempt={code:canaryCandidate.code,status,validationStatus,playerId:String(player.player_id)};
     await sendDiscordEvent(buildGiftCodeValidationAlert({code:canaryCandidate.code,status,validationStatus,message:message||"",errorCategory:result?.errorCategory||null}));break;
    }catch(error){const errorMessage=String(error?.message||error).slice(0,240);const errorCategory=classifyScraperError(error);console.error("Gift-code verification attempt failed:",canaryCandidate.code,errorMessage);verificationAttempt={code:canaryCandidate.code,status:"VERIFICATION_ERROR",validationStatus:"pending",errorCategory};await sendDiscordEvent(buildGiftCodeVerificationErrorAlert({code:canaryCandidate.code,errorCategory,message:errorMessage}));break;}
   }
  }
  currentStage="gift-code-validation-gate";
  const latestCodeRows=await rpc("list_kingshot_admin_gift_codes",{});
  const verifiedCodeSet=new Set((Array.isArray(latestCodeRows)?latestCodeRows:[]).filter(r=>r?.validation_status==="verified"&&r?.active!==false&&r?.suppressed!==true).map(r=>String(r?.code||"").trim().toUpperCase()));
  activeCodes=activeCodes.filter(c=>verifiedCodeSet.has(c.code.toUpperCase()));
  const newlyAvailableCodes=activeCodes.filter(item=>verifiedCodeSet.has(item.code.toUpperCase())&&!previouslyVerifiedCodes.has(item.code.toUpperCase()));
  if(newlyAvailableCodes.length){const listed=newlyAvailableCodes.map(item=>item.code).slice(0,5),extra=newlyAvailableCodes.length-listed.length;try{await broadcastPush({title:listed.length===1?"🎁 A new gift code is ready":"🎁 New gift codes are ready",body:"Verified and available: "+listed.join(", ")+(extra>0?" + "+extra+" more":"")+". Tap to view the codes and redeem your rewards.",url:"/manual?code="+encodeURIComponent(listed[0]),image:"https://kingshot-autoredeemer.vercel.app/api/og",tag:"new-gift-codes-"+[...listed].sort().join("-").slice(0,60)})}catch(error){console.error("New gift-code push notification failed:",error instanceof Error?error.message:error)}}
  console.log("Kingshot code validation gate:",{pending:pendingCandidates.length,verificationAttempt,verifiedForWorkers:activeCodes.map(c=>c.code)});


  if(kingdomSummary.checked||kingdomSummary.changed||kingdomSummary.stale||kingdomSummary.errors||kingdomSummary.deferred){
   await sendDiscordEvent({
    title:"🔍 Kingdom check",
    description:"Kingdom revalidation completed before the redemption worker pool started.",
    fields:[
     {name:"Players checked",value:String(kingdomSummary.checked),inline:true},
     {name:"Kingdom changes",value:String(kingdomSummary.changed),inline:true},
     {name:"Stale accounts",value:String(kingdomSummary.stale),inline:true},
     {name:"Check errors",value:String(kingdomSummary.errors),inline:true},
     {name:"Deferred (cooldown/budget)",value:String(kingdomSummary.deferred),inline:true},
     {name:"Validated for redemption",value:String(validPlayers.length),inline:true}
    ],
    color:kingdomSummary.errors||kingdomSummary.stale||kingdomSummary.deferred?0xFEE75C:0x57F287
   });
  }

  // Phase 2: only the already-validated players enter the redemption pool.
  const workerUrlBase=APP_ORIGIN+"/api/kingshot-auto?mode=worker&slot=";
  const childHeaders={"content-type":"application/json"};
  if(cronSecret)childHeaders.authorization="Bearer "+cronSecret;
  else if(schedulerToken)childHeaders["x-kingshot-scheduler-token"]=String(schedulerToken);
  else throw Error("No internal worker authorization is configured.");

  const assignments=Array.from({length:WORKER_COUNT},()=>[]);
  for(const player of validPlayers)assignments[workerBucket(player?.player_id,WORKER_COUNT)].push(player);
  await rpc("heartbeat_kingshot_worker_run",{p_token:workerToken}).catch(()=>{});
  currentStage="worker-shard-fanout";
  const workerRuns=await Promise.all(assignments.map(async(assigned,workerIndex)=>{
   const shardStartedAt=Date.now();
   try{
    const response=await fetch(workerUrlBase+workerIndex,{
     method:"POST",
     headers:childHeaders,
     body:JSON.stringify({codes:activeCodes,players:assigned}),
     signal:AbortSignal.timeout(WORKER_MAX_RUNTIME_MS+15000)
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(payload?.error||"Worker shard returned HTTP "+response.status);
    const shardDurationMs=Date.now()-shardStartedAt;
    if(shardDurationMs>=5000)console.warn("Kingshot worker shard slow:",{slot:workerIndex,durationMs:shardDurationMs,status:response.status,players:assigned.length});
    return payload;
   }catch(error){
    console.error("Kingshot worker fan-out failed:",{slot:workerIndex,durationMs:Date.now()-shardStartedAt,players:assigned.length,errorName:error?.name||null,message:error?.message||String(error)});
    return {slot:workerIndex,claimed:false,error:error?.message||"Worker shard failed.",errorCategory:classifyScraperError(error),players:assigned.length};
   }
  }));
  const workerFailures=workerRuns.filter(result=>result?.error||result?.claimed===false&&result?.reason!=="SLOT_ALREADY_RUNNING");
  // Keep coordinator/shard failures visible separately from per-player errors.
  // These failures were previously counted but omitted from worker diagnostics.
  const shardFailureDiagnostics=workerFailures.map(result=>({
   slot:Number.isInteger(result?.slot)?result.slot:null,
   category:String(result?.errorCategory||"WORKER_SHARD"),
   message:String(result?.error||result?.reason||"Worker shard failed.").replace(/\\s+/g," ").trim().slice(0,240),
   players:Number.isFinite(result?.players)?result.players:null
  }));
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
  const noWorkReason=totals.attempted>0?null
   :activeCodes.length===0?"NO_ELIGIBLE_VERIFIED_UNSUPPRESSED_UNEXPIRED_CODES"
   :validPlayers.length>0&&totals.alreadyHandled>=validPlayers.length*activeCodes.length?"ALL_ELIGIBLE_CODES_ALREADY_HANDLED"
   :"NO_REDEMPTION_ATTEMPTS_RECORDED";
  console.log("Kingshot auto worker pool:",{workers:WORKER_COUNT,assignments:assignments.map(x=>x.length),workerFailures:workerFailures.length,attempted:totals.attempted,success:totals.success,noWorkReason,workerErrors:workerErrorDiagnostics,redemptionFailures:mergedFailures});
  const summary={source:"multi-source",sources:sourceResults.length,workers:WORKER_COUNT,codes:activeCodes.length,discoveredCodes:codes.length,expiredCodesFiltered:codes.length-activeCodes.length,players:list.length,validatedPlayers:validPlayers.length,verificationAttempt,noWorkReason,...totals,workerFailures:workerFailures.length,shardFailureDiagnostics,workerErrors:workerErrorDiagnostics,redemptionFailures:mergedFailures,codeTelemetry};
  await rpc("finish_kingshot_worker_run",{p_token:workerToken,p_status:totals.errors||totals.stale||kingdomSummary.errors||kingdomSummary.deferred||workerFailures.length?"COMPLETED_WITH_WARNINGS":"COMPLETED",p_error:null,p_summary:summary}).catch(error=>console.error("Worker state update failed:",error?.message||error));
  const anomalyReasons=[];
  if(totals.errors||workerFailures.length)anomalyReasons.push("worker errors");
  if(totals.deadlineSkipped)anomalyReasons.push("worker deadline deferrals");
  if(kingdomSummary.deferred)anomalyReasons.push("kingdom validation budget deferred "+kingdomSummary.deferred+" players");
  if(!activeCodes.length)anomalyReasons.push("no active codes");
  if(sourceHealthPct<50)anomalyReasons.push("scraper source health below 50%");
  if(list.length&&validPlayers.length<Math.floor(list.length*0.7))anomalyReasons.push("over 30% of players failed validation");
  const statusMap=workerRuns.reduce((map,r)=>{for(const [status,count] of Object.entries(r?.redemptionStatuses||{}))map[status]=(map[status]||0)+count;return map},{});
  if(anomalyReasons.length)await sendDiscordEvent({title:"🚨 Auto-redeem anomaly detected",description:anomalyReasons.join(" · "),fields:[
   {name:"Reasons",value:anomalyReasons.join("\n"),inline:false},
   {name:"Cycle runtime",value:(cycleDurationMs/1000).toFixed(1)+"s",inline:true},
   {name:"Source health",value:healthySources+"/"+sourceCount+" healthy",inline:true},
   {name:"Validated",value:String(validPlayers.length)+"/"+String(list.length),inline:true},
   {name:"Worker diagnostics",value:[
    ...workerErrorDiagnostics.map(x=>x.category+" · "+x.message+" · x"+x.count),
    ...shardFailureDiagnostics.map(x=>"SHARD "+(x.slot??"?")+" · "+x.category+" · "+x.message+(x.players!=null?" · "+x.players+" players":""))
   ].join("\n").slice(0,1024)||"None",inline:false}
  ],color:0xED4245});
  if(totals.attempted||totals.errors||totals.stale||workerFailures.length||newCodes.length)await sendDiscordEvent({title:"📊 Auto-redeem cycle",description:"Scheduled Kingshot worker pool completed a cycle with activity.",fields:[{name:"Players",value:String(list.length),inline:true},{name:"Validated",value:String(validPlayers.length),inline:true},{name:"Workers",value:String(WORKER_COUNT),inline:true},{name:"Verified & available codes",value:String(activeCodes.length),inline:true},{name:"Attempts",value:String(totals.attempted),inline:true},{name:"Successes",value:String(totals.success),inline:true},{name:"Already received",value:String(totals.alreadyReceived),inline:true},{name:"Already redeemed/handled",value:String(totals.alreadyHandled),inline:true},{name:"Errors",value:String(totals.errors),inline:true},{name:"Stale",value:String(totals.stale),inline:true},{name:"Worker failures",value:String(workerFailures.length),inline:true},{name:"Deferred by deadline",value:String(totals.deadlineSkipped),inline:true},{name:"Runtime",value:(cycleDurationMs/1000).toFixed(1)+"s",inline:true},{name:"Sources",value:healthySources+"/"+sourceCount+" healthy",inline:true},{name:"Verified code list",value:activeCodes.map(item=>item.code).slice(0,16).join(", ")||"No verified codes currently eligible",inline:false},{name:"Redemption statuses",value:Object.entries(workerRuns.reduce((map,r)=>{for(const [status,count] of Object.entries(r?.redemptionStatuses||{}))map[status]=(map[status]||0)+count;return map},{})).map(([status,count])=>`${status}: ${count}`).join("\n").slice(0,1024)||"None",inline:false},{name:"Code breakdown",value:Object.entries(codeCounts).filter(([k])=>!k.includes("_status_")).map(([code,count])=>`${code}: ${count} handled`).join("\n").slice(0,1024)||"None",inline:false},{name:"Speed telemetry",value:Object.entries(codeTelemetry).filter(([,t])=>Number(t?.attempts||0)>0).map(([code,t])=>code+": first result "+(t.firstResultLatencyMs!=null?(t.firstResultLatencyMs/1000).toFixed(1)+"s":"—")+" · "+(t.avgRedemptionLatencyMs!=null?(t.avgRedemptionLatencyMs/1000).toFixed(1)+"s avg API":"—")+(t.firstSuccessAt?" · first SUCCESS":" · no SUCCESS")).join("\n").slice(0,1024)||"None",inline:false},{name:"Redemption failures",value:mergedFailures.length?mergedFailures.map(x=>`${x.category}/${x.errCode}/${x.status}: ${x.count}`).join("\n").slice(0,1024):"None",inline:false},{name:"Worker diagnostics",value:[
    ...workerErrorDiagnostics.map(x=>x.category+" · "+x.message+" · x"+x.count),
    ...shardFailureDiagnostics.map(x=>"SHARD "+(x.slot??"?")+" · "+x.category+" · "+x.message+(x.players!=null?" · "+x.players+" players":""))
   ].join("\n").slice(0,1024)||"None",inline:false}],color:totals.errors||totals.stale||workerFailures.length?0xFEE75C:0x57F287});
  return res.status(200).json({ok:true,...summary});
 }catch(e){
  console.error("Kingshot auto redeem:",{stage:currentStage,durationMs:Date.now()-cycleStartedAt,errorName:e?.name||null,message:e?.message||String(e),stack:typeof e?.stack==="string"?e.stack.split("\n").slice(0,4).join("\n"):null});
  if(workerToken)await rpc("finish_kingshot_worker_run",{p_token:workerToken,p_status:"FAILED",p_error:e?.message||"Auto redemption failed.",p_summary:{errorCategory:classifyScraperError(e)}}).catch(error=>console.error("Worker failure state update failed:",error?.message||error));
  await sendDiscordEvent({title:"❌ Auto-redeem worker error",description:e?.message||"Auto redemption failed.",color:0xED4245});
  return res.status(502).json({error:e.message||"Auto redemption failed.",errorCategory:classifyScraperError(e)});
 }
}
