import crypto from"node:crypto";
const SUPABASE_URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const COOKIE="__Host-ks_admin_session",FALLBACK_COOKIE="ks_admin_session";
function hash(value){return crypto.createHash("sha256").update(String(value)).digest("hex")}
function getCookie(req){const raw=String(req.headers.cookie||"");const parts=raw.split(";").map(x=>x.trim());for(const name of [COOKIE,FALLBACK_COOKIE]){const part=parts.find(x=>x.startsWith(name+"="));if(part)return decodeURIComponent(part.slice(name.length+1))}return""}
async function rpc(name,body){const r=await fetch(SUPABASE_URL+"/rest/v1/rpc/"+name,{method:"POST",headers:{"apikey":SUPABASE_KEY,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.message||"Admin data service unavailable.");return d}
export default async function handler(req,res){
 res.setHeader("Cache-Control","private, no-store");
 if(!["GET","POST","PATCH","DELETE"].includes(req.method))return res.status(405).json({error:"Method not allowed"});
 try{
  const publicMode=String(req.query?.public||"");
  if(req.method==="GET"&&publicMode==="announcements"){ const rows=await rpc("kingshot_public_announcements",{}); res.setHeader("Cache-Control","no-store"); return res.status(200).json({announcements:Array.isArray(rows)?rows:[]}); }
  if(req.method==="GET"&&publicMode==="maintenance"){ const row=await rpc("kingshot_public_maintenance",{}); const state=Array.isArray(row)?row[0]:row; res.setHeader("Cache-Control","no-store"); return res.status(200).json({maintenanceEnabled:Boolean(state?.maintenance_enabled),message:String(state?.maintenance_message||"We are performing maintenance right now. Please check back shortly."),endsAt:state?.ends_at||null,updatedAt:state?.updated_at||null}); }
  const session=getCookie(req);if(!session)return res.status(401).json({error:"Unauthorized"});
  const tokenHash=hash(session);
  const audit=async(action,targetType,targetId,details)=>rpc("kingshot_admin_audit",{p_token_hash:tokenHash,p_action:action,p_target_type:targetType||null,p_target_id:targetId||null,p_details:details||{}}).catch(()=>false);
  const valid=await rpc("kingshot_admin_validate_session",{p_token_hash:tokenHash});if(!valid)return res.status(401).json({error:"Unauthorized"});
  if(req.method==="POST"){
   const body=req.body||{};
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
   const [players,announcements,tickets,giftCodes,auditLog,scraperComparison,maintenance]=await Promise.all([rpc("kingshot_admin_list_players",{p_token_hash:tokenHash}),rpc("kingshot_admin_list_announcements",{p_token_hash:tokenHash}),rpc("kingshot_admin_list_tickets",{p_token_hash:tokenHash}),rpc("kingshot_admin_list_gift_codes",{p_token_hash:tokenHash}),rpc("kingshot_admin_list_audit",{p_token_hash:tokenHash,p_limit:100}),rpc("kingshot_admin_scraper_comparison",{p_token_hash:tokenHash}),rpc("kingshot_admin_get_maintenance",{p_token_hash:tokenHash})]);
   return res.status(200).json({players:Array.isArray(players)?players:[],announcements:Array.isArray(announcements)?announcements:[],tickets:Array.isArray(tickets)?tickets:[],giftCodes:Array.isArray(giftCodes)?giftCodes:[],auditLog:Array.isArray(auditLog)?auditLog:[],scraperComparison:Array.isArray(scraperComparison)?scraperComparison:[],maintenance:Array.isArray(maintenance)?maintenance[0]||null:maintenance||null});
  }
  const body=req.body||{},action=String(body.action||"").toUpperCase(),ticketId=String(body.ticketId||"");
  if(!/^[0-9a-f-]{36}$/.test(ticketId))return res.status(400).json({error:"Invalid ticket."});
  if(!["REVOKE","CANCEL"].includes(action))return res.status(400).json({error:"Invalid action."});
  const ticket=await rpc("kingshot_admin_update_ticket",{p_token_hash:tokenHash,p_ticket_id:ticketId,p_action:action});
  await audit(action==="REVOKE"?"REVOKE_TICKET":"CANCEL_TICKET","support_ticket",ticketId,{});
  return res.status(200).json({ok:true,ticket:Array.isArray(ticket)?ticket[0]:ticket});
 }catch(e){return res.status(502).json({error:e.message||"Could not process admin request."})}
}
