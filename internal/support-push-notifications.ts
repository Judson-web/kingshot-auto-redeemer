import webpush from "web-push";
import crypto from "node:crypto";
const BASE=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const PUBLIC_KEY=process.env.WEB_PUSH_VAPID_PUBLIC_KEY||"";
const PRIVATE_KEY=process.env.WEB_PUSH_VAPID_PRIVATE_KEY||"";
const SUBJECT=process.env.WEB_PUSH_VAPID_SUBJECT||"mailto:admin@kingshot-autoredeemer.vercel.app";
const hash=value=>crypto.createHash("sha256").update(String(value||"")).digest("hex");
async function db(path,init={}){if(!KEY)throw Error("Support push storage is not configured.");return fetch(BASE+"/rest/v1/"+path,{...init,headers:{apikey:KEY,authorization:"Bearer "+KEY,"content-type":"application/json",...(init.headers||{})},signal:AbortSignal.timeout(10000)})}
function configure(){if(!KEY||!PUBLIC_KEY||!PRIVATE_KEY)throw Error("Support push notifications are not configured.");webpush.setVapidDetails(SUBJECT,PUBLIC_KEY,PRIVATE_KEY)}
function safePath(value){if(typeof value!=="string"||!value.startsWith("/")||value.startsWith("//")||value.includes("\\"))return"/";try{const u=new URL(value,"https://ks-rewards.com");return u.origin==="https://ks-rewards.com"?u.pathname+u.search+u.hash:"/"}catch{return"/"}}
export function supportPushConfigured(){return Boolean(KEY&&PUBLIC_KEY&&PRIVATE_KEY)}
export function supportPushPublicKey(){return PUBLIC_KEY}
export async function saveSupportPushSubscription(conversationId,token,value){
 const item=value||{},endpoint=String(item.endpoint||""),p256dh=String(item.keys?.p256dh||""),auth=String(item.keys?.auth||"");
 let url;try{url=new URL(endpoint)}catch{throw Error("Invalid push endpoint.")}
 if(url.protocol!=="https:"||url.username||url.password||endpoint.length>2048||p256dh.length>256||auth.length>256||!p256dh||!auth)throw Error("Invalid push subscription.");
 const rows=await db("kingshot_chat_conversations?select=id&id=eq."+encodeURIComponent(conversationId)+"&access_token_hash=eq."+hash(token)+"&limit=1");
 if(!rows.ok)throw Error("Could not verify this support conversation.");
 const found=await rows.json().catch(()=>[]);
 if(!Array.isArray(found)||!found.length)throw Error("Support conversation not found.");
 const response=await db("kingshot_support_push_subscriptions?on_conflict=conversation_id,endpoint",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({conversation_id:conversationId,endpoint,p256dh,auth,last_seen_at:new Date().toISOString()})});
 if(!response.ok)throw Error("Could not save support notification settings.");
}
export async function removeSupportPushSubscription(conversationId,token,value){
 const endpoint=String(value?.endpoint||"");let url;try{url=new URL(endpoint)}catch{throw Error("Invalid push endpoint.")}
 if(url.protocol!=="https:"||url.username||url.password||endpoint.length>2048)throw Error("Invalid push endpoint.");
 const rows=await db("kingshot_chat_conversations?select=id&id=eq."+encodeURIComponent(conversationId)+"&access_token_hash=eq."+hash(token)+"&limit=1");
 if(!rows.ok)throw Error("Could not verify this support conversation.");
 const found=await rows.json().catch(()=>[]);
 if(!Array.isArray(found)||!found.length)throw Error("Support conversation not found.");
 const response=await db("kingshot_support_push_subscriptions?conversation_id=eq."+encodeURIComponent(conversationId)+"&endpoint=eq."+encodeURIComponent(endpoint),{method:"DELETE"});
 if(!response.ok)throw Error("Could not remove support notification settings.");
}
export async function notifySupportReply(conversationId,subject){
 if(!supportPushConfigured())return {sent:0,failed:0};
 configure();
 const response=await db("kingshot_support_push_subscriptions?select=id,endpoint,p256dh,auth&conversation_id=eq."+encodeURIComponent(conversationId));
 if(!response.ok)throw Error("Could not load support notification subscribers.");
 const rows=await response.json().catch(()=>[]);
 const payload=JSON.stringify({title:"Kingshot support replied",body:"An administrator replied to your support conversation.",url:"/",tag:"support-reply-"+String(conversationId).slice(0,64)});
 let sent=0,failed=0,cursor=0;
 const worker=async()=>{while(true){const i=cursor++;if(i>=rows.length)return;const row=rows[i];try{await webpush.sendNotification({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}},payload,{TTL:86400});sent++}catch(error){const status=Number(error?.statusCode||0);if(status===404||status===410){const removed=await db("kingshot_support_push_subscriptions?id=eq."+encodeURIComponent(String(row.id)),{method:"DELETE"}).catch(()=>null);if(!removed?.ok)failed++}else failed++}}};
 await Promise.all(Array.from({length:Math.min(4,rows.length)},worker));
 return {sent,failed};
}
