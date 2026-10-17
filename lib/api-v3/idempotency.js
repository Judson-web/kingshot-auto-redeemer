import crypto from "node:crypto";
const URL_BASE=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SECRET=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const hash=v=>crypto.createHash("sha256").update(v,"utf8").digest("hex");
export function readIdempotencyKey(req){const raw=req.headers?.["idempotency-key"]??req.headers?.["Idempotency-Key"];const key=Array.isArray(raw)?String(raw[0]||"").trim():String(raw||"").trim();return key?{present:true,valid:/^[A-Za-z0-9._:-]{8,128}$/.test(key),key}:{present:false,valid:true,key:""}}
async function rpc(name,body){if(!SECRET)throw Error("Idempotency storage unavailable");const r=await fetch(URL_BASE+"/rest/v1/rpc/"+name,{method:"POST",headers:{apikey:SECRET,authorization:"Bearer "+SECRET,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(1800)});const d=await r.json().catch(()=>null);if(!r.ok||!d||typeof d!=="object"||Array.isArray(d)){const e=Error("Idempotency storage unavailable");e.status=r.status;throw e}return d}
export async function beginIdempotentRedemption({keyId,key,request}){return rpc("kingshot_developer_begin_redemption",{p_key_id:keyId,p_key_hash:hash(key),p_request_hash:hash(JSON.stringify(request))})}
export async function finishIdempotentRedemption({keyId,key,status,body,outcomeUnknown=false}){return rpc("kingshot_developer_finish_redemption",{p_key_id:keyId,p_key_hash:hash(key),p_response_status:status,p_response_body:body,p_outcome_unknown:outcomeUnknown})}
