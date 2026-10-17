import { redeemKingshot } from "../../internal/kingshot/redeem.js";
import { validateV3RedemptionBody } from "../developer-api-v3-validation.js";
import type { JsonRecord,V3AuthorizationContext,V3Request,V3Response } from "./types.js";
import { sendError,timestamp } from "./http.js";
import { beginIdempotentRedemption,finishIdempotentRedemption,readIdempotencyKey } from "./idempotency.js";
const errBody=(code:string,message:string,id:string,rateLimit:JsonRecord):JsonRecord=>({error:{code,message},meta:{apiVersion:"3",requestId:id,timestamp:timestamp(),rateLimit}});
export async function handleV3Redemption(req:V3Request,res:V3Response,id:string,auth:V3AuthorizationContext):Promise<void>{
 const v=validateV3RedemptionBody(req.body);if(v.valid===false){sendError(res,400,v.code,v.message,id,{rateLimit:auth.rateLimit});return}
 const idem=readIdempotencyKey(req);if(!idem.valid){sendError(res,400,"invalid_idempotency_key","Idempotency-Key must be 8–128 safe ASCII characters.",id,{rateLimit:auth.rateLimit});return}
 const keyId=String(auth.key_id||"");let claimed=false;
 if(idem.present){if(!/^[0-9a-f-]{36}$/i.test(keyId)){sendError(res,503,"idempotency_unavailable","API key context cannot safely use idempotency.",id,{rateLimit:auth.rateLimit});return}
 try{const c=await beginIdempotentRedemption({keyId,key:idem.key,request:v.value});
 if(c.state==="conflict"){sendError(res,409,"idempotency_key_reused","This key was used with a different request body.",id,{rateLimit:auth.rateLimit});return}
 if(c.state==="in_progress"){sendError(res,409,"idempotency_in_progress","This keyed request is still processing; retry using the same key.",id,{rateLimit:auth.rateLimit});return}
 if(c.state==="replay"||c.state==="unknown"){res.setHeader("Idempotency-Replayed","true");res.status(Number(c.response_status)||504).json(c.response_body);return}
 if(c.state!=="started")throw Error("Unexpected idempotency state");claimed=true;
 }catch(e){console.error("[developer-api-v3] idempotency storage failed",{requestId:id,status:(e as {status?:number})?.status});sendError(res,503,"idempotency_unavailable","Durable idempotency storage is unavailable; no redemption was submitted.",id,{rateLimit:auth.rateLimit});return}}
 const send=async(status:number,body:JsonRecord,unknown=false)=>{if(claimed){try{await finishIdempotentRedemption({keyId,key:idem.key,status,body,outcomeUnknown:unknown})}catch(e){console.error("[developer-api-v3] idempotency outcome persistence failed",{requestId:id,status:(e as {status?:number})?.status});sendError(res,503,"outcome_persistence_failed","Outcome may be ambiguous. Reuse the same Idempotency-Key; do not submit a new attempt.",id,{rateLimit:auth.rateLimit});return}}res.status(status).json(body)};
 try{const r=await redeemKingshot(v.value);
 if(r.httpStatus===504||r.errorCategory==="TIMEOUT"){await send(504,errBody("upstream_timeout","Provider timed out. Reuse the same key; do not submit a new attempt.",id,auth.rateLimit),true);return}
 if(r.httpStatus>=500){const bad=/not configured/i.test(String(r.error||""));await send(bad?503:502,errBody(bad?"upstream_not_configured":"upstream_unavailable",bad?"Redemption provider is not configured.":"Provider unavailable; outcome may be ambiguous. Do not submit a new attempt.",id,auth.rateLimit),!bad);return}
 await send(200,{data:{ok:Boolean(r.ok),status:r.status||"ERROR",statusLabel:r.statusLabel||null,message:r.message||r.error||"The redemption request completed.",errorCategory:r.errorCategory||null,errCode:r.errCode??null},meta:{apiVersion:"3",requestId:id,timestamp:timestamp(),rateLimit:auth.rateLimit}});
 }catch(e){console.error("[developer-api-v3] redemption failed",{requestId:id,status:(e as {status?:number})?.status});await send(502,errBody("upstream_unavailable","Provider unavailable; outcome may be ambiguous. Do not submit a new attempt.",id,auth.rateLimit),true)}
}
