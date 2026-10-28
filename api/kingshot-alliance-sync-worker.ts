import { sql } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { registerPlayer } from "../internal/kingshot/register.js";

const DB_URL=process.env.ALLIANCE_SYNC_DATABASE_URL||"";
const JOB_SECRET=process.env.ALLIANCE_SYNC_CRON_SECRET||"";
const MP_BASE="https://api.mightpulse.com/v1";
async function loadRoster(kingdom:string,tag:string){
 const r=await fetch(MP_BASE+"/alliances/"+encodeURIComponent(kingdom)+"/"+encodeURIComponent(tag)+"?include=info,roster",{headers:{Accept:"application/json"},signal:AbortSignal.timeout(20000)});
 const d:any=await r.json().catch(()=>null);
 if(!r.ok||!d||d.fresh===false||d.stale===true)throw new Error("Provider unavailable or stale roster.");
 const s=d.data&&typeof d.data==="object"?d.data:d,a=s.alliance??s;
 const rows=Array.isArray(s.members)?s.members:Array.isArray(s.roster)?s.roster:Array.isArray(a.members)?a.members:null;
 if(!rows||!rows.length)throw new Error("Empty roster rejected.");
 const members=rows.map((m:any)=>({id:String(m?.governor_id??m?.fid??"").trim(),kid:String(m?.kid??kingdom),name:String(m?.nick_name??m?.name??m?.nickname??"").trim().slice(0,80),avatarUrl:String(m?.avatar_url??m?.avatarUrl??"").trim()})).filter(m=>/^\d{5,20}$/.test(m.id)&&m.kid===kingdom);
 const unique=[...new Map(members.map(m=>[m.id,m])).values()];
 const count=Number(a.member_count??a.memberCount??a.count??rows.length);
 if(!unique.length||unique.length<Math.min(count,5)||(count>0&&unique.length/count<.65))throw new Error("Incomplete roster rejected.");
 if(String(a.abbr??a.tag??tag).toLowerCase()!==tag.toLowerCase())throw new Error("Alliance mismatch.");
 return {name:String(a.name??a.alliance_name??tag).slice(0,80),members:unique};
}
export default async function handler(req:any,res:any){
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="GET"&&req.method!=="POST"){res.setHeader("Allow","GET, POST");return res.status(405).json({error:"Method not allowed"});}
 if(!JOB_SECRET||req.headers.authorization!=="Bearer "+JOB_SECRET)return res.status(401).json({error:"Unauthorized"});
 if(!DB_URL)return res.status(503).json({error:"Sync DB not configured"});
 const db=sql(DB_URL);
 const now=new Date();
 try{
  // A single UPDATE with a SKIP-LOCKED subquery is the durable atomic lease claim.
  const claims=await db`with due as (
   select id from public.alliance_sync_config
   where enabled=true and next_run_at<=${now.toISOString()}::timestamptz and (lease_expires_at is null or lease_expires_at<now())
   order by next_run_at for update skip locked limit 1
  )
  update public.alliance_sync_config c set lease_token=${randomUUID()}::uuid,lease_expires_at=now()+interval '4 minutes',last_status='running',last_attempt_at=now(),updated_at=now()
  from due where c.id=due.id returning c.*`;
  if(!claims.length)return res.status(200).json({ok:true,claimed:0});
  const config=claims[0],runId=randomUUID();
  await db`insert into public.alliance_sync_runs(id,config_id,status) values(${runId}::uuid,${config.id}::uuid,'running')`;
  try{
   const roster=await loadRoster(String(config.kingdom_id),String(config.alliance_tag));
   let added=0,skipped=0;
   for(const member of roster.members){
    const seen=await db`insert into public.alliance_sync_seen_players(config_id,player_id,registration_status) values(${config.id}::uuid,${member.id},'pending') on conflict(config_id,player_id) do update set last_seen_at=now() returning (xmax=0) as is_new`;
    if(!seen[0]?.is_new){skipped++;continue;}
    try{
     const input={playerId:member.id,kingdomId:String(config.kingdom_id),playerName:member.name,avatarUrl:member.avatarUrl};
     const normalized={playerId:member.id,kingdomId:String(config.kingdom_id),playerName:member.name,avatarUrl:member.avatarUrl};
     const supa=await fetch((process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co")+"/rest/v1/rpc/register_kingshot_player_v2",{method:"POST",headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY||"",authorization:"Bearer "+(process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY||""),"content-type":"application/json"},body:JSON.stringify({p_player_id:input.playerId,p_kingdom_id:input.kingdomId,p_player_name:input.playerName||null,p_avatar_url:input.avatarUrl||null}),signal:AbortSignal.timeout(10000)});
     const result:any=await supa.json().catch(()=>null);
     if(!supa.ok)throw new Error(result?.message||"Supabase registration failed.");
     await db`update public.alliance_sync_seen_players set registration_status=${(Array.isArray(result)?result[0]:result)?.already_registered?"already_registered":"registered"},registered_at=now() where config_id=${config.id}::uuid and player_id=${member.id}`;
     added++;
    }catch(e){
     await db`update public.alliance_sync_seen_players set registration_status='error',last_error_code='registration_failed' where config_id=${config.id}::uuid and player_id=${member.id}`;
     throw e;
    }
   }
   const nextRun=new Date(Date.now()+Number(config.interval_hours||24)*3600000).toISOString();
   await db`update public.alliance_sync_config set alliance_name=${roster.name},last_success_at=now(),next_run_at=${nextRun}::timestamptz,lease_token=null,lease_expires_at=null,consecutive_failures=0,last_status='success',last_error_code=null,last_error_message=null,last_roster_count=${roster.members.length},last_added_count=${added},updated_at=now() where id=${config.id}::uuid`;
   await db`update public.alliance_sync_runs set finished_at=now(),status='success',roster_count=${roster.members.length},added_count=${added},skipped_count=${skipped} where id=${runId}::uuid`;
   return res.status(200).json({ok:true,claimed:1,configId:config.id,rosterCount:roster.members.length,addedCount:added,skippedCount:skipped});
  }catch(e){
   const message=String((e as Error)?.message||"sync failed").slice(0,400);
   await db`update public.alliance_sync_config set lease_token=null,lease_expires_at=null,consecutive_failures=consecutive_failures+1,last_status=case when enabled then 'error' else 'paused' end,last_error_code='sync_failed',last_error_message=${message},next_run_at=now()+least(interval '6 hours',interval '5 minutes'*power(2,least(consecutive_failures,6))),updated_at=now() where id=${config.id}::uuid`;
   await db`update public.alliance_sync_runs set finished_at=now(),status='error',error_code='sync_failed',error_message=${message} where id=${runId}::uuid`;
   return res.status(502).json({error:message,claimed:1});
  }
 }catch(e){return res.status(500).json({error:"Worker failed safely."});}
}
