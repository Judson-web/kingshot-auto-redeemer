import { sb, selectRows, patchRows, insertRows, callRpc, enc } from "./alliance-sync-store.js";
import { randomUUID } from "node:crypto";
import { normalizeRegistrationInput, registerPlayer } from "./register.js";
import { getRegisteredPlayerIds } from "./registered-player-ids.js";
import { fetchMightPulse } from "../../lib/mightpulse-key-pool.js";

const JOB_SECRET=process.env.ALLIANCE_SYNC_CRON_SECRET||process.env.CRON_SECRET||"";
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function registerWithRetry(input:any){let last:unknown;for(let attempt=0;attempt<3;attempt++){try{return await registerPlayer(input)}catch(error){last=error;if(attempt<2)await wait(400*(attempt+1));}}throw last instanceof Error?last:new Error("Registration failed after retries.");}
async function loadRoster(kingdom:string,tag:string){
 const url="https://api.mightpulse.com/v1/alliances/"+encodeURIComponent(kingdom)+"/"+encodeURIComponent(tag)+"?include=info,roster";
 const r=await fetchMightPulse(url,{headers:{Accept:"application/json"}},{timeoutMs:20000});
 const d:any=await r.json().catch(()=>null);
 if(!r.ok)throw new Error(r.status===401||r.status===403?"MightPulse authentication failed.":r.status===429?"MightPulse rate limited.":`MightPulse request failed (${r.status}).`);
 if(!d||typeof d!=="object")throw new Error("MightPulse returned an invalid roster response.");
 if(d.fresh===false||d.stale===true)throw new Error("MightPulse marked the roster stale.");
 const s=d.data&&typeof d.data==="object"?d.data:d,a=s.alliance??s;
 const rows=Array.isArray(s.members)?s.members:Array.isArray(s.roster)?s.roster:Array.isArray(a.members)?a.members:null;
 if(!rows||!rows.length)throw new Error("Empty roster rejected.");
 const members=rows.map((m:any)=>({id:String(m?.governor_id??m?.fid??"").trim(),kid:String(m?.kid??kingdom),name:String(m?.nick_name??m?.name??m?.nickname??"").trim().slice(0,80),avatarUrl:String(m?.avatar_url??m?.avatarUrl??"").trim()})).filter(m=>/^\d{5,20}$/.test(m.id)&&m.kid===kingdom);
 const byId = new Map<string, {id:string;kid:string;name:string;avatarUrl:string}>();
 for (const member of members) if (!byId.has(member.id)) byId.set(member.id, member);
 const unique=[...byId.values()];
 const rawCount=a.member_count??a.memberCount??a.count;
 const count=rawCount==null?rows.length:Number(rawCount);
 if(!Number.isFinite(count)||count<1||!unique.length||unique.length<Math.min(count,5)||(count>0&&unique.length/count<.65))throw new Error("Incomplete roster rejected.");
 if(String(a.abbr??a.tag??tag).toLowerCase()!==tag.toLowerCase())throw new Error("Alliance mismatch.");
 return {name:String(a.name??a.alliance_name??tag).slice(0,80),members:unique};
}
const SB_URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SB_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY||"";
async function sbRequest(path:string,init:any={}){
 if(!SB_KEY)throw new Error("Supabase service key is not configured.");
 const response=await fetch(SB_URL+"/rest/v1/"+path,{...init,headers:{apikey:SB_KEY,authorization:"Bearer "+SB_KEY,"content-type":"application/json",...(init.headers||{})},signal:AbortSignal.timeout(12000)});
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw new Error("Supabase queue request failed ("+response.status+").");
 return data;
}
async function processManualRegistrationJobs(){
 const outcomes:any[]=[];
 for(let attempt=0;attempt<3;attempt++){
  const claimed=await sbRequest("rpc/claim_alliance_manual_registration_job",{method:"POST",body:"{}"});
  if(!Array.isArray(claimed)||!claimed.length)break;
  const job=claimed[0];
  const ids=Array.isArray(job.selected_player_ids)?job.selected_player_ids:JSON.parse(String(job.selected_player_ids||"[]"));
  const offset=Number(job.processed_count||0),batch=ids.slice(offset,offset+5);
  if(!batch.length){
   const status=Number(job.failed_count||0)>0?"partial":"completed";
   const rows=await sbRequest("alliance_manual_registration_jobs?id=eq."+encodeURIComponent(job.id)+"&status=eq.running",{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({status,finished_at:new Date().toISOString(),updated_at:new Date().toISOString(),current_player_id:null})});
   outcomes.push({jobId:job.id,status});continue;
  }
  let roster;
  try{roster=await loadRoster(String(job.kingdom_id),String(job.alliance_tag));}
  catch(e){
   const message=String((e as Error)?.message||"Roster validation failed.").slice(0,250);
   await sbRequest("alliance_manual_registration_jobs?id=eq."+encodeURIComponent(job.id)+"&status=eq.running",{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"failed",error_message:message,finished_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
   outcomes.push({jobId:job.id,status:"failed"});continue;
  }
  const members=new Map(roster.members.map((m:any)=>[m.id,m]));
  for(const playerIdValue of batch){
   const playerId=String(playerIdValue);let result:any;
   try{
    const member:any=members.get(playerId);
    if(!member)throw new Error("Player is no longer in the validated alliance roster.");
    const input=normalizeRegistrationInput({playerId,kingdomId:String(job.kingdom_id),playerName:member.name,avatarUrl:member.avatarUrl});
    const registered=await registerWithRetry(input);
    result={playerId,ok:true,alreadyRegistered:Boolean(registered?.alreadyRegistered)};
   }catch(e){result={playerId,ok:false,error:String((e as Error)?.message||"Registration failed.").slice(0,180)};}
   const recorded=await sbRequest("rpc/record_alliance_manual_registration_result",{method:"POST",body:JSON.stringify({p_job_id:job.id,p_player_id:playerId,p_result:result})});
   if(!Array.isArray(recorded)||!recorded.length)throw new Error("Queue job lease was lost while saving a player result.");
  }
  const latest=await sbRequest("alliance_manual_registration_jobs?id=eq."+encodeURIComponent(job.id)+"&select=id,status,total_count,processed_count,failed_count&limit=1");
  const j=Array.isArray(latest)?latest[0]:null;
  if(j&&Number(j.processed_count)>=Number(j.total_count)){
   const status=Number(j.failed_count)>0?"partial":"completed";
   await sbRequest("alliance_manual_registration_jobs?id=eq."+encodeURIComponent(job.id)+"&status=eq.running",{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status,finished_at:new Date().toISOString(),updated_at:new Date().toISOString(),current_player_id:null})});
   outcomes.push({jobId:job.id,status,processed:Number(j.processed_count)});
  }else{
   await sbRequest("alliance_manual_registration_jobs?id=eq."+encodeURIComponent(job.id)+"&status=eq.running",{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"queued",updated_at:new Date().toISOString()})});
   outcomes.push({jobId:job.id,status:"queued",processed:Number(j?.processed_count||0)});
  }
 }
 return outcomes;
}
export default async function handler(req:any,res:any){
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET"&&req.method!=="POST"){res.setHeader("Allow","GET, POST");return res.status(405).json({error:"Method not allowed"});}
 if(!JOB_SECRET||req.headers.authorization!=="Bearer "+JOB_SECRET)return res.status(401).json({error:"Unauthorized"});
 const requestUrl=new URL(req.url||"/","http://localhost");
 if(requestUrl.searchParams.get("mode")==="manual-registration"){try{const jobs=await processManualRegistrationJobs();return res.status(200).json({ok:true,processedJobs:jobs.length,jobs});}catch(e){console.error("Supabase manual registration queue failed",String((e as Error)?.message||e));return res.status(500).json({error:"Manual registration queue processing failed safely."});}}
 const results:any[]=[];
 try {
  // Reconcile abandoned run records only after the lease has expired or a newer success exists.
  const staleConfigs=await selectRows('alliance_sync_config','select=id,lease_token,lease_expires_at,last_success_at');
  for(const c of (Array.isArray(staleConfigs)?staleConfigs:[])) {
   const staleRuns=await selectRows('alliance_sync_runs',`config_id=eq.${enc(c.id)}&status=eq.running&started_at=lt.${enc(new Date(Date.now()-10*60000).toISOString())}&select=id,started_at`);
   for(const run of (Array.isArray(staleRuns)?staleRuns:[])) {
    const expired=!c.lease_token||!c.lease_expires_at||new Date(c.lease_expires_at).getTime()<Date.now();
    if(expired||(c.last_success_at&&new Date(c.last_success_at).getTime()>new Date(run.started_at).getTime()))
     await patchRows('alliance_sync_runs',`id=eq.${enc(run.id)}&status=eq.running`,{finished_at:new Date().toISOString(),status:'error',error_code:'stale_run_reconciled',error_message:'This run was reconciled after its lease expired or a newer run succeeded.'});
   }
  }
  for(let attempt=0;attempt<10;attempt++){
   const lease=randomUUID();
   const claims=await callRpc('claim_due_alliance_sync_config',{p_lease_token:lease});
   if(!Array.isArray(claims)||!claims.length)break;
   const config=claims[0],runId=randomUUID();
   try{
    await insertRows('alliance_sync_runs',{id:runId,config_id:config.id,status:'running'});
    const roster=await loadRoster(String(config.kingdom_id),String(config.alliance_tag));
    const alreadyRegisteredIds=await getRegisteredPlayerIds(roster.members.map((m:any)=>m.id));
    let registered=0,skipped=0,failed=0;const failures:string[]=[];
    for(const member of roster.members){
     const heartbeat=await patchRows('alliance_sync_config',`id=eq.${enc(config.id)}&lease_token=eq.${enc(lease)}&enabled=eq.true`,{lease_expires_at:new Date(Date.now()+4*60000).toISOString()});
     if(!Array.isArray(heartbeat)||!heartbeat.length)throw new Error('Sync lease lost or configuration paused.');
     const priorRows=await selectRows('alliance_sync_seen_players',`config_id=eq.${enc(config.id)}&player_id=eq.${enc(member.id)}&select=registration_status`);
     const prior=Array.isArray(priorRows)&&priorRows.length?String(priorRows[0].registration_status):'';
     await sb('alliance_sync_seen_players?on_conflict=config_id,player_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({config_id:config.id,player_id:member.id,last_seen_at:new Date().toISOString(),registration_status:prior==='departed'?'pending':(prior||'pending')})});
     if(prior&& !['pending','error','departed'].includes(prior)){skipped++;continue;}
     if(alreadyRegisteredIds.has(member.id)){
      await patchRows('alliance_sync_seen_players',`config_id=eq.${enc(config.id)}&player_id=eq.${enc(member.id)}`,{registration_status:'already_registered',registered_at:new Date().toISOString(),last_error_code:null});skipped++;continue;
     }
     try{
      const input=normalizeRegistrationInput({playerId:member.id,kingdomId:String(config.kingdom_id),playerName:member.name,avatarUrl:member.avatarUrl});
      const result=await registerWithRetry(input);if(result?.stale===true)throw new Error('Player record is stale.');
      await patchRows('alliance_sync_seen_players',`config_id=eq.${enc(config.id)}&player_id=eq.${enc(member.id)}`,{registration_status:result?.alreadyRegistered?'already_registered':'registered',registered_at:new Date().toISOString(),last_error_code:null});registered++;
     }catch(e){
      const message=String((e as Error)?.message||'Registration failed.').slice(0,250);
      await patchRows('alliance_sync_seen_players',`config_id=eq.${enc(config.id)}&player_id=eq.${enc(member.id)}`,{registration_status:'error',last_error_code:'registration_failed'});failed++;failures.push(member.id+': '+message);
     }
    }
    // A fresh validated roster is authoritative for membership. Departures remain history; Global Supabase registrations are untouched and stay eligible for the normal auto-redemption cycle.
    const currentIds=new Set(roster.members.map((m:any)=>m.id));
    const priorSeen=await selectRows('alliance_sync_seen_players',`config_id=eq.${enc(config.id)}&registration_status=neq.departed&select=player_id`);
    let departedCount=0;
    for(const row of (Array.isArray(priorSeen)?priorSeen:[]))if(!currentIds.has(String(row.player_id))){await patchRows('alliance_sync_seen_players',`config_id=eq.${enc(config.id)}&player_id=eq.${enc(row.player_id)}`,{registration_status:'departed',last_error_code:null});departedCount++;}
    const status=failed?'partial':'success';const nextRun=new Date(Date.now()+(failed?24*3600000:24*3600000));nextRun.setUTCHours(11,0,0,0);if(nextRun.getTime()<=Date.now())nextRun.setUTCDate(nextRun.getUTCDate()+1);const nextRunAt=nextRun.toISOString();
    const finished=await callRpc('finish_alliance_sync_run',{p_config_id:config.id,p_lease_token:lease,p_run_id:runId,p_status:status,p_roster_count:roster.members.length,p_added_count:registered,p_skipped_count:skipped,p_departed_count:departedCount,p_error_code:failed?'registration_failed':null,p_error_message:failures.slice(0,5).join('; ').slice(0,500)||null,p_next_run_at:nextRunAt,p_alliance_name:roster.name});
    if(finished!==true && !(Array.isArray(finished)&&finished[0]===true))throw new Error('Sync lease was lost before completion.');
    results.push({configId:config.id,status,rosterCount:roster.members.length,registered,skipped,failed,nextRunAt});
   }catch(e){
    const message=String((e as Error)?.message||'Sync failed.').slice(0,400);
    await patchRows('alliance_sync_config',`id=eq.${enc(config.id)}&lease_token=eq.${enc(lease)}`,{lease_token:null,lease_expires_at:null,consecutive_failures:Number(config.consecutive_failures||0)+1,last_status:config.enabled?'error':'paused',last_error_code:'sync_failed',last_error_message:message,next_run_at:new Date(Date.now()+5*60000).toISOString(),updated_at:new Date().toISOString()});
    await patchRows('alliance_sync_runs',`id=eq.${enc(runId)}`,{finished_at:new Date().toISOString(),status:'error',error_code:'sync_failed',error_message:message});
    results.push({configId:config.id,status:'error',message});
   }
  }
  return res.status(200).json({ok:true,processed:results.length,results});
 }catch(e){console.error('Supabase automatic alliance sync failed',String((e as Error)?.message||e));return res.status(500).json({error:'Worker failed safely.'});}
}
