import { rateLimit } from "../lib/request-rate-limit.js";
import { isAuthenticatedProfileRequest } from "../lib/developer-auth.js";
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { normalizeRegistrationInput, registerPlayer } from "../internal/kingshot/register.js";

interface Req { method?: string; url?: string; headers: Record<string,string|string[]|undefined>; body?: Record<string,unknown>; query?: Record<string,unknown>; }
interface Res { status(n:number):Res; json(v:unknown):Res; setHeader(k:string,v:string|string[]):void; }
const DB_URL = process.env.ALLIANCE_SYNC_DATABASE_URL || "";
const MP_BASE = "https://api.mightpulse.com/v1";
function header(req:Req,key:string){const v=req.headers[key.toLowerCase()]??req.headers[key];return Array.isArray(v)?v[0]:String(v||"");}
function fail(res:Res,status:number,code:string,message:string){res.status(status).json({error:message,code});}
function validKingdom(v:unknown){return /^\d{1,10}$/.test(String(v??""));}
function validTag(v:unknown){return /^[A-Za-z0-9_-]{1,20}$/.test(String(v??""));}
function getParam(req:Req,key:string){const url=new URL(req.url||"/","http://localhost");return String(req.query?.[key]??url.searchParams.get(key)??"").trim();}
function database(){if(!DB_URL)throw new Error("Alliance sync database is not configured."); return neon(DB_URL);}
async function getProfileOwner(req:Req):Promise<string|null>{
 const cookie=header(req,"cookie");
 const match=cookie.split(";").map(v=>v.trim()).find(v=>v.startsWith("__Host-ks_profile_session="));
 if(!match)return null;
 let token="";try{token=decodeURIComponent(match.slice(match.indexOf("=")+1))}catch{return null}
 if(!token)return null;
 const base=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
 if(!key)return null;
 const hash=await import("node:crypto").then(m=>m.createHash("sha256").update(token).digest("hex"));
 const rr=await fetch(base+"/rest/v1/rpc/kingshot_developer_account_session_get",{method:"POST",headers:{apikey:key,authorization:"Bearer "+key,"content-type":"application/json"},body:JSON.stringify({p_token_hash:hash}),signal:AbortSignal.timeout(8000)});
 const userId=await rr.json().catch(()=>null);
 if(!rr.ok||typeof userId!=="string"||!userId)return null;
 const ur=await fetch(base+"/auth/v1/admin/users/"+encodeURIComponent(userId),{headers:{apikey:key,authorization:"Bearer "+key},signal:AbortSignal.timeout(8000)});
 const user:any=await ur.json().catch(()=>null);
 const providers=Array.isArray(user?.app_metadata?.providers)?user.app_metadata.providers:[];
 const discord=providers.includes("discord")||(Array.isArray(user?.identities)&&user.identities.some((i:any)=>i?.provider==="discord"));
 return ur.ok&&discord?String(user.id):null;
}
async function readAlliance(kingdomId:string,tag:string){
 const u=MP_BASE+"/alliances/"+encodeURIComponent(kingdomId)+"/"+encodeURIComponent(tag)+"?include=info,roster";
 const r=await fetch(u,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(20000)});
 const d:any=await r.json().catch(()=>null);
 if(!r.ok)throw Object.assign(new Error(r.status===429?"Provider rate limited.":"Alliance provider unavailable."),{status:r.status});
 if(!d||typeof d!=="object"||d.fresh===false||d.stale===true)throw Object.assign(new Error("Provider roster is marked stale or malformed."),{code:"stale_roster"});
 const s=d.data&&typeof d.data==="object"?d.data:d;
 const a=s.alliance??s;
 const raw=Array.isArray(s.members)?s.members:Array.isArray(s.roster)?s.roster:Array.isArray(a.members)?a.members:null;
 if(!raw||raw.length===0)throw Object.assign(new Error("Provider returned no usable roster; schedule was not advanced."),{code:"empty_roster"});
 const members=raw.flatMap((m:any)=>{
  const id=String(m?.governor_id??m?.fid??"").trim();
  const kid=String(m?.kid??kingdomId);
  if(!/^\d{5,20}$/.test(id)||kid!==kingdomId)return [];
  return [{id,name:String(m?.nick_name??m?.name??m?.nickname??"").trim().slice(0,80),avatarUrl:String(m?.avatar_url??m?.avatarUrl??"").trim(),kingdomId:kid}];
 });
 const unique=[...new Map(members.map(m=>[m.id,m])).values()];
 const count=Number(a.member_count??a.memberCount??a.count??raw.length);
 // Fail closed on suspiciously incomplete responses. The source count can include malformed rows,
 // so even a handful of invalid rows are tolerated, but a large discrepancy is not.
 if(!unique.length||unique.length<Math.min(count,5)|| (count>0&&unique.length/count<0.65))
  throw Object.assign(new Error("Roster validation failed; no members were registered."),{code:"incomplete_roster"});
 const canonicalTag=String(a.abbr??a.tag??tag).trim();
 if(canonicalTag.toLocaleLowerCase()!==tag.toLocaleLowerCase())throw Object.assign(new Error("Alliance tag does not match the requested alliance."),{code:"alliance_mismatch"});
 return {name:String(a.name??a.alliance_name??tag).trim().slice(0,80),tag:canonicalTag,members:unique,rawCount:raw.length};
}
async function performSync(config:any,ownerId:string,manual:boolean){
 const db=database();
 const runId=randomUUID();
 await db`insert into public.alliance_sync_runs (id,config_id,status) values (${runId}::uuid,${config.id}::uuid,'running')`;
 try{
  const roster=await readAlliance(String(config.kingdom_id),String(config.alliance_tag));
  let added=0,skipped=0;
  for(const member of roster.members){
   const inserted=await db`insert into public.alliance_sync_seen_players (config_id,player_id,first_seen_at,last_seen_at,registration_status)
   values (${config.id}::uuid,${member.id},now(),now(),'pending')
   on conflict (config_id,player_id) do update set last_seen_at=now()
   returning registration_status,(xmax = 0) as is_new`;
   const isNew=Boolean(inserted[0]?.is_new);
   const prior=String(inserted[0]?.registration_status||"pending");
   // Retry failed/pending discoveries, but never reprocess a successfully tracked member.
   if(!isNew&&!["pending","error"].includes(prior)){skipped++;continue}
   try{
    // Keep the established RPC for the actual player insert, including its idempotency and policy checks.
    const input=normalizeRegistrationInput({playerId:member.id,kingdomId:String(config.kingdom_id),playerName:member.name,avatarUrl:member.avatarUrl});
    const result=await registerPlayer(input);
    if(result?.stale===true)throw new Error("Player data is stale.");
    const already=Boolean(result?.already_registered);
    await db`update public.alliance_sync_seen_players set registration_status=${already?"already_registered":"registered"},registered_at=now(),last_error_code=null where config_id=${config.id}::uuid and player_id=${member.id}`;
    added++;
   }catch(e){
    const message=String((e as Error)?.message||"Registration failed.").slice(0,300);
    await db`update public.alliance_sync_seen_players set registration_status='error',last_error_code='registration_failed' where config_id=${config.id}::uuid and player_id=${member.id}`;
    throw new Error("New member registration failed for "+member.id+": "+message);
   }
  }
  const nextRun=new Date(Date.now()+Number(config.interval_hours||24)*3600000).toISOString();
  await db`update public.alliance_sync_config set alliance_name=${roster.name},last_attempt_at=now(),last_success_at=now(),next_run_at=${nextRun}::timestamptz,lease_token=null,lease_expires_at=null,consecutive_failures=0,last_status=case when enabled then 'success' else 'paused' end,last_error_code=null,last_error_message=null,last_roster_count=${roster.members.length},last_added_count=${added},updated_at=now() where id=${config.id}::uuid`;
  await db`update public.alliance_sync_runs set finished_at=now(),status='success',roster_count=${roster.members.length},added_count=${added},skipped_count=${skipped} where id=${runId}::uuid`;
  return {ok:true,rosterCount:roster.members.length,addedCount:added,skippedCount:skipped,nextRunAt:nextRun,manual};
 }catch(e){
  const message=String((e as Error)?.message||"Sync failed.").slice(0,500);
  const code=String((e as any)?.code||"sync_failed").slice(0,60);
  await db`update public.alliance_sync_config set last_attempt_at=now(),lease_token=null,lease_expires_at=null,consecutive_failures=consecutive_failures+1,last_status=case when enabled then 'error' else 'paused' end,last_error_code=${code},last_error_message=${message},next_run_at=now()+least(interval '6 hours', interval '5 minutes' * power(2,least(consecutive_failures,6))),updated_at=now() where id=${config.id}::uuid`;
  await db`update public.alliance_sync_runs set finished_at=now(),status='error',error_code=${code},error_message=${message} where id=${runId}::uuid`;
  throw e;
 }
}
export default async function handler(req:Req,res:Res){
 res.setHeader("Cache-Control","private, no-store");
 if(req.method!=="GET"&&req.method!=="POST"&&req.method!=="PATCH"){res.setHeader("Allow","GET, POST, PATCH");return fail(res,405,"method_not_allowed","Method not allowed.");}
 if(!DB_URL)return fail(res,503,"sync_unavailable","Alliance sync service is not configured.");
 if(!await isAuthenticatedProfileRequest(req))return fail(res,401,"authentication_required","Sign in with Discord to manage alliance sync.");
 if(!rateLimit(req,res,"alliance-sync",30,60000))return;
 try{
  const db=database();
  const ownerId=await getProfileOwner(req);
  if(!ownerId)return fail(res,401,"authentication_required","Your Discord session could not be verified.");
  const action=String(req.body?.action??getParam(req,"action")??"list");
  if(req.method==="GET"||action==="list"){
   const rows=await db`select id,kingdom_id,alliance_tag,alliance_name,enabled,interval_hours,last_attempt_at,last_success_at,next_run_at,consecutive_failures,last_status,last_error_code,last_error_message,last_roster_count,last_added_count,created_at,updated_at from public.alliance_sync_config where owner_user_id=${ownerId}::uuid order by created_at desc`;
   return res.status(200).json({configs:rows});
  }
  if(action==="create"){
   const kingdom=String(req.body?.kingdomId??"").trim(),tag=String(req.body?.allianceTag??"").trim(),name=String(req.body?.allianceName??tag).trim().slice(0,80);
   const interval=Number(req.body?.intervalHours??24);
   if(!validKingdom(kingdom)||!validTag(tag))return fail(res,400,"invalid_alliance","Check the kingdom ID and alliance tag.");
   if(![24,48,72,168].includes(interval))return fail(res,400,"invalid_interval","Sync interval must be 24, 48, 72, or 168 hours.");
   const verified=await readAlliance(kingdom,tag);
   const result=await db`insert into public.alliance_sync_config (owner_user_id,kingdom_id,alliance_tag,alliance_name,interval_hours,enabled,next_run_at,last_status,last_roster_count) values (${ownerId}::uuid,${kingdom},${verified.tag},${verified.name},${interval},true,now(),'pending',${verified.members.length}) on conflict (owner_user_id,kingdom_id,alliance_tag) do update set alliance_name=excluded.alliance_name,interval_hours=excluded.interval_hours,enabled=true,next_run_at=now(),last_status='pending',updated_at=now() returning id,kingdom_id,alliance_tag,alliance_name,enabled,interval_hours,next_run_at,last_status`;
   return res.status(201).json({config:result[0],validatedRosterCount:verified.members.length});
  }
  const id=String(req.body?.id??"");
  if(!/^[0-9a-f-]{36}$/i.test(id))return fail(res,400,"invalid_config_id","Choose a valid sync configuration.");
  const rows=await db`select * from public.alliance_sync_config where id=${id}::uuid and owner_user_id=${ownerId}::uuid limit 1`;
  const config=rows[0];if(!config)return fail(res,404,"not_found","Sync configuration not found.");
  if(action==="pause"||action==="resume"){
   const enabled=action==="resume";
   const updated=await db`update public.alliance_sync_config set enabled=${enabled},last_status=${enabled?'pending':'paused'},next_run_at=case when ${enabled} then now() else next_run_at end,updated_at=now() where id=${id}::uuid and owner_user_id=${ownerId}::uuid returning id,enabled,last_status,next_run_at`;
   return res.status(200).json({config:updated[0]});
  }
  if(action==="delete"){return fail(res,405,"not_supported","Sync configurations are retained for auditability; pause this configuration instead.");}
  if(action==="sync"){
   const lease= randomUUID();
   const claimed=await db`update public.alliance_sync_config set lease_token=${lease}::uuid,lease_expires_at=now()+interval '4 minutes',last_status='running',updated_at=now() where id=${id}::uuid and owner_user_id=${ownerId}::uuid and (lease_expires_at is null or lease_expires_at<now()) returning *`;
   if(!claimed.length)return fail(res,409,"sync_in_progress","A sync is already running for this alliance.");
   const result=await performSync(claimed[0],ownerId,true);
   return res.status(200).json(result);
  }
  return fail(res,400,"unknown_action","Unsupported alliance sync action.");
 }catch(e){
  const error=e as Error&{status?:number;code?:string};
  return fail(res,error.status===429?429:error.status===404?404:502,error.code||"sync_failed",String(error.message||"Alliance sync failed.").slice(0,300));
 }
}
