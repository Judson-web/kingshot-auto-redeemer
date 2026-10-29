import { rateLimit } from "./request-rate-limit.js";
import { isDiscordOwner } from "./discord-identity.js";
import crypto from"node:crypto";
import { fetchMightPulse } from "./mightpulse-key-pool.js";
const SUPABASE_URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const COOKIE="__Host-ks_owner_session";
const OWNER_DISCORD_ID="871756466900598815";
function hash(value){return crypto.createHash("sha256").update(String(value)).digest("hex")}
function getCookie(req){const raw=String(req.headers.cookie||"");const part=raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE+"="));if(!part)return"";try{return decodeURIComponent(part.slice(COOKIE.length+1))}catch{return""}}
async function rpc(name,body){const r=await fetch(SUPABASE_URL+"/rest/v1/rpc/"+name,{method:"POST",headers:{"apikey":SUPABASE_KEY,"authorization":"Bearer "+SUPABASE_KEY,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.message||"Admin data service unavailable.");return d}
async function sbRequest(path,init={}){if(!SUPABASE_KEY)throw Error("Supabase queue storage is not configured.");const r=await fetch(SUPABASE_URL+"/rest/v1/"+path,{...init,headers:{apikey:SUPABASE_KEY,authorization:"Bearer "+SUPABASE_KEY,"content-type":"application/json",...(init.headers||{})},signal:AbortSignal.timeout(12000)});const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.message||"Supabase queue request failed.");return d}
async function db(path,init={}){if(!SUPABASE_KEY)throw Error("Admin database is not configured.");const r=await fetch(SUPABASE_URL+"/rest/v1/"+path,{...init,headers:{apikey:SUPABASE_KEY,authorization:"Bearer "+SUPABASE_KEY,"content-type":"application/json",...(init.headers||{})},signal:AbortSignal.timeout(12000)});const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.message||"Admin database request failed.");return d}
export default async function handler(req,res){
 res.setHeader("Cache-Control","private, no-store");
 if(!["GET","POST","PATCH","DELETE"].includes(req.method))return res.status(405).json({error:"Method not allowed"});
 try{
  const publicMode=new URL(req.url||"/","http://localhost").searchParams.get("public")||"";
  if(req.method==="GET"&&publicMode==="announcements"){ const rows=await rpc("kingshot_public_announcements",{}); res.setHeader("Cache-Control","no-store"); return res.status(200).json({announcements:Array.isArray(rows)?rows:[]}); }
  if(req.method==="GET"&&publicMode==="maintenance"){ const row=await rpc("kingshot_public_maintenance",{}); const state=Array.isArray(row)?row[0]:row; res.setHeader("Cache-Control","no-store"); return res.status(200).json({maintenanceEnabled:Boolean(state?.maintenance_enabled),message:String(state?.maintenance_message||"We are performing maintenance right now. Please check back shortly."),endsAt:state?.ends_at||null,updatedAt:state?.updated_at||null}); }
  if(!rateLimit(req,res,"admin-data",60,60000))return res.status(429).json({error:"Too many administrator requests. Retry shortly."});
  const session=getCookie(req);if(!session)return res.status(401).json({error:"Discord administrator sign-in required."});
  const ownerUserId=await rpc("kingshot_developer_account_session_get",{p_token_hash:hash(session)});
  if(typeof ownerUserId!=="string"||!ownerUserId)return res.status(401).json({error:"Discord administrator session expired. Sign in again."});
  if(!SUPABASE_KEY)return res.status(503).json({error:"Admin authorization is not configured."});
  const ownerResponse=await fetch(SUPABASE_URL+"/auth/v1/admin/users/"+encodeURIComponent(ownerUserId),{headers:{apikey:SUPABASE_KEY,authorization:"Bearer "+SUPABASE_KEY},signal:AbortSignal.timeout(8000)});
  const owner=await ownerResponse.json().catch(()=>null);
  if(!ownerResponse.ok||!isDiscordOwner(owner,OWNER_DISCORD_ID))return res.status(403).json({error:"This Discord account is not authorized to administer the service."});
  const tokenHash=hash(session);
  const valid=await rpc("kingshot_admin_create_discord_session",{p_token_hash:tokenHash,p_user_id:ownerUserId});if(!valid)return res.status(403).json({error:"Could not establish administrator authorization."});
  const audit=async(action,targetType,targetId,details)=>rpc("kingshot_admin_audit",{p_token_hash:tokenHash,p_action:action,p_target_type:targetType||null,p_target_id:targetId||null,p_details:details||{}}).catch(()=>false);
  if(req.method==="GET"&&new URL(req.url||"/","http://localhost").searchParams.get("discordUsers")==="1"){
   const identities=[];
   // Read the Auth Admin API server-side only; never return email addresses or raw metadata.
   for(let page=1;page<=10;page++){
    const usersResponse=await fetch(SUPABASE_URL+"/auth/v1/admin/users?page="+page+"&per_page=100",{
     headers:{apikey:SUPABASE_KEY,authorization:"Bearer "+SUPABASE_KEY,accept:"application/json"},
     signal:AbortSignal.timeout(10000)
    });
    const payload=await usersResponse.json().catch(()=>null);
    if(!usersResponse.ok||!Array.isArray(payload?.users)){
     console.error("Discord identity export failed",usersResponse.status);
     return res.status(502).json({error:"Discord identity export is temporarily unavailable."});
    }
    for(const user of payload.users){
     const discordIdentity=(Array.isArray(user?.identities)?user.identities:[]).find(identity=>identity?.provider==="discord");
     const providers=Array.isArray(user?.app_metadata?.providers)?user.app_metadata.providers:[];
     if(!discordIdentity&&!providers.includes("discord"))continue;
     const identityData=discordIdentity?.identity_data||{};
     const metadata=user?.user_metadata||{};
     const discordId=String(discordIdentity?.provider_id||identityData?.sub||identityData?.id||metadata?.sub||"");
     identities.push({
      supabase_user_id:String(user?.id||""),
      discord_id:discordId||null,
      display_name:identityData?.global_name||metadata?.global_name||metadata?.full_name||metadata?.name||identityData?.username||metadata?.user_name||null,
      username:identityData?.username||metadata?.user_name||metadata?.preferred_username||null,
      created_at:discordIdentity?.created_at||user?.created_at||null,
      last_sign_in_at:discordIdentity?.last_sign_in_at||user?.last_sign_in_at||null
     });
    }
    if(payload.users.length<100)break;
   }
   identities.sort((a,b)=>String(a.created_at||"").localeCompare(String(b.created_at||"")));
   await audit("VIEW_DISCORD_IDENTITIES","auth_users",null,{count:identities.length});
   res.setHeader("Cache-Control","private, no-store");
   res.setHeader("Pragma","no-cache");
   res.setHeader("X-Content-Type-Options","nosniff");
   return res.status(200).json({identities,count:identities.length,generatedAt:new Date().toISOString()});
  }
  if(req.method==="GET"&&new URL(req.url||"/","http://localhost").searchParams.get("maintenanceOnly")==="1"){
   const rows=await rpc("kingshot_admin_get_maintenance",{p_token_hash:tokenHash});
   const maintenance=Array.isArray(rows)?rows[0]||null:rows||null;
   await audit("VIEW_MAINTENANCE_SETTINGS","maintenance",null,{enabled:Boolean(maintenance?.maintenance_enabled)});
   return res.status(200).json({maintenance});
  }
  // Private visitor-level telemetry export. This endpoint is reachable only after
  // validating the existing admin session and never publishes data to the README.
  if(req.method==="GET"&&new URL(req.url||"/","http://localhost").searchParams.get("analytics")==="visitors"){
   const url=new URL(SUPABASE_URL+"/rest/v1/kingshot_visitor_events");
   const params=new URLSearchParams({
    select:"id,occurred_at,ip_address,country_code,region,city,timezone,path,referrer_host,browser,operating_system,device_type,language,screen_class,user_agent",
    order:"occurred_at.desc",
    limit:String(Math.min(100,Math.max(1,Number(new URL(req.url||"/","http://localhost").searchParams.get("limit"))||50)))
   });
   const cursor=new URL(req.url||"/","http://localhost").searchParams.get("before");
   if(cursor&&cursor.length<=18&&cursor.length>0&&[...cursor].every(ch=>ch>="0"&&ch<="9"))params.set("id","lt."+cursor);
   params.set("expires_at","gt."+new Date().toISOString());
   url.search=params.toString();
   const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
   if(!key)return res.status(503).json({error:"Visitor telemetry storage is not configured."});
   const response=await fetch(url,{headers:{apikey:key,authorization:"Bearer "+key,accept:"application/json"},signal:AbortSignal.timeout(8000)});
   if(!response.ok){console.error("Private visitor telemetry query failed",response.status);return res.status(502).json({error:"Visitor telemetry is temporarily unavailable."});}
   const events=await response.json();
   res.setHeader("Cache-Control","private, no-store");
   res.setHeader("Pragma","no-cache");
   await audit("VIEW_VISITOR_TELEMETRY","visitor_analytics",null,{returned:events.length});
   return res.status(200).json({events:Array.isArray(events)?events:[],count:Array.isArray(events)?events.length:0,limit:Number(params.get("limit")),nextBefore:Array.isArray(events)&&events.length?events[events.length-1].id:null,retentionDays:30,privacy:"Private administrator endpoint. Do not publish event-level records."});
  }
  const requestUrl=new URL(req.url||"/","http://localhost");
  if(req.method==="GET"&&requestUrl.searchParams.get("allianceRegistrationJob")){
   const jobId=String(requestUrl.searchParams.get("allianceRegistrationJob")||"");
   if(!/^[0-9a-f-]{36}$/i.test(jobId))return res.status(400).json({error:"Invalid registration job."});
   const rows=await sbRequest("alliance_manual_registration_jobs?id=eq."+encodeURIComponent(jobId)+"&owner_user_id=eq."+encodeURIComponent(ownerUserId)+"&select=*&limit=1");
   if(!Array.isArray(rows)||!rows.length)return res.status(404).json({error:"Registration job not found."});
   return res.status(200).json({job:rows[0]});
  }
  if(req.method==="GET"&&requestUrl.searchParams.get("allianceSync")==="1"){
   const configs=await db("alliance_sync_config?select=id,kingdom_id,alliance_tag,alliance_name,enabled,last_status,last_roster_count,last_added_count,last_attempt_at,last_success_at,next_run_at,last_error_message,created_at&order=kingdom_id.asc,alliance_tag.asc");
   const rows=Array.isArray(configs)?await Promise.all(configs.map(async c=>{const seen=await db("alliance_sync_seen_players?config_id=eq."+encodeURIComponent(c.id)+"&select=player_id,registration_status");const list=Array.isArray(seen)?seen:[];return {...c,registered_count:list.filter(p=>p.registration_status==='registered').length,error_count:list.filter(p=>p.registration_status==='error').length};})):[];
   await audit("VIEW_ALLIANCE_SYNC_CONFIGS","alliance_sync",null,{count:rows.length});return res.status(200).json({configs:rows});
  }

  if(req.method==="GET"&&requestUrl.searchParams.get("playerHistory")){
   const playerId=String(requestUrl.searchParams.get("playerHistory")||"");
   if(!/^[0-9]{5,20}$/.test(playerId))return res.status(400).json({error:"Invalid Player ID."});
   const history=await db("kingshot_redemptions?select=player_id,gift_code,status,err_code,message,attempted_at&player_id=eq."+encodeURIComponent(playerId)+"&order=attempted_at.desc&limit=200");
   await audit("VIEW_PLAYER_REDEMPTION_HISTORY","player",playerId,{count:Array.isArray(history)?history.length:0});
   return res.status(200).json({playerId,redemptions:Array.isArray(history)?history:[]});
  }
  if(req.method==="POST"){
   const body=req.body||{};
   const action=String(body.action||"").toUpperCase();
   if(action==="ADMIN_RUN_ALLIANCE_SYNC"){
    const id=String(body.id||"");
    if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({error:"Choose a valid alliance configuration."});
    const configs=await db("alliance_sync_config?id=eq."+encodeURIComponent(id)+"&select=id,kingdom_id,alliance_tag,enabled&limit=1");
    if(!Array.isArray(configs)||!configs.length)return res.status(404).json({error:"Alliance configuration not found."});
    const config=configs[0];
    const { runAllianceSyncAsAdmin } = await import("../internal/kingshot/alliance-sync-handler.ts");
    const result=await runAllianceSyncAsAdmin(id,ownerUserId);
    await audit("MANUAL_ALLIANCE_SYNC","alliance_sync",id,{kingdomId:config.kingdom_id,allianceTag:config.alliance_tag,rosterCount:result.rosterCount,addedCount:result.addedCount,skippedCount:result.skippedCount,failedCount:result.failedCount});
    return res.status(200).json({ok:true,config,result});
   }

   if(action==="REGISTER_ALLIANCE_SYNC"){
    const kingdom=String(body.kingdomId||"").trim(),tag=String(body.allianceTag||"").trim();
    if(!/^\d{1,10}$/.test(kingdom)||!/^[A-Za-z0-9_-]{1,20}$/.test(tag))return res.status(400).json({error:"Enter a valid kingdom ID and alliance tag."});
    const rosterResponse=await fetchMightPulse("https://api.mightpulse.com/v1/alliances/"+encodeURIComponent(kingdom)+"/"+encodeURIComponent(tag)+"?include=info,roster",{headers:{Accept:"application/json"}},{timeoutMs:20000});
    const rosterData=await rosterResponse.json().catch(()=>null);const payload=rosterData?.data&&typeof rosterData.data==="object"?rosterData.data:rosterData;const alliance=payload?.alliance||payload;
    const members=Array.isArray(payload?.members)?payload.members:Array.isArray(payload?.roster)?payload.roster:Array.isArray(alliance?.members)?alliance.members:null;
    if(!rosterResponse.ok||!payload||payload.fresh===false||payload.stale===true||!members||!members.length)return res.status(502).json({error:"A fresh, complete alliance roster could not be validated. No registration was created."});
    const canonicalTag=String(alliance?.abbr??alliance?.tag??tag).trim();if(canonicalTag.toLowerCase()!==tag.toLowerCase())return res.status(409).json({error:"The provider returned a different alliance tag. No registration was created."});
const validIds=new Set(members.map(m=>({id:String(m?.governor_id??m?.fid??m?.player_id??m?.playerId??m?.id??"" ).trim(),kid:String(m?.kid??m?.kingdom_id??kingdom)})).filter(m=>/^[0-9]{5,20}$/.test(m.id)&&m.kid===kingdom).map(m=>m.id));if(!validIds.size)return res.status(502).json({error:"The validated roster contained no valid player IDs. No registration was created."});
    let row;
    try{const created=await rpc("register_alliance_sync_config",{p_owner_user_id:ownerUserId,p_kingdom_id:kingdom,p_alliance_tag:canonicalTag,p_alliance_name:String(alliance?.name??alliance?.alliance_name??canonicalTag).slice(0,80),p_roster_count:validIds.size});row=Array.isArray(created)?created[0]:created;}
    catch(e){const message=String(e?.message||"");if(message.includes("alliance_already_managed")||message.includes("kingdom_alliance_limit")||message.includes("23505")||message.includes("23514"))return res.status(409).json({error:message.includes("kingdom_alliance_limit")||message.includes("23514")?"This kingdom already has three registered alliances.":"That alliance is already registered. No duplicate scheduler was created."});throw e;}
    if(!row||!row.id)return res.status(409).json({error:"Alliance registration could not be created."});
    await audit("REGISTER_ALLIANCE_SYNC","alliance_sync",row.id,{kingdomId:kingdom,allianceTag:tag});return res.status(201).json({ok:true,config:row,message:"Alliance queued for validated roster sync."});
   }
   if(action==="ADMIN_ALLIANCE_ROSTER"){
    const id=String(body.id||"");if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({error:"Choose a valid alliance registration."});
    const rows=await db("alliance_sync_config?id=eq."+encodeURIComponent(id)+"&select=id,kingdom_id,alliance_tag,alliance_name&limit=1");
    if(!Array.isArray(rows)||!rows.length)return res.status(404).json({error:"Alliance registration not found."});
    const c=rows[0];const rr=await fetchMightPulse("https://api.mightpulse.com/v1/alliances/"+encodeURIComponent(c.kingdom_id)+"/"+encodeURIComponent(c.alliance_tag)+"?include=info,roster",{headers:{Accept:"application/json"}},{timeoutMs:20000});
    const rd=await rr.json().catch(()=>null);const payload=rd?.data&&typeof rd.data==="object"?rd.data:rd;const alliance=payload?.alliance||payload;
    const raw=Array.isArray(payload?.members)?payload.members:Array.isArray(payload?.roster)?payload.roster:Array.isArray(alliance?.members)?alliance.members:null;
    if(!rr.ok||!payload||payload.fresh===false||payload.stale===true||!raw?.length)return res.status(502).json({error:"A fresh, complete roster could not be validated."});
    const tag=String(alliance?.abbr??alliance?.tag??c.alliance_tag).trim();if(tag.toLowerCase()!==String(c.alliance_tag).toLowerCase())return res.status(409).json({error:"Provider returned a different alliance tag."});
    const seen=new Set();const members=raw.flatMap(m=>{const playerId=String(m?.governor_id??m?.fid??m?.player_id??m?.playerId??m?.id??"").trim();const kingdom=String(m?.kid??m?.kingdom_id??c.kingdom_id);if(!/^[0-9]{5,20}$/.test(playerId)||kingdom!==String(c.kingdom_id)||seen.has(playerId))return [];seen.add(playerId);return [{playerId,name:String(m?.nick_name??m?.name??m?.nickname??"").slice(0,80),avatarUrl:String(m?.avatar_url??m?.avatarUrl??"")}];});
    if(!members.length)return res.status(502).json({error:"Roster contained no valid player IDs; no player records were changed."});
    const registered=await rpc("kingshot_admin_list_players",{p_token_hash:tokenHash});const registeredIds=new Set((Array.isArray(registered)?registered:[]).map(p=>String(p.player_id||"")));
    await audit("VIEW_ALLIANCE_SYNC_ROSTER","alliance_sync",id,{rosterCount:members.length});
    return res.status(200).json({config:{id:c.id,kingdom_id:String(c.kingdom_id),alliance_tag:c.alliance_tag,alliance_name:c.alliance_name},members:members.map(m=>({...m,alreadyRegistered:registeredIds.has(m.playerId)}))});
   }
   if(action==="ADMIN_REGISTER_ALLIANCE_MEMBER"){
    const id=String(body.id||""),playerId=String(body.playerId||"").trim();if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9]{5,20}$/.test(playerId))return res.status(400).json({error:"Choose a valid alliance and Player ID."});
    const configs=await db("alliance_sync_config?id=eq."+encodeURIComponent(id)+"&select=id,kingdom_id,alliance_tag&limit=1");if(!Array.isArray(configs)||!configs.length)return res.status(404).json({error:"Alliance registration not found."});const c=configs[0];
    const rr=await fetchMightPulse("https://api.mightpulse.com/v1/alliances/"+encodeURIComponent(c.kingdom_id)+"/"+encodeURIComponent(c.alliance_tag)+"?include=info,roster",{headers:{Accept:"application/json"}},{timeoutMs:20000});const rd=await rr.json().catch(()=>null);const payload=rd?.data&&typeof rd.data==="object"?rd.data:rd;const alliance=payload?.alliance||payload;const raw=Array.isArray(payload?.members)?payload.members:Array.isArray(payload?.roster)?payload.roster:Array.isArray(alliance?.members)?alliance.members:null;
    if(!rr.ok||!payload||payload.fresh===false||payload.stale===true||!raw?.length)return res.status(502).json({error:"A fresh, complete roster could not be validated. No player was registered."});const canonicalTag=String(alliance?.abbr??alliance?.tag??c.alliance_tag).trim();if(canonicalTag.toLowerCase()!==String(c.alliance_tag).toLowerCase())return res.status(409).json({error:"Provider returned a different alliance tag."});
    const member=raw.find(m=>String(m?.governor_id??m?.fid??m?.player_id??m?.playerId??m?.id??"").trim()===playerId&&String(m?.kid??m?.kingdom_id??c.kingdom_id)===String(c.kingdom_id));if(!member)return res.status(409).json({error:"Player is no longer in the validated alliance roster."});const {normalizeRegistrationInput,registerPlayer}=await import("../internal/kingshot/register.js");let result;try{result=await registerPlayer(normalizeRegistrationInput({playerId,kingdomId:String(c.kingdom_id),playerName:String(member?.nick_name??member?.name??member?.nickname??"").slice(0,80),avatarUrl:String(member?.avatar_url??member?.avatarUrl??"")}));}catch(e){await audit("ADMIN_REGISTER_ALLIANCE_MEMBER","alliance_sync",id,{playerId,ok:false});return res.status(200).json({result:{playerId,ok:false,error:String(e?.message||"Registration failed.").slice(0,180)}});}await audit("ADMIN_REGISTER_ALLIANCE_MEMBER","alliance_sync",id,{playerId,ok:true,alreadyRegistered:Boolean(result?.alreadyRegistered)});return res.status(200).json({result:{playerId,ok:true,alreadyRegistered:Boolean(result?.alreadyRegistered)}});
   }
   if(action==="ADMIN_REGISTER_ALLIANCE_MEMBERS"){
    const id=String(body.id||"");const requested=Array.isArray(body.playerIds)?[...new Set(body.playerIds.map(v=>String(v).trim()))]:[];
    if(!/^[0-9a-f-]{36}$/i.test(id)||!requested.length||requested.length>200)return res.status(400).json({error:"Select between 1 and 200 valid roster members."});
    if(requested.some(v=>!/^[0-9]{5,20}$/.test(v)))return res.status(400).json({error:"One or more Player IDs are invalid."});
    const configs=await db("alliance_sync_config?id=eq."+encodeURIComponent(id)+"&select=id,kingdom_id,alliance_tag&limit=1");
    if(!Array.isArray(configs)||!configs.length)return res.status(404).json({error:"Alliance registration not found."});const config=configs[0];
    const rosterResponse=await fetchMightPulse("https://api.mightpulse.com/v1/alliances/"+encodeURIComponent(config.kingdom_id)+"/"+encodeURIComponent(config.alliance_tag)+"?include=info,roster",{headers:{Accept:"application/json"}},{timeoutMs:20000});
    const rosterData=await rosterResponse.json().catch(()=>null);const payload=rosterData?.data&&typeof rosterData.data==="object"?rosterData.data:rosterData;const alliance=payload?.alliance||payload;
    const members=Array.isArray(payload?.members)?payload.members:Array.isArray(payload?.roster)?payload.roster:Array.isArray(alliance?.members)?alliance.members:null;
    if(!rosterResponse.ok||!payload||payload.fresh===false||payload.stale===true||!members||!members.length)return res.status(502).json({error:"A fresh, complete alliance roster could not be validated. No registration was created."});
    const canonicalTag=String(alliance?.abbr??alliance?.tag??config.alliance_tag).trim();if(canonicalTag.toLowerCase()!==String(config.alliance_tag).toLowerCase())return res.status(409).json({error:"The provider returned a different alliance tag. No registration was created."});
    const allowed=new Set(members.map(m=>({id:String(m?.governor_id??m?.fid??m?.player_id??m?.playerId??m?.id??"").trim(),kid:String(m?.kid??m?.kingdom_id??config.kingdom_id)})).filter(m=>/^[0-9]{5,20}$/.test(m.id)&&m.kid===String(config.kingdom_id)).map(m=>m.id));
    if(requested.some(pid=>!allowed.has(pid)))return res.status(409).json({error:"The selected roster changed. Refresh the roster and select current members again."});
    const active=await sbRequest("alliance_manual_registration_jobs?config_id=eq."+encodeURIComponent(id)+"&status=in.(queued,running)&select=id,status&limit=1");
    if(Array.isArray(active)&&active.length)return res.status(409).json({error:"A registration job is already in progress for this alliance.",jobId:active[0].id});
    let created;
    try{created=await sbRequest("alliance_manual_registration_jobs",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({config_id:id,owner_user_id:ownerUserId,kingdom_id:String(config.kingdom_id),alliance_tag:String(config.alliance_tag),status:"queued",selected_player_ids:requested,total_count:requested.length})});}
    catch(error){
     const current=await sbRequest("alliance_manual_registration_jobs?config_id=eq."+encodeURIComponent(id)+"&status=in.(queued,running)&select=id,status&limit=1").catch(()=>[]);
     if(Array.isArray(current)&&current.length)return res.status(409).json({error:"A registration job is already in progress for this alliance.",jobId:current[0].id});
     throw error;
    }
    const job=Array.isArray(created)?created[0]:null;if(!job)return res.status(502).json({error:"Supabase did not confirm creation of the registration job."});
    await audit("QUEUE_ALLIANCE_MEMBER_REGISTRATION","alliance_sync",id,{jobId:job.id,requested:requested.length,storage:"supabase"});
    return res.status(202).json({ok:true,job});
   }
   if(action==="PROCESS_ALLIANCE_REGISTRATION_JOB"){
    const jobId=String(body.jobId||"");if(!/^[0-9a-f-]{36}$/i.test(jobId))return res.status(400).json({error:"Invalid registration job."});
    const rows=await sbRequest("alliance_manual_registration_jobs?id=eq."+encodeURIComponent(jobId)+"&owner_user_id=eq."+encodeURIComponent(ownerUserId)+"&select=*&limit=1");
    if(!Array.isArray(rows)||!rows.length)return res.status(404).json({error:"Registration job not found."});
    return res.status(200).json({job:rows[0],backgroundProcessing:true});
   }
   if(action==="GET_ALLIANCE_REGISTRATION_JOB"){
    const id=String(body.id||"");if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({error:"Choose a valid alliance registration."});
    const jobs=await sbRequest("alliance_manual_registration_jobs?config_id=eq."+encodeURIComponent(id)+"&owner_user_id=eq."+encodeURIComponent(ownerUserId)+"&select=*&order=created_at.desc&limit=1");
    return res.status(200).json({job:Array.isArray(jobs)?jobs[0]||null:null});
   }
   if(action==="UNREGISTER_ALLIANCE_SYNC"){
    const id=String(body.id||"");if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({error:"Choose a valid alliance registration."});
    const found=await db("alliance_sync_config?id=eq."+encodeURIComponent(id)+"&select=id,kingdom_id,alliance_tag&limit=1");if(!Array.isArray(found)||!found.length)return res.status(404).json({error:"Alliance registration not found."});
    // Preserve sync history and seen-player audit rows. Disable the configuration instead of deleting it.
    await db("alliance_sync_config?id=eq."+encodeURIComponent(id),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({enabled:false,lease_token:null,lease_expires_at:null,last_status:"unregistered",updated_at:new Date().toISOString()})});
    await audit("UNREGISTER_ALLIANCE_SYNC","alliance_sync",id,{kingdomId:found[0].kingdom_id,allianceTag:found[0].alliance_tag});return res.status(200).json({ok:true});
   }
   if(action==="SET_MAINTENANCE"){
    const enabled=body.enabled===true;
    const message=String(body.message||"").trim().slice(0,500);
    const rawEndsAt=body.endsAt?String(body.endsAt):null;
    let endsAt=null;
    if(enabled&&rawEndsAt){const parsed=new Date(rawEndsAt);if(!Number.isFinite(parsed.getTime())||parsed.getTime()<=Date.now())return res.status(400).json({error:"Choose a future maintenance end time, or leave it empty for indefinite maintenance."});endsAt=parsed.toISOString();}
    const rows=await rpc("kingshot_admin_set_maintenance",{p_token_hash:tokenHash,p_enabled:enabled,p_message:message,p_ends_at:endsAt});
    const maintenance=Array.isArray(rows)?rows[0]||null:rows||null;
    if(!maintenance||typeof maintenance.maintenance_enabled!=="boolean")throw Error("The maintenance update could not be confirmed.");
    await audit("SET_MAINTENANCE","maintenance",null,{enabled,endsAt});
    return res.status(200).json({ok:true,maintenance});
   }
   if(action==="REFRESH_PLAYER"){
    const playerId=String(body.playerId||"").trim();
    if(!/^[0-9]{5,20}$/.test(playerId))return res.status(400).json({error:"Invalid Player ID."});
    const {lookupPlayerWithMetadata}=await import("../internal/kingshot/player.js");
    const snapshot=await lookupPlayerWithMetadata(playerId);
    await audit("REFRESH_PLAYER","player",playerId,{provider:"mightpulse",fresh:snapshot.fresh,cachedAt:snapshot.cached_at,ageSeconds:snapshot.age_seconds});
    return res.status(200).json({ok:true,...snapshot,provider:"mightpulse",freshnessNote:"MightPulse refreshes stale sections automatically; its public API does not document a force-refresh query parameter."});
   }
   if(action==="SET_PLAYER_ENABLED"){
    const playerId=String(body.playerId||"").trim(),enabled=Boolean(body.enabled);
    if(!/^[0-9]{5,20}$/.test(playerId))return res.status(400).json({error:"Invalid Player ID."});
    if(enabled){
     const restriction=await db("kingshot_player_bans?select=player_id&player_id=eq."+encodeURIComponent(playerId)+"&limit=1");
     if(Array.isArray(restriction)&&restriction.length)return res.status(409).json({error:"This Player ID is restricted. Use Restore to explicitly clear the restriction before enabling auto-redemption."});
    }
    const result=await rpc("kingshot_admin_set_player_enabled",{p_token_hash:tokenHash,p_player_id:playerId,p_enabled:enabled});
    if(!result)return res.status(502).json({error:"Could not confirm the player state change."});
    await audit(enabled?"ENABLE_PLAYER":"DISABLE_PLAYER","player",playerId,{enabled});
    return res.status(200).json({ok:true,playerId,enabled});
   }
   if(action==="BAN_PLAYER"){
    const playerId=String(body.playerId||"").trim(),reason=String(body.reason||"Blocked by administrator").trim().slice(0,300)||"Blocked by administrator";
    if(!/^[0-9]{5,20}$/.test(playerId))return res.status(400).json({error:"Invalid Player ID."});
    const rows=await db("kingshot_player_bans?on_conflict=player_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify({player_id:playerId,reason,updated_at:new Date().toISOString()})});
    const disabled=await rpc("kingshot_admin_set_player_enabled",{p_token_hash:tokenHash,p_player_id:playerId,p_enabled:false});
    if(!disabled)throw Error("Player restriction was recorded, but disabling auto-redemption could not be confirmed. The worker will continue to fail closed on the restriction record; retry the disable action.");
    await audit("DISABLE_PLAYER","player",playerId,{reason,autoRedeemDisabled:true,restrictionRecord:true});
    return res.status(200).json({ok:true,ban:Array.isArray(rows)?rows[0]||null:rows});
   }
   if(action==="UNBAN_PLAYER"){
    const playerId=String(body.playerId||"").trim();
    if(!/^[0-9]{5,20}$/.test(playerId))return res.status(400).json({error:"Invalid Player ID."});
    const enabled=await rpc("kingshot_admin_set_player_enabled",{p_token_hash:tokenHash,p_player_id:playerId,p_enabled:true});
    if(!enabled)return res.status(502).json({error:"Could not enable auto-redemption. The restriction remains in place."});
    try{await db("kingshot_player_bans?player_id=eq."+encodeURIComponent(playerId),{method:"DELETE"});}
    catch(error){
     await rpc("kingshot_admin_set_player_enabled",{p_token_hash:tokenHash,p_player_id:playerId,p_enabled:false}).catch(()=>false);
     throw error;
    }
    await audit("RESTORE_PLAYER","player",playerId,{enabled:true,restrictionRemoved:true});
    return res.status(200).json({ok:true,playerId,enabled:true,restricted:false});
   }
   if(action==="ADMIN_PUSH_STATUS"||action==="ADMIN_PUSH_SUBSCRIBE"||action==="ADMIN_PUSH_UNSUBSCRIBE"){
     const {pushIsConfigured,getPushPublicKey,savePushSubscription,removePushSubscription}=await import("../internal/push-notifications.js");
     if(!pushIsConfigured())return res.status(503).json({error:"Web push is not configured."});
     if(action==="ADMIN_PUSH_STATUS"){
      const endpoint=String(body.subscription?.endpoint||"");if(!endpoint)return res.status(200).json({enabled:false});
      let endpointUrl;try{endpointUrl=new URL(endpoint)}catch{return res.status(400).json({error:"Invalid push endpoint."})}
      if(endpointUrl.protocol!=="https:"||endpointUrl.username||endpointUrl.password||endpoint.length>2048)return res.status(400).json({error:"Invalid push endpoint."});
      const rows=await db("kingshot_push_subscriptions?select=id&endpoint=eq."+encodeURIComponent(endpoint)+"&audience=eq.admin&limit=1");
      return res.status(200).json({enabled:Array.isArray(rows)&&rows.length>0});
     }
     if(action==="ADMIN_PUSH_SUBSCRIBE")await savePushSubscription(body.subscription,"admin");else await removePushSubscription(body.subscription,"admin");
     await audit(action,"push_subscription",null,{audience:"admin"});
     return res.status(200).json({ok:true,enabled:action==="ADMIN_PUSH_SUBSCRIBE",publicKey:getPushPublicKey()});
    }
    if(action==="TEST_WEBHOOK"){
     const started=Date.now();
     const webhook=process.env.DISCORD_KINGSHOT_WEBHOOK_URL||process.env.DISCORD_SCRAPER_WEBHOOK_URL;
     if(!webhook)return res.status(503).json({error:"Discord webhook is not configured."});
     const response=await fetch(webhook,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"Kingshot Auto Redeem",allowed_mentions:{parse:[]},embeds:[{title:"Webhook Test",description:"Administrator webhook test successful.",color:0x5865F2,timestamp:new Date().toISOString()}]}),signal:AbortSignal.timeout(8000)});
     if(!response.ok)return res.status(502).json({error:"Discord webhook returned HTTP "+response.status+"."});
     await audit("TEST_WEBHOOK","webhook",null,{latencyMs:Date.now()-started});
     return res.status(200).json({ok:true,latencyMs:Date.now()-started});
    }
   const code=String(body.code||"").trim(),sourceDate=body.sourceDate?String(body.sourceDate).trim():null;
   if(!(code==="Kingshot888"||/^[A-Z0-9]{6,32}$/.test(code)))return res.status(400).json({error:"Invalid gift code. Use 6-32 letters/numbers, with an uppercase letter and either a digit or all-uppercase text."});
   if(sourceDate&&!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate))return res.status(400).json({error:"Invalid source date."});
   const existing=await rpc("kingshot_admin_add_gift_code",{p_token_hash:tokenHash,p_code:code,p_source_date:sourceDate});
   const giftCodes=await rpc("kingshot_admin_list_gift_codes",{p_token_hash:tokenHash});
   const row=Array.isArray(existing)?existing[0]:existing;
   const list=Array.isArray(giftCodes)?giftCodes:[];
   await audit("ADD_GIFT_CODE","gift_code",row?.id||null,{code:row?.code||code,sourceDate});
   return res.status(200).json({ok:true,code:row?.code||code,existing:Boolean(row?.first_seen_at&&row?.last_seen_at&&row.first_seen_at!==row.last_seen_at),giftCodes:list});
  }
  if(req.method==="DELETE"){
   const body=req.body||{};
   if(String(body.announcementAction||"")==="delete"){ const id=String(body.id||""); if(!/^[0-9a-f-]{36}$/.test(id))return res.status(400).json({error:"Invalid announcement."}); const ok=await rpc("kingshot_admin_delete_announcement",{p_token_hash:tokenHash,p_id:id}); const announcements=await rpc("kingshot_admin_list_announcements",{p_token_hash:tokenHash}); await audit("DELETE_ANNOUNCEMENT","announcement",id,{}); return res.status(200).json({ok:Boolean(ok),announcements:Array.isArray(announcements)?announcements:[]}); }
   const playerId=String(body.playerId||"").trim();if(!/^[0-9]{5,20}$/.test(playerId))return res.status(400).json({error:"Invalid Player ID."});const ok=await rpc("kingshot_admin_set_player_enabled",{p_token_hash:tokenHash,p_player_id:playerId,p_enabled:false});await audit("REVOKE_PLAYER","player",playerId,{});return res.status(200).json({ok:Boolean(ok)});}
  if(req.method==="GET"){
   const [players,announcements,tickets,giftCodes,auditLog,scraperComparison,maintenance,bans]=await Promise.all([rpc("kingshot_admin_list_players",{p_token_hash:tokenHash}),rpc("kingshot_admin_list_announcements",{p_token_hash:tokenHash}),rpc("kingshot_admin_list_tickets",{p_token_hash:tokenHash}),rpc("kingshot_admin_list_gift_codes",{p_token_hash:tokenHash}),rpc("kingshot_admin_list_audit",{p_token_hash:tokenHash,p_limit:100}),rpc("kingshot_admin_scraper_comparison",{p_token_hash:tokenHash}),rpc("kingshot_admin_get_maintenance",{p_token_hash:tokenHash}),db("kingshot_player_bans?select=player_id,reason,created_at,updated_at&order=created_at.desc&limit=5000")]);
   return res.status(200).json({players:Array.isArray(players)?players:[],bans:Array.isArray(bans)?bans:[],announcements:Array.isArray(announcements)?announcements:[],tickets:Array.isArray(tickets)?tickets:[],giftCodes:Array.isArray(giftCodes)?giftCodes:[],auditLog:Array.isArray(auditLog)?auditLog:[],scraperComparison:Array.isArray(scraperComparison)?scraperComparison:[],maintenance:Array.isArray(maintenance)?maintenance[0]||null:maintenance||null});
  }
  const body=req.body||{},action=String(body.action||"").toUpperCase(),ticketId=String(body.ticketId||"");
  if(!/^[0-9a-f-]{36}$/.test(ticketId))return res.status(400).json({error:"Invalid ticket."});
  if(!["REVOKE","CANCEL"].includes(action))return res.status(400).json({error:"Invalid action."});
  const ticket=await rpc("kingshot_admin_update_ticket",{p_token_hash:tokenHash,p_ticket_id:ticketId,p_action:action});
  await audit(action==="REVOKE"?"REVOKE_TICKET":"CANCEL_TICKET","support_ticket",ticketId,{});
  return res.status(200).json({ok:true,ticket:Array.isArray(ticket)?ticket[0]:ticket});
 }catch(e){return res.status(502).json({error:e.message||"Could not process admin request."})}
}
