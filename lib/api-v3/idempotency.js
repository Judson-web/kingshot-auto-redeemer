import crypto from "node:crypto";
const URL_BASE=process.env.SUPABASE_URL||"https://wocxvtptqapietlteshr.supabase.co";
const SECRET=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
const hash=v=>crypto.createHash("sha256").update(v,"utf8").digest("hex");

/**
 * Read one unambiguous Idempotency-Key value. Duplicate header values are
 * rejected because intermediaries may combine them differently.
 */
export function readIdempotencyKey(req){
  const headers = req?.headers || {};
  const headerName = Object.keys(headers).find(name => name.toLowerCase() === "idempotency-key");
  const raw = headerName ? headers[headerName] : undefined;
  if (Array.isArray(raw)) {
    if (raw.length !== 1) return {present:true,valid:false,key:""};
    const key = String(raw[0] || "").trim();
    return key ? {present:true,valid:/^[A-Za-z0-9._:-]{8,128}$/.test(key),key} : {present:false,valid:true,key:""};
  }
  const key = String(raw || "").trim();
  return key ? {present:true,valid:/^[A-Za-z0-9._:-]{8,128}$/.test(key),key} : {present:false,valid:true,key:""};
}

/**
 * Replayed results preserve the original operation outcome, but request-scoped
 * metadata must describe this HTTP attempt so its body matches X-Request-Id.
 * @param {unknown} body
 * @param {{requestId:string,timestamp:string,rateLimit:Record<string,unknown>}} context
 * @returns {Record<string, unknown> | null}
 */
export function refreshIdempotentResponseMetadata(body, context) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = /** @type {Record<string, unknown>} */ (body);
  const previousMeta = record.meta && typeof record.meta === "object" && !Array.isArray(record.meta)
    ? /** @type {Record<string, unknown>} */ (record.meta)
    : {};
  return {
    ...record,
    meta: {
      ...previousMeta,
      apiVersion: "3",
      requestId: context.requestId,
      timestamp: context.timestamp,
      rateLimit: context.rateLimit
    }
  };
}

async function rpc(name,body){
  if(!SECRET)throw Error("Idempotency storage unavailable");
  const r=await fetch(URL_BASE+"/rest/v1/rpc/"+name,{method:"POST",headers:{apikey:SECRET,authorization:"Bearer "+SECRET,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(1800)});
  const d=await r.json().catch(()=>null);
  if(!r.ok||!d||typeof d!=="object"||Array.isArray(d)){const e=Error("Idempotency storage unavailable");e.status=r.status;throw e}
  return d
}
export async function beginIdempotentRedemption({keyId,key,request}){return rpc("kingshot_developer_begin_redemption",{p_key_id:keyId,p_key_hash:hash(key),p_request_hash:hash(JSON.stringify(request))})}
export async function finishIdempotentRedemption({keyId,key,status,body,outcomeUnknown=false}){return rpc("kingshot_developer_finish_redemption",{p_key_id:keyId,p_key_hash:hash(key),p_response_status:status,p_response_body:body,p_outcome_unknown:outcomeUnknown})}
