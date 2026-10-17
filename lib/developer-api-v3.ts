import crypto from "node:crypto";
import { getPlayerSnapshot } from "../internal/kingshot/mightpulse.js";
import { redeemKingshot } from "../internal/kingshot/redeem.js";
import { normalizeV3PlayerId, validateV3RedemptionBody } from "./developer-api-v3-validation.js";

type HeaderValue = string | string[] | undefined;
interface RequestLike { method?: string; url?: string; headers: Record<string, HeaderValue>; body?: unknown; query?: Record<string, unknown>; }
interface ResponseLike { status(code: number): ResponseLike; json(body: unknown): ResponseLike; setHeader(name: string, value: string): void; end?: () => ResponseLike; }
type JsonRecord = Record<string, unknown>;
const SUPABASE_URL = process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const sha256 = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const now = () => new Date().toISOString();

function header(req: RequestLike, name: string): string {
 const value=req.headers[name.toLowerCase()]??req.headers[name];
 return Array.isArray(value)?String(value[0]||""):String(value||"");
}
function trustedClientIp(req: RequestLike): string {
 const raw=header(req,"x-vercel-forwarded-for").split(",")[0].trim();
 return raw.length>0&&raw.length<=64?raw:"";
}
function apiKeyFromRequest(req: RequestLike): string {
 const match=/^Bearer\s+(ks_live_[a-f0-9]{64})$/i.exec(header(req,"authorization").trim());
 return match?match[1]:"";
}
function sendError(res: ResponseLike,status:number,code:string,message:string,requestId:string,meta:JsonRecord={}):void {
 res.setHeader("X-Request-Id",requestId); res.setHeader("X-API-Version","3");
 if(status===429&&typeof meta.resetAt==="string"){
  const reset=Date.parse(meta.resetAt); if(Number.isFinite(reset))res.setHeader("Retry-After",String(Math.max(1,Math.ceil((reset-Date.now())/1000))));
 }
 res.status(status).json({error:{code,message},meta:{apiVersion:"3",requestId,timestamp:now(),...meta}});
}
function num(value:unknown):number|null{
 if(typeof value==="number"&&Number.isFinite(value))return value;
 if(typeof value==="string"&&value.trim()!==""){const n=Number(value);if(Number.isFinite(n))return n;}
 return null;
}
function quota(result:JsonRecord):JsonRecord{
 const value:JsonRecord={perDayLimit:1000}; const limit=num(result.limit),remaining=num(result.remaining),daily=num(result.daily_remaining);
 if(limit!==null)value.perMinuteLimit=limit;
 if(remaining!==null)value.perMinuteRemaining=remaining;
 if(daily!==null)value.perDayRemaining=daily;
 if(typeof result.reset_at==="string")value.resetAt=result.reset_at;
 return value;
}
function setRateHeaders(res:ResponseLike,result:JsonRecord):void{
 const limit=num(result.limit),remaining=num(result.remaining);
 if(limit!==null)res.setHeader("X-RateLimit-Limit",String(limit));
 if(remaining!==null)res.setHeader("X-RateLimit-Remaining",String(remaining));
 if(typeof result.reset_at==="string"){const t=Date.parse(result.reset_at);if(Number.isFinite(t))res.setHeader("X-RateLimit-Reset",String(Math.ceil(t/1000)));}
}
async function rpc<T>(name:string,body:JsonRecord):Promise<T>{
 if(!SUPABASE_KEY)throw new Error("Developer API authorization is not configured.");
 const response=await fetch(SUPABASE_URL+"/rest/v1/rpc/"+name,{method:"POST",headers:{apikey:SUPABASE_KEY,authorization:"Bearer "+SUPABASE_KEY,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(7000)});
 const data=await response.json().catch(()=>null);
 if(!response.ok){const e=new Error("Developer API authorization service is unavailable.") as Error&{status?:number};e.status=response.status;throw e;}
 return data as T;
}
function publicHeaders(res:ResponseLike,methods:string):void{
 res.setHeader("Cache-Control","private, no-store");res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("X-API-Version","3");
 res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Methods",methods+", OPTIONS");res.setHeader("Access-Control-Allow-Headers","Authorization, Content-Type");
 res.setHeader("Access-Control-Expose-Headers","X-Request-Id, X-API-Version, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After");res.setHeader("Vary","Origin");
}
async function authorize(req:RequestLike,res:ResponseLike,rid:string):Promise<JsonRecord|null>{
 const key=apiKeyFromRequest(req);
 if(!key){res.setHeader("WWW-Authenticate","Bearer");sendError(res,401,"missing_api_key","A valid developer Bearer API key is required.",rid);return null;}
 const ip=trustedClientIp(req);
 if(!ip){sendError(res,503,"client_ip_unavailable","The trusted client IP is unavailable; the request cannot be authorized safely.",rid);return null;}
 if(!SUPABASE_KEY){sendError(res,503,"service_not_configured","The developer API is not configured on the server.",rid);return null;}
 let result:JsonRecord;
 try{result=await rpc<JsonRecord>("kingshot_developer_authorize_key",{p_key_hash:sha256(key),p_ip_hash:sha256(ip)});}
 catch(error){console.error("[developer-api-v3] authorization service failed",{status:(error as {status?:number}|null)?.status});sendError(res,503,"authorization_unavailable","The developer authorization service is temporarily unavailable.",rid);return null;}
 setRateHeaders(res,result);
 if(result.allowed!==true){
  const reason=String(result.reason||"");
  if(reason==="invalid_api_key"){res.setHeader("WWW-Authenticate","Bearer");sendError(res,401,"invalid_api_key","The API key is invalid or has been revoked.",rid);return null;}
  if(reason==="client_ip_unavailable"){sendError(res,503,"client_ip_unavailable","The trusted client IP is unavailable.",rid);return null;}
  const resetAt=typeof result.reset_at==="string"?result.reset_at:undefined;
  sendError(res,429,"rate_limit_exceeded","The per-key or per-IP request limit has been reached.",rid,{reason:reason||"quota_exceeded",rateLimit:quota(result),...(resetAt?{resetAt}:{})});return null;
 }
 return {...result,rateLimit:quota(result)};
}
function queryValue(req:RequestLike,name:string):string{
 const value=req.query?.[name];
 if(typeof value==="string")return value;
 if(Array.isArray(value)&&typeof value[0]==="string")return value[0];
 try{return new URL(req.url||"/","https://local.invalid").searchParams.get(name)||"";}catch{return "";}
}
function avatar(value:unknown):string|null{
 if(typeof value!=="string"||value.length>1000)return null;
 try{const parsed=new URL(value);return parsed.protocol==="https:"||parsed.protocol==="http:"?parsed.toString().slice(0,500):null;}catch{return null;}
}
function isJson(req:RequestLike):boolean{return /^application\/json(?:\s*;|\s*$)/i.test(header(req,"content-type").trim());}

export default async function developerApiV3(req:RequestLike,res:ResponseLike,path:string):Promise<void>{
 const rid=crypto.randomUUID(),method=String(req.method||"GET").toUpperCase();
 const route=path==="player"?"player":path==="redemptions"?"redemptions":"";
 const allow=route==="player"?"GET":route==="redemptions"?"POST":"GET";
 res.setHeader("X-Request-Id",rid);res.setHeader("X-API-Version","3");publicHeaders(res,allow);
 if(method==="OPTIONS"){const response=res.status(204);if(typeof response.end==="function")response.end();else response.json({});return;}
 if(!route){sendError(res,404,"route_not_found","V3 API route not found.",rid,{documentation:"/developer"});return;}
 if(method!==allow){res.setHeader("Allow",allow+", OPTIONS");sendError(res,405,"method_not_allowed","This method is not supported for the requested V3 route.",rid);return;}
 if(route==="redemptions"&&!isJson(req)){sendError(res,415,"unsupported_media_type","Send the redemption request as application/json.",rid);return;}
 const auth=await authorize(req,res,rid);if(!auth)return;

 if(route==="player"){
  const id=normalizeV3PlayerId(queryValue(req,"id"));
  if(!id){sendError(res,400,"invalid_player_id","The playerId path parameter must contain 5–20 digits.",rid,{rateLimit:auth.rateLimit});return;}
  try{
   const snapshot=await getPlayerSnapshot(id),player=snapshot.player;
   const rawKingdom=player.kid??player.kingdom_id,rawName=player.nick_name||player.name||player.nickname;
   res.status(200).json({data:{
    playerId:String(player.player_id||player.governor_id||player.fid||player.id||id),
    name:typeof rawName==="string"&&rawName.trim()?rawName.trim().slice(0,120):null,
    kingdomId:rawKingdom===undefined||rawKingdom===null||String(rawKingdom)===""?null:String(rawKingdom),
    power:num(player.power),townCenterLevel:num(player.town_center_level??player.tc_level??player.townCenterLevel),
    avatarUrl:avatar(player.avatar_url||player.avatar||player.avatarUrl)
   },meta:{apiVersion:"3",requestId:rid,timestamp:now(),fetchedAt:snapshot.cached_at,source:"mightpulse",stale:snapshot.fresh===false,providerFresh:snapshot.fresh,providerAgeSeconds:snapshot.age_seconds,rateLimit:auth.rateLimit}});
  }catch(error){
   const status=(error as {status?:number}|null)?.status,message=error instanceof Error?error.message:"";
   if(status===404)sendError(res,404,"player_not_found","The player lookup provider could not find this player.",rid,{rateLimit:auth.rateLimit});
   else if(/timed out|timeout|abort/i.test(message))sendError(res,504,"upstream_timeout","The player lookup provider timed out.",rid,{rateLimit:auth.rateLimit});
   else if(/not configured/i.test(message))sendError(res,503,"upstream_not_configured","The player lookup provider is not configured.",rid,{rateLimit:auth.rateLimit});
   else{console.error("[developer-api-v3] player lookup failed",{status});sendError(res,502,"upstream_unavailable","The player lookup provider is temporarily unavailable.",rid,{rateLimit:auth.rateLimit});}
  }
  return;
 }
 const validation=validateV3RedemptionBody(req.body);
 if(!validation.valid){sendError(res,400,validation.code,validation.message,rid,{rateLimit:auth.rateLimit});return;}
 try{
  const result=await redeemKingshot(validation.value);
  if(result.httpStatus===504||result.errorCategory==="TIMEOUT"){sendError(res,504,"upstream_timeout","The redemption provider timed out. Check the outcome before submitting another attempt.",rid,{rateLimit:auth.rateLimit});return;}
  if(result.httpStatus>=500){
   if(/not configured/i.test(String(result.error||"")))sendError(res,503,"upstream_not_configured","The redemption provider is not configured on the server.",rid,{rateLimit:auth.rateLimit});
   else sendError(res,502,"upstream_unavailable","The redemption provider is temporarily unavailable. Do not automatically retry an ambiguous outcome.",rid,{rateLimit:auth.rateLimit});
   return;
  }
  res.status(200).json({data:{ok:Boolean(result.ok),status:result.status||"ERROR",statusLabel:result.statusLabel||null,message:result.message||result.error||"The redemption request completed.",errorCategory:result.errorCategory||null,errCode:result.errCode??null},meta:{apiVersion:"3",requestId:rid,timestamp:now(),rateLimit:auth.rateLimit}});
 }catch(error){console.error("[developer-api-v3] redemption failed",{status:(error as {status?:number}|null)?.status});sendError(res,502,"upstream_unavailable","The redemption provider is temporarily unavailable. Do not automatically retry an ambiguous outcome.",rid,{rateLimit:auth.rateLimit});}
}
