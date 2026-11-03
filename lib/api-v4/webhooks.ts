import crypto from "node:crypto";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { V3Request,V3Response } from "../api-v3/types.js";

const DB=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SERVICE=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;

// Reject special-use destinations even if DNS changes between validation and connect.
const blocked=new BlockList();
for(const subnet of [
 "0.0.0.0/8","10.0.0.0/8","100.64.0.0/10","127.0.0.0/8",
 "169.254.0.0/16","172.16.0.0/12","192.0.0.0/24","192.0.2.0/24",
 "192.88.99.0/24","192.168.0.0/16","198.18.0.0/15","198.51.100.0/24",
 "203.0.113.0/24","224.0.0.0/4","240.0.0.0/4"
])blocked.addSubnet(subnet, "ipv4");
for(const subnet of [
 "::/128","::1/128","::ffff:0:0/96","64:ff9b:1::/48","100::/64",
 "2001::/23","2001:db8::/32","2002::/16","fc00::/7","fe80::/10",
 "fec0::/10","ff00::/8"
])blocked.addSubnet(subnet, "ipv6");

export function isPublicWebhookAddress(address:string):boolean {
 const family=isIP(address);
 return family!==0&&!blocked.check(address,family===4?"ipv4":"ipv6");
}
function safeUrl(value:string):URL {
 const u=new URL(value);
 if(u.protocol!=="https:"||u.username||u.password||(u.port&&u.port!=="443")||
    u.hostname==="localhost"||u.hostname.endsWith(".local")||
    u.hostname.endsWith(".internal")||u.hostname.endsWith(".localhost"))
   throw Error("unsafe webhook URL");
 return u;
}
async function resolvePublicAddresses(hostname:string):Promise<Array<{address:string;family:number}>> {
 const literal=isIP(hostname);
 const records=literal?[{address:hostname,family:literal}]:await lookup(hostname,{all:true,verbatim:true});
 if(!records.length||records.some(record=>!isPublicWebhookAddress(record.address)))
   throw Error("webhook host resolves to a non-public address");
 return records;
}
export async function assertPublicWebhookUrl(value:string):Promise<void> {
 const u=safeUrl(value);
 await resolvePublicAddresses(u.hostname);
}

// Pin the TCP connection to the exact address checked above. The original hostname
// remains the TLS SNI/certificate identity and Host header. Redirects are never followed.
export async function postPinnedWebhook(value:string,headers:Record<string,string>,body:string):Promise<number> {
 const u=safeUrl(value),records=await resolvePublicAddresses(u.hostname);
 const selected=records[0];
 return await new Promise<number>((resolve,reject)=>{
  let settled=false;
  const finish=(error?:Error,status?:number)=>{if(settled)return;settled=true;error?reject(error):resolve(status||0)};
  const request=https.request({
   protocol:"https:",hostname:u.hostname,port:443,method:"POST",
   path:u.pathname+u.search,headers:{...headers,host:u.host,"content-length":String(Buffer.byteLength(body))},
   servername:isIP(u.hostname)?undefined:u.hostname,
   lookup:((_hostname:string,_options:unknown,callback:(error:NodeJS.ErrnoException|null,address:string,family:number)=>void)=>{
    callback(null,selected.address,selected.family);
   }) as any,
   timeout:5000
  },response=>{
   response.resume();
   response.once("end",()=>finish(undefined,response.statusCode||0));
   response.once("error",error=>finish(error));
  });
  request.once("timeout",()=>request.destroy(new Error("webhook request timed out")));
  request.once("error",error=>finish(error));
  request.end(body);
 });
}
function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y)}
async function db(path:string,init:RequestInit={}){if(!SERVICE)throw Error("service role missing");const r=await fetch(DB+path,{...init,signal:init.signal||AbortSignal.timeout(5000),headers:{apikey:SERVICE,authorization:"Bearer "+SERVICE,"content-type":"application/json",...(init.headers||{})}});const body=await r.json().catch(()=>null);if(!r.ok)throw Error("database request failed: "+r.status);return body}
function decrypt(value:string){const key=Buffer.from(process.env.V4_WEBHOOK_ENCRYPTION_KEY||"","hex");if(key.length!==32)throw Error("webhook encryption key missing");const parts=value.split(".");if(parts.length!==3)throw Error("invalid ciphertext");const [iv,tag,cipher]=parts.map(x=>Buffer.from(x,"base64url"));const d=crypto.createDecipheriv("aes-256-gcm",key,iv);d.setAuthTag(tag);return Buffer.concat([d.update(cipher),d.final()]).toString("utf8")}
export async function enqueueV4WebhookEvent(eventType:"redemption.completed"|"redemption.unknown",payload:Record<string,unknown>){const subs=await db("/rest/v1/kingshot_developer_webhooks?select=id,events&disabled_at=is.null&events=cs.%7B"+encodeURIComponent(eventType)+"%7D");if(!Array.isArray(subs)||!subs.length)return;const rows=subs.filter(s=>Array.isArray(s.events)&&s.events.includes(eventType)).map(s=>({webhook_id:s.id,event_type:eventType,payload}));if(rows.length)await db("/rest/v1/kingshot_developer_webhook_deliveries",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(rows)})}
export default async function webhookWorker(req:V3Request,res:V3Response):Promise<void>{
 if(String(req.method||"GET").toUpperCase()!=="POST"){res.setHeader("Allow","POST");res.status(405).json({error:"method_not_allowed"});return}
 // Fail closed until the egress proxy and its Gateway route are explicitly enabled.
 if(process.env.V4_WEBHOOK_DELIVERY_ENABLED!=="true"){res.status(503).json({ok:false,error:"webhook_delivery_disabled"});return}
 const expectedSecrets=[process.env.V4_WEBHOOK_WORKER_SECRET,process.env.CRON_SECRET].filter((value):value is string=>Boolean(value)),raw=req.headers.authorization,auth=Array.isArray(raw)?raw[0]:String(raw||""),supplied=auth.startsWith("Bearer ")?auth.slice(7):"";
 if(!expectedSecrets.some(secret=>equal(supplied,secret))){res.status(401).json({error:"unauthorized"});return}
 let delivered=0,retried=0,processed=0;
 try{
  const due=await db("/rest/v1/kingshot_developer_webhook_deliveries?select=id,webhook_id,event_id,event_type,payload,attempt_count&delivered_at=is.null&next_attempt_at=lte."+encodeURIComponent(new Date().toISOString())+"&order=next_attempt_at.asc&limit=20");
  for(const row of Array.isArray(due)?due:[]){processed++;try{
   const hs=await db("/rest/v1/kingshot_developer_webhooks?select=url,events,secret_ciphertext,disabled_at&id=eq."+encodeURIComponent(row.webhook_id)+"&limit=1"),hook=Array.isArray(hs)?hs[0]:null;
   if(!hook||hook.disabled_at||!Array.isArray(hook.events)||!hook.events.includes(row.event_type)||!hook.secret_ciphertext){
    await db("/rest/v1/kingshot_developer_webhook_deliveries?id=eq."+encodeURIComponent(row.id),{method:"PATCH",body:JSON.stringify({delivered_at:new Date().toISOString(),last_error:"subscription disabled or invalid"})});continue;
   }
   const body=JSON.stringify({id:row.event_id,type:row.event_type,createdAt:new Date().toISOString(),data:row.payload}),stamp=String(Math.floor(Date.now()/1000)),sig=crypto.createHmac("sha256",decrypt(hook.secret_ciphertext)).update(stamp+"."+body).digest("hex");
   const status=await postPinnedWebhook(String(hook.url),{"content-type":"application/json","user-agent":"Kingshot-Auto-Redeemer-Webhooks/1.0","X-Kingshot-Event":row.event_type,"X-Kingshot-Event-Id":row.event_id,"X-Kingshot-Timestamp":stamp,"X-Kingshot-Signature":"sha256="+sig},body);
   if(status<200||status>=300)throw Object.assign(Error("target returned "+status),{status});
   await db("/rest/v1/kingshot_developer_webhook_deliveries?id=eq."+encodeURIComponent(row.id),{method:"PATCH",body:JSON.stringify({delivered_at:new Date().toISOString(),last_status:status,attempt_count:Number(row.attempt_count||0)+1,last_error:null})});delivered++;
  }catch(e){
   const attempt=Number(row.attempt_count||0)+1,dead=attempt>=8,delay=Math.min(21600,30*Math.pow(2,Math.min(attempt,10))),message=String((e as Error)?.message||"delivery failed").slice(0,300);
   await db("/rest/v1/kingshot_developer_webhook_deliveries?id=eq."+encodeURIComponent(row.id),{method:"PATCH",body:JSON.stringify({attempt_count:attempt,next_attempt_at:new Date(Date.now()+delay*1000).toISOString(),last_status:Number((e as {status?:number})?.status)||null,last_error:dead?"retry limit reached: "+message:message,...(dead?{delivered_at:new Date().toISOString()}:{})})});retried++;
  }}
  res.status(200).json({ok:true,processed,delivered,retryScheduled:retried});
 }catch(e){console.error("[v4-webhook-worker]",String((e as Error)?.message||"error"));res.status(503).json({ok:false,error:"worker_unavailable"})}
}
