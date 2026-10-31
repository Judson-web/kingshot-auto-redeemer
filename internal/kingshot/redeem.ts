import crypto from "node:crypto";

export interface RedeemKingshotInput { playerId?: unknown; code?: unknown; kid?: unknown; }
export interface RedeemKingshotResult {
  httpStatus: number;
  ok?: boolean;
  status?: string;
  errorCategory?: string;
  statusLabel?: string;
  message?: string;
  error?: string;
  errCode?: unknown;
  upstreamHttpStatus?: number;
  retryAfterSeconds?: number | null;
  upstreamHeaders?: Record<string, string>;
}

const clean=s=>String(s??"").replace(/[^\x20-\x7E]/g,"").trim();
const errorCategories={SUCCESS:"SUCCESS",RECEIVED:"ALREADY_REDEEMED", "SAME TYPE EXCHANGE":"ALREADY_REDEEMED",TIME_ERROR:"EXPIRED",CDK_NOT_FOUND:"INVALID_CODE",USAGE_LIMIT:"USAGE_LIMIT",ROLE_NOT_EXIST:"PLAYER_NOT_FOUND",STATE_MISMATCH:"KINGDOM_MISMATCH",SIGN_ERROR:"UPSTREAM_AUTH",TIMEOUT_RETRY:"RATE_LIMIT",LOGIN_EXPIRED_MID_PROCESS:"UPSTREAM_AUTH"};
const labels={
 SUCCESS:["Redeemed successfully.","Your gift rewards should be available in-game."],
 RECEIVED:["Already claimed.","This account has already redeemed this code."],
 "SAME TYPE EXCHANGE":["Already claimed.","This code was already redeemed for this reward type."],
 TIME_ERROR:["Code expired.","This gift code is no longer valid."],
 CDK_NOT_FOUND:["Code not found.","Check the gift code and try again."],
 USAGE_LIMIT:["Usage limit reached.","This gift code has reached its redemption limit."],
 ROLE_NOT_EXIST:["Player not found.","The Player ID and kingdom could not be resolved."],
 STATE_MISMATCH:["Kingdom mismatch.","The supplied kingdom does not match this player."],
 SIGN_ERROR:["Redemption unavailable.","The upstream signature was rejected."],
 TIMEOUT_RETRY:["Try again shortly.","The gift service is rate-limiting or temporarily unavailable."]
};

const DIAGNOSTIC_HEADERS=["server","via","retry-after","cf-ray","cf-cache-status","x-akamai-transformed","x-cache","x-served-by","x-request-id","traceparent"];
function safeUpstreamHeaders(headers: Headers): Record<string,string> {
 const result: Record<string,string> = {};
 for (const name of DIAGNOSTIC_HEADERS) {
  const value=headers.get(name);
  if(value)result[name]=value.slice(0,160);
 }
 return result;
}
function retryAfterSeconds(value: string | null): number | null {
 if(!value)return null;
 const seconds=Number(value);
 if(Number.isFinite(seconds)&&seconds>=0)return Math.min(3600,Math.ceil(seconds));
 const date=Date.parse(value);
 return Number.isFinite(date)?Math.min(3600,Math.max(0,Math.ceil((date-Date.now())/1000))):null;
}

export function normalizeKingshotStatus(message: unknown, errCode: unknown): string {
 const msg = String(message ?? "Unknown Error").trim().replace(/\\.$/, "").replace(/[._-]+/g, " ").replace(/\\s+/g, " ").toUpperCase();
 const code = String(errCode ?? "").trim();
 if (code === "40014" || ["CDK NOT FOUND", "GIFT CODE NOT FOUND", "CODE NOT FOUND", "INVALID CODE", "INVALID GIFT CODE"].includes(msg)) return "CDK_NOT_FOUND";
 if (msg === "RECEIVED" || (code === "40008" && msg.includes("RECEIVED"))) return "RECEIVED";
 if (msg === "SAME TYPE EXCHANGE" || (code === "40011" && msg.includes("SAME TYPE"))) return "SAME TYPE EXCHANGE";
 if (msg === "TIME ERROR" || code === "40007") return "TIME_ERROR";
 if (msg === "USED" && code === "40005") return "USAGE_LIMIT";
 if (msg === "TOO FREQUENT" || code === "40019") return "TIMEOUT_RETRY";
 if (msg === "NOT LOGIN") return "LOGIN_EXPIRED_MID_PROCESS";
 if (code === "40001" && msg.includes("NOT EXIST")) return "ROLE_NOT_EXIST";
 if (msg === "ROLE NOT EXIST") return "ROLE_NOT_EXIST";
 if (msg === "STATE MISMATCH") return "STATE_MISMATCH";
 if (msg === "SIGN ERROR") return "SIGN_ERROR";
 if (msg === "LOGIN EXPIRED MID PROCESS") return "LOGIN_EXPIRED_MID_PROCESS";
 return msg;
}

function invalidInput(message: string): RedeemKingshotResult {
 return { httpStatus: 400, ok: false, status: "INVALID_INPUT", errorCategory: "INVALID_INPUT", statusLabel: "Check your details.", message, error: message };
}

export async function redeemKingshot({playerId,code,kid}: RedeemKingshotInput): Promise<RedeemKingshotResult> {
 const fid=clean(playerId).replace(/\\D/g,""),giftCode=clean(code),kingdom=clean(kid).replace(/\\D/g,"");
 if(!/^\\d{5,20}$/.test(fid))return invalidInput("Enter a valid Kingshot Player ID (5–20 digits).");
 if(!/^\\d{1,10}$/.test(kingdom))return invalidInput("Could not resolve a valid kingdom for this player.");
 if(!/^[A-Za-z0-9_-]{6,32}$/.test(giftCode))return invalidInput("Gift codes must be 6–32 letters, numbers, underscores, or hyphens.");
 const secret=process.env.KINGSHOT_API_SECRET;
 if(!secret)return {httpStatus:503,error:"Kingshot redemption secret is not configured on the server."};
 const payload={fid,cdk:giftCode,kid:kingdom,time:String(Math.floor(Date.now()/1000))};
 const encoded=Object.keys(payload).sort().map(k=>k+"="+payload[k]).join("&");
 const sign=crypto.createHash("md5").update(encoded+secret).digest("hex");
 try{
  const r=await fetch("https://kingshot-giftcode.centurygame.com/api/gift_code",{
   method:"POST",
   headers:{
    accept:"application/json, text/plain, */*",
    "accept-encoding":"gzip, deflate",
    "accept-language":"en-US,en;q=0.9",
    "content-type":"application/x-www-form-urlencoded",
    origin:"https://kingshot-giftcode.centurygame.com",
    referer:"https://kingshot-giftcode.centurygame.com/",
    "sec-fetch-dest":"empty","sec-fetch-mode":"cors","sec-fetch-site":"same-origin",
    "user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
   },
   body:new URLSearchParams({...payload,sign}),
   signal:AbortSignal.timeout(30000)
  });
  const upstreamHeaders=safeUpstreamHeaders(r.headers);
  const retryAfter=retryAfterSeconds(r.headers.get("retry-after"));
  const diagnosticSuffix=" [upstream_http="+r.status+(retryAfter!==null?"; retry_after_seconds="+retryAfter:"")+(upstreamHeaders.server?"; server="+upstreamHeaders.server:"")+(upstreamHeaders.via?"; via="+upstreamHeaders.via:"")+(upstreamHeaders["cf-ray"]?"; cf_ray_present=true":"")+"]";
  const raw=await r.text();
  let d: { msg?: unknown; err_code?: unknown } = {};
  try{d=JSON.parse(raw)}catch{
   const snippet=raw.replace(/<[^>]*>/g," ").replace(/\\s+/g," ").trim().slice(0,180);
   return {httpStatus:502,status:"ERROR",errorCategory:r.status===429?"HTTP_RATE_LIMIT":"HTTP_NON_JSON",upstreamHttpStatus:r.status,retryAfterSeconds:retryAfter,upstreamHeaders,error:(snippet?"Kingshot returned a non-JSON response: "+snippet:"Kingshot returned an invalid response.")+diagnosticSuffix};
  }
  if([429,502,503,504].includes(r.status)){
   return {httpStatus:503,status:"ERROR",errorCategory:r.status===429?"HTTP_RATE_LIMIT":"HTTP_UPSTREAM_UNAVAILABLE",upstreamHttpStatus:r.status,retryAfterSeconds:retryAfter,upstreamHeaders,error:"Kingshot HTTP "+r.status+" response. "+(r.status===429?"The upstream HTTP layer rate-limited this request.":"The upstream service is temporarily unavailable.")+diagnosticSuffix};
  }
  const msg=String(d.msg||"Unknown Error").replace(/\\.$/,"").toUpperCase();
  const status=normalizeKingshotStatus(d.msg, d.err_code);
  const [statusLabel,message]=labels[status]||[status,"Kingshot returned: "+msg];
  const ok=["SUCCESS","RECEIVED","SAME TYPE EXCHANGE"].includes(status);
  return {httpStatus:ok?200:400,ok,status,errorCategory:errorCategories[status]||"UPSTREAM_ERROR",statusLabel,message,errCode:d.err_code??null,upstreamHttpStatus:r.status,upstreamHeaders};
 }catch(e){
  return {httpStatus:504,status:"ERROR",errorCategory:"TIMEOUT",error:"Kingshot redemption request timed out."};
 }
}
