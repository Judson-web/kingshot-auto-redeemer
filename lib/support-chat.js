import crypto from "node:crypto";
import { rateLimit } from "./request-rate-limit.js";
const URL=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const ADMIN_COOKIE="__Host-ks_admin_session";
const hash=v=>crypto.createHash("sha256").update(String(v)).digest("hex");
function cookie(req,name){const raw=String(req.headers.cookie||"");const part=raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="));try{return part?decodeURIComponent(part.slice(name.length+1)):""}catch{return""}}
async function rpc(name,body){if(!KEY)throw Error("Support storage is not configured.");const r=await fetch(URL+"/rest/v1/rpc/"+name,{method:"POST",headers:{apikey:KEY,authorization:"Bearer "+KEY,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.message||"Support authentication unavailable.");return d}
async function db(path,options={}){if(!KEY)throw Error("Support storage is not configured.");const r=await fetch(URL+"/rest/v1/"+path,{...options,headers:{apikey:KEY,authorization:"Bearer "+KEY,"content-type":"application/json",prefer:"return=representation",...(options.headers||{})},signal:AbortSignal.timeout(8000)});const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.message||"Support storage request failed.");return d}
async function requireAdmin(req){const session=cookie(req,ADMIN_COOKIE);if(!session)return false;return Boolean(await rpc("kingshot_admin_validate_session",{p_token_hash:hash(session)}))}
async function notifyChat(message,conversation){const webhook=process.env.DISCORD_KINGSHOT_WEBHOOK_URL||process.env.DISCORD_SCRAPER_WEBHOOK_URL;if(!webhook)return;try{await fetch(webhook,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"Kingshot Support Chat",allowed_mentions:{parse:[]},embeds:[{title:"New support chat message",description:String(message.body||"").slice(0,1500),color:0x5865F2,fields:[{name:"Conversation",value:String(conversation.id),inline:true},{name:"Player ID",value:String(conversation.player_id||"Not provided"),inline:true}],timestamp:new Date().toISOString()}]}),signal:AbortSignal.timeout(5000)})}catch{}}
function send(res,status,body){return res.status(status).json(body)}
export default async function handler(req,res){
 res.setHeader("Cache-Control","private, no-store");res.setHeader("X-Content-Type-Options","nosniff");
 if(!["GET","POST","PATCH"].includes(req.method))return send(res,405,{error:"Method not allowed"});
 try{
  const u=new URL(req.url||"/","http://localhost");
  if(req.method==="GET"){
   if(u.searchParams.has("adminConversation")){
    if(!await requireAdmin(req))return send(res,401,{error:"Admin login required."});
    const id=String(u.searchParams.get("adminConversation")||"");
    if(!/^[0-9a-f-]{36}$/i.test(id))return send(res,400,{error:"Invalid conversation."});
    const rows=await db("kingshot_chat_conversations?select=id&id=eq."+id+"&limit=1");
    if(!rows?.length)return send(res,404,{error:"Conversation not found."});
    const messages=await db("kingshot_chat_messages?select=id,sender,body,created_at&conversation_id=eq."+id+"&order=created_at.asc&limit=300");
    return send(res,200,{messages:messages||[]});
   }
   if(u.searchParams.get("admin")==="1"){
    if(!await requireAdmin(req))return send(res,401,{error:"Admin login required."});
    const rows=await db("kingshot_chat_conversations?select=id,player_id,subject,status,created_at,updated_at,last_message_at&order=last_message_at.desc&limit=100");
    const ids=(rows||[]).map(x=>x.id);let latest={};
    if(ids.length){const messages=await db("kingshot_chat_messages?select=id,conversation_id,sender,body,created_at&conversation_id=in.("+ids.join(",")+")&order=created_at.desc");for(const m of messages||[])if(!latest[m.conversation_id])latest[m.conversation_id]=m}
    return send(res,200,{conversations:(rows||[]).map(c=>({...c,lastMessage:latest[c.id]||null}))});
   }
   const id=String(u.searchParams.get("conversationId")||""),token=String(u.searchParams.get("token")||"");
   if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9a-f]{64}$/.test(token))return send(res,400,{error:"Invalid conversation credentials."});
   const rows=await db("kingshot_chat_conversations?select=id,subject,status,created_at,updated_at&id=eq."+id+"&access_token_hash=eq."+hash(token)+"&limit=1");
   if(!rows?.length)return send(res,404,{error:"Conversation not found."});
   const messages=await db("kingshot_chat_messages?select=id,sender,body,created_at&conversation_id=eq."+id+"&order=created_at.asc&limit=300");
   return send(res,200,{conversation:rows[0],messages:messages||[]});
  }
  if(req.method==="POST"){
   const b=req.body||{},action=String(b.action||"");
   if(action==="start"){
    if(!rateLimit(req,res,"support-chat-start",5,3600000))return send(res,429,{error:"Too many new conversations. Please try again later."});
    const body=String(b.message||"").trim().slice(0,3000),playerId=String(b.playerId||"").trim(),subject=String(b.subject||"Support conversation").trim().slice(0,120)||"Support conversation";
    if(body.length<3)return send(res,400,{error:"Please enter a message with at least 3 characters."});
    if(playerId&&!/^[0-9]{5,20}$/.test(playerId))return send(res,400,{error:"Player ID must contain 5–20 digits."});
    const token=crypto.randomBytes(32).toString("hex");
    const rows=await db("kingshot_chat_conversations",{method:"POST",body:JSON.stringify([{access_token_hash:hash(token),player_id:playerId||null,subject}])});
    const conversation=rows?.[0];if(!conversation?.id)throw Error("Could not create a support conversation.");
    const messages=await db("kingshot_chat_messages",{method:"POST",body:JSON.stringify([{conversation_id:conversation.id,sender:"user",body}])});
    await db("kingshot_chat_conversations?id=eq."+conversation.id,{method:"PATCH",body:JSON.stringify({last_message_at:messages?.[0]?.created_at||new Date().toISOString(),updated_at:new Date().toISOString()})});
    await notifyChat({body},conversation);
    return send(res,201,{conversation:{id:conversation.id,subject:conversation.subject,status:conversation.status},token,messages:messages||[]});
   }
   if(action==="message"){
    if(!rateLimit(req,res,"support-chat-message",20,60000))return send(res,429,{error:"Please wait before sending another message."});
    const id=String(b.conversationId||""),token=String(b.token||""),body=String(b.message||"").trim().slice(0,3000);
    if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9a-f]{64}$/.test(token)||body.length<1)return send(res,400,{error:"Conversation, access token, and message are required."});
    const found=await db("kingshot_chat_conversations?select=id,status&id=eq."+id+"&access_token_hash=eq."+hash(token)+"&limit=1");
    if(!found?.length)return send(res,404,{error:"Conversation not found."});
    if(found[0].status==="resolved")return send(res,409,{error:"This conversation is resolved. Start a new conversation if you still need help."});
    const rows=await db("kingshot_chat_messages",{method:"POST",body:JSON.stringify([{conversation_id:id,sender:"user",body}])});
    await db("kingshot_chat_conversations?id=eq."+id,{method:"PATCH",body:JSON.stringify({status:"open",last_message_at:rows?.[0]?.created_at||new Date().toISOString(),updated_at:new Date().toISOString()})});
    await notifyChat(rows?.[0]||{body},found[0]);return send(res,201,{message:rows?.[0]});
   }
   if(action==="admin-reply"||action==="admin-status"){
    if(!await requireAdmin(req))return send(res,401,{error:"Admin login required."});
    const id=String(b.conversationId||"");if(!/^[0-9a-f-]{36}$/i.test(id))return send(res,400,{error:"Invalid conversation."});
    const found=await db("kingshot_chat_conversations?select=id&id=eq."+id+"&limit=1");if(!found?.length)return send(res,404,{error:"Conversation not found."});
    if(action==="admin-reply"){
     const body=String(b.message||"").trim().slice(0,3000);if(!body)return send(res,400,{error:"Reply cannot be empty."});
     const rows=await db("kingshot_chat_messages",{method:"POST",body:JSON.stringify([{conversation_id:id,sender:"admin",body}])});
     await db("kingshot_chat_conversations?id=eq."+id,{method:"PATCH",body:JSON.stringify({status:"waiting",last_message_at:rows?.[0]?.created_at||new Date().toISOString(),updated_at:new Date().toISOString()})});
     return send(res,201,{message:rows?.[0]});
    }
    const status=String(b.status||"");if(!["open","waiting","resolved"].includes(status))return send(res,400,{error:"Invalid conversation status."});
    const rows=await db("kingshot_chat_conversations?id=eq."+id,{method:"PATCH",body:JSON.stringify({status,updated_at:new Date().toISOString()})});
    return send(res,200,{conversation:rows?.[0]||null});
   }
   return send(res,400,{error:"Unknown support chat action."});
  }
  return send(res,405,{error:"Method not allowed"});
 }catch(e){console.error("Support chat request failed:",e?.message||e);return send(res,502,{error:"Support chat is temporarily unavailable."})}
}
