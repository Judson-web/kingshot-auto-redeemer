import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { normalizeRegistrationInput, registerPlayer } from "./register.js";
import { getRegisteredPlayerIds } from "./registered-player-ids.js";
import { fetchMightPulse } from "../../lib/mightpulse-key-pool.js";

const DB_URL=process.env.ALLIANCE_SYNC_DATABASE_URL||"";
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
async function processManualRegistrationJobs(db:any){
 const outcomes:any[]=[];
 for(let attempt=0;attempt<3;attempt++){
  const candidates=await db`select id,updated_at from public.alliance_manual_registration_jobs where status='queued' or (status='running' and updated_at<now()-interval '120 seconds') order by created_at limit 1`;
  if(!candidates.length)break;
  const candidate=candidates[0];
  const claimed=await db`update public.alliance_manual_registration_jobs set status='running',started_at=coalesce(started_at,now()),updated_at=now() where id=${candidate.id}::uuid and updated_at=${candidate.updated_at}::timestamptz and (status='queued' or (status='running' and updated_at<now()-interval '120 seconds')) returning id`;
  if(!claimed.length)continue;
  const rows=await db`select j.*,c.kingdom_id,c.alliance_tag from public.alliance_manual_registration_jobs j join public.alliance_sync_config c on c.id=j.config_id where j.id=${candidate.id}::uuid limit 1`;
  if(!rows.length)continue;
  const job=rows[0];const ids=Array.isArray(job.selected_player_ids)?job.selected_player_ids:JSON.parse(String(job.selected_player_ids||'[]'));
  const offset=Number(job.processed_count||0);const batch=ids.slice(offset,offset+5);
  if(!batch.length){const status=Number(job.failed_count||0)>0?'partial':'completed';await db`update public.alliance_manual_registration_jobs set status=${status},finished_at=now(),updated_at=now(),current_player_id=null where id=${job.id}::uuid`;outcomes.push({jobId:job.id,status});continue;}
  let roster;try{roster=await loadRoster(String(job.kingdom_id),String(job.alliance_tag));}catch(e){const message=String((e as Error)?.message||'Roster validation failed.').slice(0,250);await db`update public.alliance_manual_registration_jobs set status='failed',error_message=${message},finished_at=now(),updated_at=now() where id=${job.id}::uuid`;outcomes.push({jobId:job.id,status:'failed'});continue;}
  const members=new Map(roster.members.map((m:any)=>[m.id,m]));
  for(const playerIdValue of batch){const playerId=String(playerIdValue);let result:any;try{const member:any=members.get(playerId);if(!member)throw new Error('Player is no longer in the validated alliance roster.');const input=normalizeRegistrationInput({playerId,kingdomId:String(job.kingdom_id),playerName:member.name,avatarUrl:member.avatarUrl});const registered=await registerWithRetry(input);result={playerId,ok:true,alreadyRegistered:Boolean(registered?.alreadyRegistered)};}catch(e){result={playerId,ok:false,error:String((e as Error)?.message||'Registration failed.').slice(0,180)};}await db`update public.alliance_manual_registration_jobs set processed_count=processed_count+1,succeeded_count=succeeded_count+${result.ok?1:0},failed_count=failed_count+${result.ok?0:1},skipped_count=skipped_count+${result.alreadyRegistered?1:0},current_player_id=${playerId},results=coalesce(results,'[]'::jsonb)||${JSON.stringify([result])}::jsonb,updated_at=now() where id=${job.id}::uuid and status='running'`;}
  const latest=await db`select processed_count,total_count,failed_count from public.alliance_manual_registration_jobs where id=${job.id}::uuid limit 1`;
  if(latest.length&&Number(latest[0].processed_count)>=Number(latest[0].total_count)){const status=Number(latest[0].failed_count)>0?'partial':'completed';await db`update public.alliance_manual_registration_jobs set status=${status},finished_at=now(),updated_at=now(),current_player_id=null where id=${job.id}::uuid`;outcomes.push({jobId:job.id,status,processed:Number(latest[0].processed_count)});}else outcomes.push({jobId:job.id,status:'running',processed:Number(latest[0]?.processed_count||0)});
 }
 return outcomes;
}
export default async function handler(req:any,res:any){
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET"&&req.method!=="POST"){res.setHeader("Allow","GET, POST");return res.status(405).json({error:"Method not allowed"});}
 if(!JOB_SECRET||req.headers.authorization!=="Bearer "+JOB_SECRET)return res.status(401).json({error:"Unauthorized"});
 if(!DB_URL)return res.status(503).json({error:"Sync DB not configured"});
 const db=neon(DB_URL);
 const requestUrl=new URL(req.url||"/","http://localhost");
 if(requestUrl.searchParams.get("mode")==="manual-registration"){try{const jobs=await processManualRegistrationJobs(db);return res.status(200).json({ok:true,processedJobs:jobs.length,jobs});}catch{return res.status(500).json({error:"Manual registration queue processing failed safely."});}}
 const results:any[]=[];
 try{
  // Reconcile abandoned run rows before claiming new work. A valid, unexpired lease
  // protects a live run; a later successful run also proves an older "running" row stale.
  await db`update public.alliance_sync_runs as r
   set finished_at=now(),status='error',error_code='stale_run_reconciled',
       error_message='This sync run did not finish. It was reconciled automatically after its lease expired or a newer run succeeded.'
   from public.alliance_sync_config as c
   where r.config_id=c.id and r.status='running'
     and r.started_at < now()-interval '10 minutes'
     and ((c.lease_token is null or c.lease_expires_at is null or c.lease_expires_at < now())
       or c.last_success_at > r.started_at)`;
  // One invocation handles a small bounded batch, so a daily schedule can serve multiple alliances
  // without competing with the separate redemption worker.
  for(let attempt=0;attempt<10;attempt++){
   const lease=randomUUID();
   const claims=await db`with due as (
    select id from public.alliance_sync_config
    where enabled=true and next_run_at<=now() and (lease_expires_at is null or lease_expires_at<now())
    order by next_run_at for update skip locked limit 1
   )
   update public.alliance_sync_config c set lease_token=${lease}::uuid,lease_expires_at=now()+interval '4 minutes',last_status='running',last_attempt_at=now(),updated_at=now()
   from due where c.id=due.id returning c.*`;
   if(!claims.length)break;
   const config=claims[0],runId=randomUUID();
   try{
    await db`insert into public.alliance_sync_runs(id,config_id,status) values(${runId}::uuid,${config.id}::uuid,'running')`;
    const roster=await loadRoster(String(config.kingdom_id),String(config.alliance_tag));
    // Reconcile against Supabase before attempting any registration writes.
    const alreadyRegisteredIds=await getRegisteredPlayerIds(roster.members.map(member=>member.id));
    let registered=0,skipped=0,failed=0;const failures:string[]=[];
    for(const member of roster.members){
     const heartbeat=await db`update public.alliance_sync_config set lease_expires_at=now()+interval '4 minutes' where id=${config.id}::uuid and lease_token=${lease}::uuid and enabled=true returning id`;
     if(!heartbeat.length) throw new Error("Sync lease lost or configuration paused.");
     const seen=await db`insert into public.alliance_sync_seen_players(config_id,player_id,registration_status)
      values(${config.id}::uuid,${member.id},'pending')
      on conflict(config_id,player_id) do update
      set last_seen_at=now(),
          registration_status=case
            when alliance_sync_seen_players.registration_status='departed' then 'pending'
            else alliance_sync_seen_players.registration_status
          end
      returning registration_status,(xmax=0) as is_new`;
     const prior=String(seen[0]?.registration_status||"pending");
     const isNew=Boolean(seen[0]?.is_new);
     // Retry pending/error rows only. Successfully processed members are intentionally never re-registered.
     if(!isNew&&!["pending","error"].includes(prior)){skipped++;continue;}
     if(alreadyRegisteredIds.has(member.id)){
      await db`update public.alliance_sync_seen_players set registration_status='already_registered',registered_at=coalesce(registered_at,now()),last_error_code=null where config_id=${config.id}::uuid and player_id=${member.id}`;
      skipped++;
      continue;
     }
     try{
      const input=normalizeRegistrationInput({playerId:member.id,kingdomId:String(config.kingdom_id),playerName:member.name,avatarUrl:member.avatarUrl});
      const result=await registerWithRetry(input);
      if(result?.stale===true)throw new Error("Player record is stale.");
      const status=result?.alreadyRegistered?"already_registered":"registered";
      await db`update public.alliance_sync_seen_players set registration_status=${status},registered_at=coalesce(registered_at,now()),last_error_code=null where config_id=${config.id}::uuid and player_id=${member.id}`;
      registered++;
     }catch(e){
      const message=String((e as Error)?.message||"registration failed").slice(0,250);
      await db`update public.alliance_sync_seen_players set registration_status='error',last_error_code='registration_failed' where config_id=${config.id}::uuid and player_id=${member.id}`;
      failed++;failures.push(member.id+": "+message);
      continue;
     }
    }
    // Only a validated, fresh roster can establish departures. Keep the per-alliance
    // history row, but mark absent members as departed. Never delete their global Supabase
    // registration: they remain eligible for the normal auto-redemption cycle.
    const currentMemberIds=roster.members.map(member=>member.id);
    const departedRows=await db`update public.alliance_sync_seen_players as seen
      set registration_status='departed',last_error_code=null
      where seen.config_id=${config.id}::uuid
        and seen.registration_status<>'departed'
        and not (seen.player_id = any(${currentMemberIds}::text[]))
      returning seen.player_id`;
    const departedCount=departedRows.length;
    const nextRun=new Date(Date.now()+(failed>0?5*60000:24*3600000)).toISOString();
    await db`update public.alliance_sync_config set alliance_name=${roster.name},last_success_at=now(),next_run_at=${nextRun}::timestamptz,lease_token=null,lease_expires_at=null,consecutive_failures=case when ${failed}>0 then consecutive_failures+1 else 0 end,last_status=case when ${failed}>0 then 'partial' else 'success' end,last_error_code=case when ${failed}>0 then 'registration_failed' else null end,last_error_message=${failures.slice(0,5).join('; ').slice(0,500)||null},last_roster_count=${roster.members.length},last_added_count=${registered},updated_at=now() where id=${config.id}::uuid`;
    await db`update public.alliance_sync_runs set finished_at=now(),status=${failed>0?'partial':'success'},roster_count=${roster.members.length},added_count=${registered},skipped_count=${skipped},departed_count=${departedCount},error_code=${failed>0?'registration_failed':null},error_message=${failures.slice(0,5).join('; ').slice(0,500)||null} where id=${runId}::uuid`;
    results.push({configId:config.id,status:failed>0?"partial":"success",rosterCount:roster.members.length,registered,skipped,failed,nextRunAt:nextRun});
   }catch(e){
    const message=String((e as Error)?.message||"sync failed").slice(0,400);
    await db`update public.alliance_sync_config set lease_token=null,lease_expires_at=null,consecutive_failures=consecutive_failures+1,last_status=case when enabled then 'error' else 'paused' end,last_error_code='sync_failed',last_error_message=${message},next_run_at=now()+least(interval '6 hours',interval '5 minutes'*power(2,least(consecutive_failures,6))),updated_at=now() where id=${config.id}::uuid`;
    await db`update public.alliance_sync_runs set finished_at=now(),status='error',error_code='sync_failed',error_message=${message} where id=${runId}::uuid`;
    results.push({configId:config.id,status:"error",message});
   }
  }
  return res.status(200).json({ok:true,processed:results.length,results});
 }catch(e){return res.status(500).json({error:"Worker failed safely."});}
}
