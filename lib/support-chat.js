import crypto from "node:crypto";
import { rateLimit } from "./request-rate-limit.js";
const SUPABASE_URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const PROFILE_COOKIE="__Host-ks_profile_session";
const OWNER_COOKIE="__Host-ks_owner_session";
const OWNER_DISCORD_ID="871756466900598815";
const hash=v=>crypto.createHash("sha256").update(String(v)).digest("hex");
function cookie(req,name){const raw=String(req.headers.cookie||"");const part=raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="));try{return part?decodeURIComponent(part.slice(name.length+1)):""}catch{return""}}
async function rpc(name,body){if(!KEY)throw Error("Support storage is not configured.");const r=await fetch(SUPABASE_URL+"/rest/v1/rpc/"+name,{method:"POST",headers:{apikey:KEY,authorization:"Bearer "+KEY,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.message||"Support authentication unavailable.");return d}
async function db(path,options={}){if(!KEY)throw Error("Support storage is not configured.");const r=await fetch(SUPABASE_URL+"/rest/v1/"+path,{...options,headers:{apikey:KEY,authorization:"Bearer "+KEY,"content-type":"application/json",prefer:"return=representation",...(options.headers||{})},signal:AbortSignal.timeout(8000)});const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.message||"Support storage request failed.");return d}
async function requireAdmin(req){
 const session=cookie(req,OWNER_COOKIE)||cookie(req,PROFILE_COOKIE);if(!session||!KEY)return false;
 const userId=await rpc("kingshot_developer_account_session_get",{p_token_hash:hash(session)});
 if(typeof userId!=="string"||!userId)return false;
 const response=await fetch(SUPABASE_URL+"/auth/v1/admin/users/"+encodeURIComponent(userId),{headers:{apikey:KEY,authorization:"Bearer "+KEY},signal:AbortSignal.timeout(8000)});
 const user=await response.json().catch(()=>null);
 const providers=Array.isArray(user?.app_metadata?.providers)?user.app_metadata.providers:[];
 const identities=Array.isArray(user?.identities)?user.identities:[];
 const discord=identities.find(x=>x?.provider==="discord");
 const discordId=String(discord?.identity_data?.provider_id||discord?.identity_data?.sub||discord?.identity_data?.id||user?.user_metadata?.provider_id||user?.user_metadata?.sub||"");
 return response.ok&&providers.includes("discord")&&discordId===OWNER_DISCORD_ID;
}
async function notifyChat(message,conversation){const webhook=process.env.DISCORD_KINGSHOT_WEBHOOK_URL||process.env.DISCORD_SCRAPER_WEBHOOK_URL;if(!webhook)return;try{await fetch(webhook,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"Kingshot Support Chat",allowed_mentions:{parse:[]},embeds:[{title:"New support chat activity",description:"A new message was received. Open the authenticated support inbox to read it.",color:0x5865F2,fields:[{name:"Conversation",value:String(conversation.id),inline:true},{name:"Player ID",value:String(conversation.player_id||"Not provided"),inline:true}],timestamp:new Date().toISOString()}]}),signal:AbortSignal.timeout(5000)})}catch{}}
function send(res,status,body){return res.status(status).json(body)}
const ATTACHMENT_BUCKET="kingshot-support-private";
const MIME_EXT={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif"};
async function saveAttachment(dataUrl,name,conversationId){if(!dataUrl)return null;if(typeof dataUrl!=="string"||dataUrl.length>3000000)throw Object.assign(Error("Image must be 2 MB or smaller."),{status:413});const match=dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);if(!match)throw Object.assign(Error("Choose a JPG, PNG, WebP, or GIF image."),{status:400});const type=match[1],bytes=Buffer.from(match[2],"base64");if(!bytes.length||bytes.length>2097152)throw Object.assign(Error("Image must be 2 MB or smaller."),{status:413});const path=conversationId+"/"+crypto.randomUUID()+"."+MIME_EXT[type];const r=await fetch(SUPABASE_URL+"/storage/v1/object/"+ATTACHMENT_BUCKET+"/"+path,{method:"POST",headers:{apikey:KEY,authorization:"Bearer "+KEY,"content-type":type,"x-upsert":"false"},body:bytes,signal:AbortSignal.timeout(12000)});if(!r.ok){const d=await r.json().catch(()=>null);throw Error(d?.message||"Could not save attachment.");}return {path,name:String(name||("attachment."+MIME_EXT[type])).replace(/[\\/\\\\]/g,"_").slice(0,180),type};}
async function signedAttachment(path){if(!path)return null;const r=await fetch(SUPABASE_URL+"/storage/v1/object/sign/"+ATTACHMENT_BUCKET+"/"+path,{method:"POST",headers:{apikey:KEY,authorization:"Bearer "+KEY,"content-type":"application/json"},body:JSON.stringify({expiresIn:900}),signal:AbortSignal.timeout(8000)});const d=await r.json().catch(()=>null);if(!r.ok)return null;const signed=d?.signedURL||d?.signedUrl;if(!signed)return null;return signed.startsWith("http")?signed:SUPABASE_URL+"/storage/v1"+signed;}
async function hydrateMessages(rows){return Promise.all((rows||[]).map(async m=>({...m,attachment_url:await signedAttachment(m.attachment_path)})));}
async function insertMessage({conversationId,sender,body,attachment,attachmentName}){const saved=attachment?await saveAttachment(attachment,attachmentName,conversationId):null;try{const rows=await db("kingshot_chat_messages",{method:"POST",body:JSON.stringify([{conversation_id:conversationId,sender,body:body||"Photo attachment"}])});if(!rows?.[0]?.id)throw Error("Message was not saved.");if(saved){const updated=await db("kingshot_chat_messages?id=eq."+rows[0].id,{method:"PATCH",body:JSON.stringify({attachment_path:saved.path,attachment_name:saved.name,attachment_type:saved.type})});return {...(updated?.[0]||rows[0]),attachment_path:saved.path,attachment_name:saved.name,attachment_type:saved.type,attachment_url:await signedAttachment(saved.path)}}return rows[0];}catch(e){if(saved){try{await fetch(SUPABASE_URL+"/storage/v1/object/"+ATTACHMENT_BUCKET+"/"+saved.path,{method:"DELETE",headers:{apikey:KEY,authorization:"Bearer "+KEY}})}catch{}}throw e}}
export default async function handler(req,res){
 res.setHeader("Cache-Control","private, no-store, max-age=0");res.setHeader("Pragma","no-cache");res.setHeader("Referrer-Policy","no-referrer");res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("X-Frame-Options","DENY");res.setHeader("Vary","Cookie");
 if(!["GET","POST"].includes(req.method)) {res.setHeader("Allow","GET, POST");return send(res,405,{error:"Method not allowed"});}
 if(req.method==="POST"&&(!req.body||typeof req.body!=="object"||Array.isArray(req.body)))return send(res,400,{error:"A JSON object is required."});
 try{
  const u=new URL(req.url||"/","http://localhost");
  if(req.method==="GET"){
   if(u.searchParams.has("adminConversation")){
    if(!rateLimit(req,res,"support-chat-admin-thread",60,60000))return send(res,429,{error:"Too many support inbox requests. Please retry shortly."});
    if(!await requireAdmin(req))return send(res,401,{error:"Admin login required."});
    const id=String(u.searchParams.get("adminConversation")||"");
    if(!/^[0-9a-f-]{36}$/i.test(id))return send(res,400,{error:"Invalid conversation."});
    const rows=await db("kingshot_chat_conversations?select=id&id=eq."+id+"&limit=1");
    if(!rows?.length)return send(res,404,{error:"Conversation not found."});
    const messages=await db("kingshot_chat_messages?select=id,sender,body,created_at,attachment_path,attachment_name,attachment_type&conversation_id=eq."+id+"&order=created_at.asc&limit=300");
    return send(res,200,{messages:await hydrateMessages(messages)});
   }
   if(u.searchParams.get("admin")==="1"){
    if(!rateLimit(req,res,"support-chat-admin-list",30,60000))return send(res,429,{error:"Too many support inbox requests. Please retry shortly."});
    if(!await requireAdmin(req))return send(res,401,{error:"Admin login required."});
    const rows=await db("kingshot_chat_conversations?select=id,player_id,subject,status,created_at,updated_at,last_message_at,support_ticket_id&order=last_message_at.desc&limit=100");
    const ids=(rows||[]).map(x=>x.id);let latest={};
    if(ids.length){const messages=await db("kingshot_chat_messages?select=id,conversation_id,sender,body,created_at&conversation_id=in.("+ids.join(",")+")&order=created_at.desc");for(const m of messages||[])if(!latest[m.conversation_id])latest[m.conversation_id]=m}
    return send(res,200,{conversations:(rows||[]).map(c=>({...c,lastMessage:latest[c.id]||null}))});
   }
   if(!rateLimit(req,res,"support-chat-read",90,60000))return send(res,429,{error:"Too many refreshes. Please wait a moment and retry."});
   const id=String(u.searchParams.get("conversationId")||""),token=String(u.searchParams.get("token")||"");
   if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9a-f]{64}$/.test(token))return send(res,400,{error:"Invalid conversation credentials."});
   const rows=await db("kingshot_chat_conversations?select=id,subject,status,created_at,updated_at,support_ticket_id&id=eq."+id+"&access_token_hash=eq."+hash(token)+"&limit=1");
   if(!rows?.length)return send(res,404,{error:"Conversation not found."});
   const messages=await db("kingshot_chat_messages?select=id,sender,body,created_at,attachment_path,attachment_name,attachment_type&conversation_id=eq."+id+"&order=created_at.asc&limit=300");
   return send(res,200,{conversation:rows[0],messages:await hydrateMessages(messages)});
  }
  if(req.method==="POST"){
   const b=req.body||{},action=typeof b.action==="string"?b.action:"";
   const allowedActions=new Set(["start","message","admin-reply","admin-status"]);if(!allowedActions.has(action))return send(res,400,{error:"Unknown support chat action."});
   if(action==="start"){
    if(!rateLimit(req,res,"support-chat-start",5,3600000))return send(res,429,{error:"Too many new conversations. Please try again later."});
    const rawBody=typeof b.message==="string"?b.message:"";if(rawBody.length>3000)return send(res,413,{error:"Messages must be 3,000 characters or fewer."});if(typeof b.subject==="string"&&b.subject.length>120)return send(res,400,{error:"Subject must be 120 characters or fewer."});if(typeof b.playerId==="string"&&b.playerId.length>20)return send(res,400,{error:"Player ID must contain 5–20 digits."});const body=rawBody.trim(),playerId=String(b.playerId||"").trim(),subject=String(b.subject||"Support conversation").trim()||"Support conversation";
    if(body.length<3&&!b.attachment)return send(res,400,{error:"Please enter a message or attach a photo."});
    if(playerId&&!/^[0-9]{5,20}$/.test(playerId))return send(res,400,{error:"Player ID must contain 5–20 digits."});
    const token=crypto.randomBytes(32).toString("hex");
    const supportTicketId=String(b.supportTicketId||"").trim();if(supportTicketId){if(subject.toLowerCase().indexOf("registration removal")<0||supportTicketId.length>80||!/^[0-9]{5,20}$/.test(playerId))return send(res,400,{error:"Invalid linked registration-removal ticket."});const linked=await db("kingshot_support_tickets?select=id,player_id&id=eq."+encodeURIComponent(supportTicketId)+"&player_id=eq."+encodeURIComponent(playerId)+"&limit=1");if(!linked?.length)return send(res,403,{error:"That removal ticket does not match this Player ID."});}
    const rows=await db("kingshot_chat_conversations",{method:"POST",body:JSON.stringify([{access_token_hash:hash(token),player_id:playerId||null,subject,support_ticket_id:supportTicketId||null}])});
    const conversation=rows?.[0];if(!conversation?.id)throw Error("Could not create a support conversation.");
    let messages;try{messages=[await insertMessage({conversationId:conversation.id,sender:"user",body,attachment:b.attachment,attachmentName:b.attachmentName})];if(!messages?.[0]?.id)throw Error("Support message was not saved.");}catch(error){try{await db("kingshot_chat_conversations?id=eq."+conversation.id,{method:"DELETE",headers:{prefer:"return=minimal"}})}catch{}throw error}
    try{await db("kingshot_chat_conversations?id=eq."+conversation.id,{method:"PATCH",body:JSON.stringify({last_message_at:messages[0].created_at||new Date().toISOString(),updated_at:new Date().toISOString()})})}catch(error){console.error("Support conversation timestamp update failed:",error?.message||error)}
    await notifyChat({body},conversation);
    return send(res,201,{conversation:{id:conversation.id,subject:conversation.subject,status:conversation.status,support_ticket_id:conversation.support_ticket_id||supportTicketId||null},token,messages:await hydrateMessages(messages)});
   }
   if(action==="message"){
    if(!rateLimit(req,res,"support-chat-message",20,60000))return send(res,429,{error:"Please wait before sending another message."});
    const id=String(b.conversationId||""),token=String(b.token||""),rawBody=typeof b.message==="string"?b.message:"";if(rawBody.length>3000)return send(res,413,{error:"Messages must be 3,000 characters or fewer."});const body=rawBody.trim();
    if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9a-f]{64}$/.test(token)||(!body&&!b.attachment))return send(res,400,{error:"Conversation, access token, and a message or photo are required."});
    const found=await db("kingshot_chat_conversations?select=id,status&id=eq."+id+"&access_token_hash=eq."+hash(token)+"&limit=1");
    if(!found?.length)return send(res,404,{error:"Conversation not found."});
    if(found[0].status==="resolved")return send(res,409,{error:"This conversation is resolved. Start a new conversation if you still need help."});
    const rows=[await insertMessage({conversationId:id,sender:"user",body,attachment:b.attachment,attachmentName:b.attachmentName})];if(!rows?.[0]?.id)return send(res,502,{error:"Your message could not be confirmed as saved. Please refresh before retrying."});
    try{await db("kingshot_chat_conversations?id=eq."+id,{method:"PATCH",body:JSON.stringify({status:"open",last_message_at:rows[0].created_at||new Date().toISOString(),updated_at:new Date().toISOString()})})}catch(error){console.error("Support conversation update failed after message save:",error?.message||error)}
    await notifyChat(rows[0],found[0]);return send(res,201,{message:rows[0]});
   }
   if(action==="admin-reply"||action==="admin-status"){
    if(!rateLimit(req,res,"support-chat-admin-write",30,60000))return send(res,429,{error:"Too many support actions. Please retry shortly."});
    if(!await requireAdmin(req))return send(res,401,{error:"Admin login required."});
    const id=String(b.conversationId||"");if(!/^[0-9a-f-]{36}$/i.test(id))return send(res,400,{error:"Invalid conversation."});
    const found=await db("kingshot_chat_conversations?select=id,status&id=eq."+id+"&limit=1");if(!found?.length)return send(res,404,{error:"Conversation not found."});
    if(action==="admin-reply"){
     if(found[0].status==="resolved")return send(res,409,{error:"This conversation is resolved. Reopen it before replying."});
     const rawBody=typeof b.message==="string"?b.message:"";const body=rawBody.trim();if(!body&&!b.attachment)return send(res,400,{error:"Reply must include text or a photo."});if(body.length>3000)return send(res,413,{error:"Replies must be 3,000 characters or fewer."});
     const rows=[await insertMessage({conversationId:id,sender:"admin",body,attachment:b.attachment,attachmentName:b.attachmentName})];if(!rows?.[0]?.id)return send(res,502,{error:"The reply could not be confirmed as saved. Refresh the conversation before retrying."});
     try{await db("kingshot_chat_conversations?id=eq."+id,{method:"PATCH",body:JSON.stringify({status:"waiting",last_message_at:rows[0].created_at||new Date().toISOString(),updated_at:new Date().toISOString()})})}catch(error){console.error("Support reply saved but conversation state update failed:",error?.message||error)}
     return send(res,201,{message:rows[0]});
    }
    const status=typeof b.status==="string"?b.status:"";if(!["open","waiting","resolved"].includes(status))return send(res,400,{error:"Invalid conversation status."});
    if(found[0].status===status)return send(res,200,{conversation:found[0],unchanged:true});
    const rows=await db("kingshot_chat_conversations?id=eq."+id,{method:"PATCH",body:JSON.stringify({status,updated_at:new Date().toISOString()})});
    return send(res,200,{conversation:rows?.[0]||null});
   }
   return send(res,400,{error:"Unknown support chat action."});
  }
  return send(res,405,{error:"Method not allowed"});
 }catch(e){console.error("Support chat request failed:",e?.message||e);return send(res,e?.status||502,{error:e?.status?e.message:"Support chat is temporarily unavailable."})}
}
