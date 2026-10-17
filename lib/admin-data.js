import crypto from"node:crypto";
import { lookupPlayer } from "../internal/kingshot/player.js";
import { savePushSubscription, removePushSubscription } from "../internal/push-notifications.js";
const SUPABASE_URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const COOKIE="__Host-ks_owner_session";
const OWNER_DISCORD_ID="871756466900598815";
function hash(value){return crypto.createHash("sha256").update(String(value)).digest("hex")}
function getCookie(req){const raw=String(req.headers.cookie||"");const part=raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE+"="));if(!part)return"";try{return decodeURIComponent(part.slice(COOKIE.length+1))}catch{return""}}
async function rpc(name,body){const r=await fetch(SUPABASE_URL+"/rest/v1/rpc/"+name,{method:"POST",headers:{"apikey":SUPABASE_KEY,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.message||"Admin data service unavailable.");return d}
async function db(path,init={}){if(!SUPABASE_KEY)throw Error("Admin database is not configured.");const r=await fetch(SUPABASE_URL+"/rest/v1/"+path,{...init,headers:{apikey:SUPABASE_KEY,authorization:"Bearer "+SUPABASE_KEY,"content-type":"application/json",...(init.headers||{})},signal:AbortSignal.timeout(12000)});const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.message||"Admin database request failed.");return d}
export default async function handler(req,res){
 res.setHeader("Cache-Control","private, no-store");
 if(!["GET","POST","PATCH","DELETE"].includes(req.method))return res.status(405).json({error:"Method not allowed"});
 try{
  const publicMode=new URL(req.url||"/","http://localhost").searchParams.get("public")||"";
  if(req.method==="GET"&&publicMode==="announcements"){ const rows=await rpc("kingshot_public_announcements",{}); res.setHeader("Cache-Control","no-store"); return res.status(200).json({announcements:Array.isArray(rows)?rows:[]}); }
  if(req.method==="GET"&&publicMode==="maintenance"){ const row=await rpc("kingshot_public_maintenance",{}); const state=Array.isArray(row)?row[0]:row; res.setHeader("Cache-Control","no-store"); return res.status(200).json({maintenanceEnabled:Boolean(state?.maintenance_enabled),message:String(state?.maintenance_message||"We are performing maintenance right now. Please check back shortly."),endsAt:state?.ends_at||null,updatedAt:state?.updated_at||null}); }
  const session=getCookie(req);if(!session)return res.status(401).json({error:"Discord administrator sign-in required."});
  const ownerUserId=await rpc("kingshot_developer_account_session_get",{p_token_hash:hash(session)});
  if(typeof ownerUserId!=="string"||!ownerUserId)return res.status(401).json({error:"Discord administrator session expired. Sign in again."});
  if(!SUPABASE_KEY)return res.status(503).json({error:"Admin authorization is not configured."});
  const ownerResponse=await fetch(SUPABASE_URL+"/auth/v1/admin/users/"+encodeURIComponent(ownerUserId),{headers:{apikey:SUPABASE_KEY,authorization:"Bearer "+SUPABASE_KEY},signal:AbortSignal.timeout(8000)});
  const owner=await ownerResponse.json().catch(()=>null);
  const discordIdentity=Array.isArray(owner?.identities)?owner.identities.find(x=>x?.provider==="discord"):null;
  const discordId=String(discordIdentity?.identity_data?.provider_id||discordIdentity?.identity_data?.sub||discordIdentity?.identity_data?.id||discordIdentity?.identity_data?.user_id||owner?.user_metadata?.provider_id||owner?.user_metadata?.sub||owner?.user_metadata?.id||"");
  if(!ownerResponse.ok||!Array.isArray(owner?.app_metadata?.providers)||!owner.app_metadata.providers.includes("discord")||discordId!==OWNER_DISCORD_ID)return res.status(403).json({error:"This Discord account is not authorized to administer the service."});
  const tokenHash=hash(session);
  const valid=await rpc("kingshot_admin_create_discord_session",{p_token_hash:tokenHash,p_user_id:ownerUserId});if(!valid)return res.status(403).json({error:"Could not establish administrator authorization."});
  const audit=async(action,targetType,targetId,details)=>rpc("kingshot_admin_audit",{p_token_hash:tokenHash,p_action:action,p_target_type:targetType||null,p_target_id:targetId||null,p_details:details||{}}).catch(()=>false);
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
   if(action==="REFRESH_PLAYER"){
    const playerId=String(body.playerId||"").trim();
    if(!/^[0-9]{5,20}$/.test(playerId))return res.status(400).json({error:"Invalid Player ID."});
    const player=await lookupPlayer(playerId);
    await audit("REFRESH_PLAYER","player",playerId,{provider:"mightpulse",requestedAt:new Date().toISOString()});
    return res.status(200).json({ok:true,player,refreshedAt:new Date().toISOString(),provider:"mightpulse",freshnessNote:"MightPulse refreshes stale sections automatically; its public API does not document a force-refresh query parameter."});
   }
   if(action==="SET_PLAYER_ENABLED"){
    const playerId=String(body.playerId||"").trim(),enabled=Boolean(body.enabled);
    if(!/^[0-9]{5,20}$/.test(playerId))return res.status(400).json({error:"Invalid Player ID."});
    const result=await rpc("kingshot_admin_set_player_enabled",{p_token_hash:tokenHash,p_player_id:playerId,p_enabled:enabled});
    await audit(enabled?"ENABLE_PLAYER":"DISABLE_PLAYER","player",playerId,{enabled});
    return res.status(200).json({ok:Boolean(result),playerId,enabled});
   }
   if(action==="BAN_PLAYER"){
    const playerId=String(body.playerId||"").trim(),reason=String(body.reason||"Blocked by administrator").trim().slice(0,300)||"Blocked by administrator";
    if(!/^[0-9]{5,20}$/.test(playerId))return res.status(400).json({error:"Invalid Player ID."});
    const rows=await db("kingshot_player_bans?on_conflict=player_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify({player_id:playerId,reason,updated_at:new Date().toISOString()})});
    await audit("BAN_PLAYER","player",playerId,{reason});
    return res.status(200).json({ok:true,ban:Array.isArray(rows)?rows[0]||null:rows});
   }
   if(action==="UNBAN_PLAYER"){
    const playerId=String(body.playerId||"").trim();
    if(!/^[0-9]{5,20}$/.test(playerId))return res.status(400).json({error:"Invalid Player ID."});
    await db("kingshot_player_bans?player_id=eq."+encodeURIComponent(playerId),{method:"DELETE"});
    await audit("UNBAN_PLAYER","player",playerId,{});
    return res.status(200).json({ok:true,playerId});
   }
   if(action==="ADMIN_PUSH_SUBSCRIBE"||action==="ADMIN_PUSH_UNSUBSCRIBE"){
    const {pushIsConfigured,getPushPublicKey}=await import("../internal/push-notifications.js");
    if(!pushIsConfigured())return res.status(503).json({error:"Web push is not configured."});
    if(action==="ADMIN_PUSH_SUBSCRIBE")await savePushSubscription(body.subscription,"admin");else await removePushSubscription(body.subscription,"admin");
    await audit(action,"push_subscription",null,{audience:"admin"});
    return res.status(200).json({ok:true,enabled:action==="ADMIN_PUSH_SUBSCRIBE",publicKey:getPushPublicKey()});
   }
   if(String(body.announcementAction||"")==="upsert"){ const id=body.id&&/^[0-9a-f-]{36}$/.test(String(body.id))?String(body.id):null; const row=await rpc("kingshot_admin_upsert_announcement",{p_token_hash:tokenHash,p_id:id,p_title:String(body.title||""),p_message:String(body.message||""),p_type:String(body.type||"info"),p_link_url:body.link_url?String(body.link_url):null,p_link_label:body.link_label?String(body.link_label):null,p_published_at:body.published_at||null,p_expires_at:body.expires_at||null,p_active:body.active!==false}); const announcements=await rpc("kingshot_admin_list_announcements",{p_token_hash:tokenHash}); await audit(id?"UPDATE_ANNOUNCEMENT":"CREATE_ANNOUNCEMENT","announcement",row?.id||id,{title:row?.title||body.title}); return res.status(200).json({ok:true,announcement:Array.isArray(row)?row[0]:row,announcements:Array.isArray(announcements)?announcements:[]}); }
   if(String(body.action||"").toUpperCase()==="SET_MAINTENANCE"){ const enabled=Boolean(body.enabled); const message=String(body.message||"").trim().slice(0,500); const rawEndsAt=body.endsAt?String(body.endsAt).trim():""; const endsAt=enabled&&rawEndsAt?new Date(rawEndsAt):null; if(enabled&&rawEndsAt&&Number.isNaN(endsAt?.getTime()))return res.status(400).json({error:"Invalid maintenance end time."}); if(enabled&&endsAt&&endsAt.getTime()<=Date.now())return res.status(400).json({error:"Maintenance end time must be in the future."}); const row=await rpc("kingshot_admin_set_maintenance",{p_token_hash:tokenHash,p_enabled:enabled,p_message:message,p_ends_at:endsAt?endsAt.toISOString():null}); const state=Array.isArray(row)?row[0]:row; await audit(enabled?"ENABLE_MAINTENANCE":"DISABLE_MAINTENANCE","site_settings","maintenance",{enabled,message:state?.maintenance_message||message,endsAt:state?.ends_at||null}); return res.status(200).json({ok:true,maintenanceEnabled:Boolean(state?.maintenance_enabled),message:String(state?.maintenance_message||message),endsAt:state?.ends_at||null}); }
   if(String(body.action||"").toUpperCase()==="TEST_WEBHOOK"){
    const webhook=process.env.DISCORD_KINGSHOT_WEBHOOK_URL||process.env.DISCORD_SCRAPER_WEBHOOK_URL;
    if(!webhook)return res.status(503).json({error:"Discord webhook is not configured."});
    const clean=(value,fallback,max)=>{const v=String(value??"").trim();return v?v.slice(0,max):fallback};
    const title=clean(body.title,"🧪 Webhook Test",256);
    const description=clean(body.description,"Kingshot Auto Redeem webhook is connected successfully.",1024);
    const status=clean(body.status,"Connected",1024);
    const triggeredBy=clean(body.triggeredBy,"Admin panel",1024);
    const footer=clean(body.footer,"Kingshot Redeemer",2048);
    const now=new Date();
    const payload={username:"Kingshot Auto Redeem",embeds:[{title,description,color:0x5865F2,fields:[{name:"Status",value:status,inline:true},{name:"Triggered by",value:triggeredBy,inline:true}],timestamp:now.toISOString(),footer:{text:footer}}]};
    const started=Date.now();
    const wr=await fetch(webhook,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...payload,allowed_mentions:{parse:[]}}),signal:AbortSignal.timeout(8000)});
    if(!wr.ok){
     const retryAfter=Number(wr.headers.get("retry-after")||"0");
     const detail=await wr.text().catch(()=>"");
     return res.status(502).json({error:"Discord webhook rejected the alert ("+wr.status+")."+(retryAfter? " Retry after "+Math.ceil(retryAfter)+"s.":"")+(detail? " "+detail.slice(0,180):"")});
    }
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
