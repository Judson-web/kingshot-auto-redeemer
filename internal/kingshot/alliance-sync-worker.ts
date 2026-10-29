import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { normalizeRegistrationInput, registerPlayer } from "./register.js";
import { getRegisteredPlayerIds } from "./registered-player-ids.js";

const DB_URL=process.env.ALLIANCE_SYNC_DATABASE_URL||"";
const JOB_SECRET=process.env.ALLIANCE_SYNC_CRON_SECRET||process.env.CRON_SECRET||"";
const MP_BASE="https://api.mightpulse.com/v1";
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function registerWithRetry(input:any){let last:unknown;for(let attempt=0;attempt<3;attempt++){try{return await registerPlayer(input)}catch(error){last=error;if(attempt<2)await wait(400*(attempt+1));}}throw last instanceof Error?last:new Error("Registration failed after retries.");}
async function loadRoster(kingdom:string,tag:string){
 const r=await fetch(MP_BASE+"/alliances/"+encodeURIComponent(kingdom)+"/"+encodeURIComponent(tag)+"?include=info,roster",{headers:{Accept:"application/json"},signal:AbortSignal.timeout(20000)});
 const d:any=await r.json().catch(()=>null);
 if(!r.ok||!d||d.fresh===false||d.stale===true)throw new Error("Provider unavailable or stale roster.");
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
export default async function handler(req:any,res:any){
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET"&&req.method!=="POST"){res.setHeader("Allow","GET, POST");return res.status(405).json({error:"Method not allowed"});}
 if(!JOB_SECRET||req.headers.authorization!=="Bearer "+JOB_SECRET)return res.status(401).json({error:"Unauthorized"});
 if(!DB_URL)return res.status(503).json({error:"Sync DB not configured"});
 const db=neon(DB_URL);
 const results:any[]=[];
 try{
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
