import { rateLimit } from "../../lib/request-rate-limit.js";
import { isAuthenticatedProfileRequest } from "../../lib/developer-auth.js";
import { selectRows, insertRows, patchRows, callRpc, enc } from "./alliance-sync-store.js";
import { randomUUID } from "node:crypto";
import { normalizeRegistrationInput, registerPlayer } from "./register.js";
import { getRegisteredPlayerIds } from "./registered-player-ids.js";
import { fetchMightPulse } from "../../lib/mightpulse-key-pool.js";

interface Req { method?: string; url?: string; headers: Record<string,string|string[]|undefined>; body?: Record<string,unknown>; query?: Record<string,unknown>; }
interface Res { status(n:number):Res; json(v:unknown):Res; setHeader(k:string,v:string|string[]):void; }
function header(req:Req,key:string){const v=req.headers[key.toLowerCase()]??req.headers[key];return Array.isArray(v)?v[0]:String(v||"");}
function fail(res:Res,status:number,code:string,message:string){res.status(status).json({error:message,code});}
function validKingdom(v:unknown){return /^\d{1,10}$/.test(String(v??""));}
function validTag(v:unknown){return /^[A-Za-z0-9_-]{1,20}$/.test(String(v??""));}
function getParam(req:Req,key:string){const url=new URL(req.url||"/","http://localhost");return String(req.query?.[key]??url.searchParams.get(key)??"").trim();}
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function registerWithRetry(input:any){let last:unknown;for(let attempt=0;attempt<3;attempt++){try{return await registerPlayer(input)}catch(error){last=error;if(attempt<2)await wait(400*(attempt+1));}}throw last instanceof Error?last:new Error("Registration failed after retries.");}
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
 const u="https://api.mightpulse.com/v1/alliances/"+encodeURIComponent(kingdomId)+"/"+encodeURIComponent(tag)+"?include=info,roster";
 const r=await fetchMightPulse(u,{headers:{Accept:"application/json"}},{timeoutMs:20000});
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
 const byId = new Map<string, {id:string;name:string;avatarUrl:string;kingdomId:string}>();
 for (const member of members) if (!byId.has(member.id)) byId.set(member.id, member);
 const unique=[...byId.values()];
 const rawCount=a.member_count??a.memberCount??a.count;
 const count=rawCount==null?raw.length:Number(rawCount);
 // Fail closed on invalid counts and suspiciously incomplete responses. The source count can
 // include malformed rows, so a handful of invalid rows are tolerated, but large discrepancies are not.
 if(!Number.isFinite(count)||count<1||!unique.length||unique.length<Math.min(count,5)|| (count>0&&unique.length/count<0.65))
  throw Object.assign(new Error("Roster validation failed; no members were registered."),{code:"incomplete_roster"});
 const canonicalTag=String(a.abbr??a.tag??tag).trim();
 if(canonicalTag.toLocaleLowerCase()!==tag.toLocaleLowerCase())throw Object.assign(new Error("Alliance tag does not match the requested alliance."),{code:"alliance_mismatch"});
 return {name:String(a.name??a.alliance_name??tag).trim().slice(0,80),tag:canonicalTag,members:unique,rawCount:raw.length};
}
async function performSync(config:any,ownerId:string,manual:boolean,leaseToken:string){
 const runId=randomUUID();let roster:any=null;let added=0,skipped=0,failed=0;const failures:string[]=[];
 try{
  await insertRows('alliance_sync_runs',{id:runId,config_id:config.id,status:'running'});
  roster=await readAlliance(String(config.kingdom_id),String(config.alliance_tag));
  await patchRows('alliance_sync_runs',`id=eq.${enc(runId)}`,{roster_count:roster.members.length});
  const alreadyRegisteredIds=await getRegisteredPlayerIds(roster.members.map((m:any)=>m.id));
  for(const member of roster.members){
   const heartbeat=await patchRows('alliance_sync_config',`id=eq.${enc(config.id)}&lease_token=eq.${enc(leaseToken)}&enabled=eq.true`,{lease_expires_at:new Date(Date.now()+4*60000).toISOString()});
   if(!Array.isArray(heartbeat)||!heartbeat.length)throw new Error('Sync lease lost or configuration paused.');
   const old=await selectRows('alliance_sync_seen_players',`config_id=eq.${enc(config.id)}&player_id=eq.${enc(member.id)}&select=registration_status`);
   const prior=Array.isArray(old)&&old.length?String(old[0].registration_status):'';
   await insertRows('alliance_sync_seen_players',{config_id:config.id,player_id:member.id,last_seen_at:new Date().toISOString(),registration_status:prior==='departed'?'pending':(prior||'pending')}).catch(async e=>{
    // Composite-key conflict is handled with an upsert request, retaining the original first_seen_at.
    const { sb }=await import('./alliance-sync-store.js');
    await sb('alliance_sync_seen_players?on_conflict=config_id,player_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({config_id:config.id,player_id:member.id,last_seen_at:new Date().toISOString(),registration_status:prior==='departed'?'pending':(prior||'pending')})});
   });
   if(prior&& !['pending','error','departed'].includes(prior)){skipped++;continue;}
   if(alreadyRegisteredIds.has(member.id)){
    await patchRows('alliance_sync_seen_players',`config_id=eq.${enc(config.id)}&player_id=eq.${enc(member.id)}`,{registration_status:'already_registered',registered_at:new Date().toISOString(),last_error_code:null});skipped++;continue;
   }
   try{
    const input=normalizeRegistrationInput({playerId:member.id,kingdomId:String(config.kingdom_id),playerName:member.name,avatarUrl:member.avatarUrl});
    const result=await registerWithRetry(input);if(result?.stale===true)throw new Error('Player data is stale.');
    await patchRows('alliance_sync_seen_players',`config_id=eq.${enc(config.id)}&player_id=eq.${enc(member.id)}`,{registration_status:result?.alreadyRegistered?'already_registered':'registered',registered_at:new Date().toISOString(),last_error_code:null});added++;
   }catch(e){const message=String((e as Error)?.message||'Registration failed.').slice(0,300);await patchRows('alliance_sync_seen_players',`config_id=eq.${enc(config.id)}&player_id=eq.${enc(member.id)}`,{registration_status:'error',last_error_code:'registration_failed'});failed++;failures.push(member.id+': '+message);}
  }
  // A fresh validated roster is authoritative for membership. Departures remain history and global registrations are never removed.
  const currentIds=new Set(roster.members.map((m:any)=>m.id));
  const seen=await selectRows('alliance_sync_seen_players',`config_id=eq.${enc(config.id)}&registration_status=neq.departed&select=player_id`);let departed=0;
  for(const row of (Array.isArray(seen)?seen:[]))if(!currentIds.has(String(row.player_id))){await patchRows('alliance_sync_seen_players',`config_id=eq.${enc(config.id)}&player_id=eq.${enc(row.player_id)}`,{registration_status:'departed',last_error_code:null});departed++;}
  const status=failed?'partial':'success';const nextRun=new Date(Date.now()+(failed?5*60000:24*3600000)).toISOString();
  const done=await callRpc('finish_alliance_sync_run',{p_config_id:config.id,p_lease_token:leaseToken,p_run_id:runId,p_status:status,p_roster_count:roster.members.length,p_added_count:added,p_skipped_count:skipped,p_departed_count:departed,p_error_code:failed?'registration_failed':null,p_error_message:failures.slice(0,5).join('; ').slice(0,500)||null,p_next_run_at:nextRun,p_alliance_name:roster.name});
  if(done!==true&&!(Array.isArray(done)&&done[0]===true))throw new Error('Sync lease was lost before completion.');
  return {ok:true,rosterCount:roster.members.length,addedCount:added,skippedCount:skipped,failedCount:failed,nextRunAt:nextRun,manual};
 }catch(e){
  const message=String((e as Error)?.message||'Sync failed.').slice(0,500),code=String((e as any)?.code||'sync_failed').slice(0,60);
  await patchRows('alliance_sync_config',`id=eq.${enc(config.id)}&lease_token=eq.${enc(leaseToken)}`,{last_attempt_at:new Date().toISOString(),lease_token:null,lease_expires_at:null,consecutive_failures:Number(config.consecutive_failures||0)+1,last_status:config.enabled?'error':'paused',last_error_code:code,last_error_message:message,next_run_at:new Date(Date.now()+5*60000).toISOString(),updated_at:new Date().toISOString()});
  await patchRows('alliance_sync_runs',`id=eq.${enc(runId)}`,{finished_at:new Date().toISOString(),status:'error',error_code:code,error_message:message});throw e;
 }
}
export async function runAllianceSyncAsAdmin(configId:string, adminUserId:string){
 const rows=await selectRows('alliance_sync_config',`id=eq.${enc(configId)}&select=*&limit=1`);
 const config=Array.isArray(rows)?rows[0]:null;
 if(!config)throw Object.assign(new Error('Alliance sync configuration not found.'),{status:404,code:'not_found'});
 if(!config.enabled)throw Object.assign(new Error('Resume this alliance before running a manual sync.'),{status:409,code:'sync_paused'});
 const lease=randomUUID();
 const claimed=await patchRows('alliance_sync_config',`id=eq.${enc(configId)}&enabled=eq.true&or=(lease_token.is.null,lease_expires_at.lt.${enc(new Date().toISOString())})`,{lease_token:lease,lease_expires_at:new Date(Date.now()+4*60000).toISOString(),last_status:'running',updated_at:new Date().toISOString()});
 if(!Array.isArray(claimed)||!claimed.length)throw Object.assign(new Error('A sync is already running for this alliance.'),{status:409,code:'sync_in_progress'});
 return await performSync(claimed[0],adminUserId,true,lease);
}
export default async function handler(req:Req,res:Res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET'&&req.method!=='POST'){res.setHeader('Allow','GET, POST');return fail(res,405,'method_not_allowed','Method not allowed.');}
 if(!await isAuthenticatedProfileRequest(req))return fail(res,401,'authentication_required','Sign in with Discord to manage alliance sync.');
 if(!rateLimit(req,res,'alliance-sync',30,60000))return;
 try{
  const ownerId=await getProfileOwner(req);if(!ownerId)return fail(res,401,'authentication_required','Your Discord session could not be verified.');
  const action=String(req.body?.action??getParam(req,'action')??'list');
  const kingdom=String(req.body?.kingdomId??getParam(req,'kingdomId')).trim();const tag=String(req.body?.allianceTag??getParam(req,'allianceTag')).trim();
  if(['progress','history','capacity'].includes(action)&&(!validKingdom(kingdom)||!validTag(tag)))return fail(res,400,'invalid_alliance','Check the kingdom ID and alliance tag.');
  if(action==='progress'){
   const configs=await selectRows('alliance_sync_config',`owner_user_id=eq.${enc(ownerId)}&kingdom_id=eq.${enc(kingdom)}&alliance_tag=ilike.${enc(tag)}&select=id,alliance_name,alliance_tag,kingdom_id,enabled,last_status,lease_expires_at,last_roster_count&limit=1`);
   if(!Array.isArray(configs)||!configs.length)return res.status(200).json({active:false});const c=configs[0];
   const runs=await selectRows('alliance_sync_runs',`config_id=eq.${enc(c.id)}&order=created_at.desc&select=id,status,created_at,finished_at,roster_count,added_count,skipped_count,error_code&limit=1`);if(!Array.isArray(runs)||!runs.length)return res.status(200).json({active:false});const run=runs[0];
   const active=run.status==='running'&&c.enabled&&c.lease_expires_at&&new Date(c.lease_expires_at).getTime()>Date.now();if(!active)return res.status(200).json({active:false});
   const seen=await selectRows('alliance_sync_seen_players',`config_id=eq.${enc(c.id)}&last_seen_at=gte.${enc(run.created_at)}&select=player_id,registration_status,last_seen_at&order=last_seen_at.desc`);const list=Array.isArray(seen)?seen:[];
   return res.status(200).json({active:true,allianceTag:c.alliance_tag,allianceName:c.alliance_name||c.alliance_tag,kingdomId:c.kingdom_id,processedCount:list.length,totalCount:Number(run.roster_count||c.last_roster_count||0),currentPlayerId:String(list.find((x:any)=>x.registration_status==='pending')?.player_id||''),status:run.status});
  }
  if(action==='history'){
   const configs=await selectRows('alliance_sync_config',`kingdom_id=eq.${enc(kingdom)}&alliance_tag=ilike.${enc(tag)}&select=id,alliance_name,alliance_tag,kingdom_id&limit=1`);if(!Array.isArray(configs)||!configs.length)return res.status(200).json({runs:[],departedCount:0});const c=configs[0];
   const runs=await selectRows('alliance_sync_runs',`config_id=eq.${enc(c.id)}&order=created_at.desc&select=id,status,created_at,finished_at,roster_count,added_count,skipped_count,departed_count,error_code,error_message&limit=10`);const departed=await selectRows('alliance_sync_seen_players',`config_id=eq.${enc(c.id)}&registration_status=eq.departed&select=player_id`);return res.status(200).json({runs:Array.isArray(runs)?runs:[],departedCount:Array.isArray(departed)?departed.length:0});
  }
  if(action==='capacity'){
   const rows=await selectRows('alliance_sync_config',`kingdom_id=eq.${enc(kingdom)}&select=id,owner_user_id,enabled,last_status,alliance_tag`);const list=Array.isArray(rows)?rows:[];const existing=list.find((x:any)=>String(x.alliance_tag).toLowerCase()===tag.toLowerCase());return res.status(200).json({kingdomId:kingdom,registeredCount:list.length,limit:3,isRegistered:Boolean(existing),managedByCurrentUser:Boolean(existing&&String(existing.owner_user_id)===ownerId),enabled:existing?Boolean(existing.enabled):false,status:existing?.last_status||null,canRegister:!existing&&list.length<3});
  }
  if(req.method==='GET'||action==='list'){
   const rows=await selectRows('alliance_sync_config',`owner_user_id=eq.${enc(ownerId)}&select=id,kingdom_id,alliance_tag,alliance_name,enabled,interval_hours,last_attempt_at,last_success_at,next_run_at,consecutive_failures,last_status,last_error_code,last_error_message,last_roster_count,last_added_count,created_at,updated_at&order=created_at.desc`);return res.status(200).json({configs:Array.isArray(rows)?rows:[]});
  }
  if(action==='create'||action==='register-alliance'){
   const k=String(req.body?.kingdomId??'').trim(),t=String(req.body?.allianceTag??'').trim();if(!validKingdom(k)||!validTag(t))return fail(res,400,'invalid_alliance','Check the kingdom ID and alliance tag.');
   const existing=await selectRows('alliance_sync_config',`kingdom_id=eq.${enc(k)}&alliance_tag=ilike.${enc(t)}&select=id,owner_user_id,enabled&limit=1`);
   if(Array.isArray(existing)&&existing.length){const c=existing[0];if(String(c.owner_user_id)!==ownerId)return fail(res,409,'alliance_already_managed','This alliance already has an automatic sync owner. A second worker will not be created.');if(action!=='register-alliance')return fail(res,409,'alliance_already_registered','This alliance is already registered. Existing settings cannot be edited.');if(!c.enabled)return fail(res,409,'sync_paused','This alliance is paused. Resume it before syncing.');const lease=randomUUID();const claimed=await patchRows('alliance_sync_config',`id=eq.${enc(c.id)}&enabled=eq.true&or=(lease_token.is.null,lease_expires_at.lt.${enc(new Date().toISOString())})`,{lease_token:lease,lease_expires_at:new Date(Date.now()+4*60000).toISOString(),last_status:'running'});if(!Array.isArray(claimed)||!claimed.length)return fail(res,409,'sync_in_progress','A sync is already running for this alliance.');return res.status(200).json({config:c,initialSync:await performSync(claimed[0],ownerId,true,lease),alreadyRegisteredAlliance:true});}
   const roster=await readAlliance(k,t);const created=await callRpc('register_alliance_sync_config',{p_owner_user_id:ownerId,p_kingdom_id:k,p_alliance_tag:roster.tag,p_alliance_name:roster.name,p_roster_count:roster.members.length});const config=Array.isArray(created)?created[0]:created;if(!config?.id)throw new Error('Supabase did not confirm alliance registration.');
   if(action==='register-alliance'){const lease=randomUUID();const claimed=await patchRows('alliance_sync_config',`id=eq.${enc(config.id)}&enabled=eq.true&or=(lease_token.is.null,lease_expires_at.lt.${enc(new Date().toISOString())})`,{lease_token:lease,lease_expires_at:new Date(Date.now()+4*60000).toISOString(),last_status:'running'});if(!Array.isArray(claimed)||!claimed.length)return res.status(201).json({config,validatedRosterCount:roster.members.length,scheduled:true});return res.status(201).json({config,validatedRosterCount:roster.members.length,initialSync:await performSync(claimed[0],ownerId,true,lease)});}
   return res.status(201).json({config,validatedRosterCount:roster.members.length});
  }
  const id=String(req.body?.id??'');if(!/^[0-9a-f-]{36}$/i.test(id))return fail(res,400,'invalid_config_id','Choose a valid sync configuration.');
  const rows=await selectRows('alliance_sync_config',`id=eq.${enc(id)}&owner_user_id=eq.${enc(ownerId)}&select=*&limit=1`);const config=Array.isArray(rows)?rows[0]:null;if(!config)return fail(res,404,'not_found','Sync configuration not found.');
  if(action==='pause'||action==='resume'){const enabled=action==='resume';const updated=await patchRows('alliance_sync_config',`id=eq.${enc(id)}&owner_user_id=eq.${enc(ownerId)}`,{enabled,last_status:enabled?'pending':'paused',next_run_at:enabled?new Date().toISOString():config.next_run_at,updated_at:new Date().toISOString(),...(enabled?{}:{lease_token:null,lease_expires_at:null})});return res.status(200).json({config:Array.isArray(updated)?updated[0]:null});}
  if(action==='delete')return fail(res,405,'not_supported','Sync configurations are retained for auditability; pause this configuration instead.');
  if(action==='sync'){if(!config.enabled)return fail(res,409,'sync_paused','Resume this alliance sync before running a manual sync.');const lease=randomUUID();const claimed=await patchRows('alliance_sync_config',`id=eq.${enc(id)}&owner_user_id=eq.${enc(ownerId)}&enabled=eq.true&or=(lease_token.is.null,lease_expires_at.lt.${enc(new Date().toISOString())})`,{lease_token:lease,lease_expires_at:new Date(Date.now()+4*60000).toISOString(),last_status:'running',updated_at:new Date().toISOString()});if(!Array.isArray(claimed)||!claimed.length)return fail(res,409,'sync_in_progress','A sync is already running for this alliance.');return res.status(200).json(await performSync(claimed[0],ownerId,true,lease));}
  return fail(res,400,'unknown_action','Unsupported alliance sync action.');
 }catch(e){const error=e as Error&{status?:number;code?:string};const conflict=['23505','23514','alliance_already_managed','kingdom_alliance_limit'].includes(String(error.code));return fail(res,error.status===429?429:error.status===404?404:conflict?409:502,error.code||'sync_failed',String(error.message||'Alliance sync failed. Please retry.').includes('kingdom_alliance_limit')||error.code==='23514'?'This kingdom already has three registered alliances.':error.code==='alliance_already_managed'||error.code==='23505'?'This alliance already has an automatic sync owner.':'Alliance sync failed: '+String(error.message||'Please retry.').slice(0,250));}
}
