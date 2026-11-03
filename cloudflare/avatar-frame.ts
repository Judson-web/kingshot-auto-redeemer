import { fetchMightPulseNative } from "./mightpulse.js";
interface Env {
  SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string;
  MIGHTPULSE_API_KEY?: string; MIGHTPULSE_API_KEY_2?: string; MIGHTPULSE_API_KEY_3?: string;
  MIGHTPULSE_API_KEY_4?: string; MIGHTPULSE_API_KEY_5?: string; MIGHTPULSE_API_KEY_6?: string;
}
type Frame = { assetId: string; name: string } | null;
const cache = new Map<string,{frame:Frame;expiresAt:number}>();
const inFlight = new Map<string,Promise<Frame>>();
const imageBuckets = new Map<string,{count:number;resetAt:number}>();
const profileBuckets = new Map<string,{count:number;resetAt:number}>();
const PROFILE_MAX=2_000_000, IMAGE_MAX=500_000, TIMEOUT=5_000;
function err(status:number,code:string,error:string):Response{return Response.json({error,code},{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}
function limited(map:Map<string,{count:number;resetAt:number}>,key:string,max:number):boolean{
 const now=Date.now();let b=map.get(key);if(!b||b.resetAt<=now)b={count:0,resetAt:now+60_000};b.count++;map.set(key,b);
 if(map.size>5000)for(const [k,v] of map)if(v.resetAt<=now)map.delete(k);return b.count>max;
}
function safeJson(r:Response,host:string):boolean{try{const u=new URL(r.url||host);return r.ok&&u.protocol==="https:"&&u.hostname===host&&!u.port&&!u.username&&!u.password&&(r.headers.get("content-type")||"").toLowerCase().includes("application/json")&&!(Number(r.headers.get("content-length")||0)>PROFILE_MAX);}catch{return false;}}
async function boundedText(r:Response,max:number):Promise<string|null>{const t=await r.text();return t.length<=max?t:null;}
function resolveUid(p:any,fid:string):string|null{
 if(!p||typeof p!=="object")return null;
 for(const x of [p,p.player,p.data,p.data?.player,p.data?.data,p.data?.data?.player]){
  if(!x||typeof x!=="object"||Array.isArray(x))continue;
  const id=String(x.fid??x.governor_id??x.governorId??x.player_id??"").trim();
  const uid=String(x.uid??x.profile_uid??x.profile_id??x.internal_uid??x.id??"").trim();
  if(id===fid&&/^\d{1,20}$/.test(uid))return uid;
 }
 for(const rows of [p.results,p.data?.results,p.players,p.data?.players]){
  if(!Array.isArray(rows))continue;const x=rows.find((v:any)=>String(v?.fid??v?.governor_id??v?.governorId??v?.player_id??"").trim()===fid);
  const uid=String(x?.uid??x?.profile_uid??x?.profile_id??x?.id??"").trim();if(/^\d{1,20}$/.test(uid))return uid;
 }return null;
}
function extractFrame(p:any):Frame{
 const x=p?.player&&typeof p.player==="object"?p.player:p;if(!Array.isArray(x?.skins))return null;
 const s=x.skins.find((v:any)=>Number(v?.skintype)===4&&v?.icon);if(!s)return null;
 const name=String(s.name||"Avatar Frame").replace(/<[^>]*>/g,"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,80)||"Avatar Frame";
 const id=String(s.id??"");if(!/^\d{6,12}$/.test(id)||id==="6080010"||name.toLowerCase().includes("starter"))return null;
 try{const u=new URL(String(s.icon).trim(),"https://www.mightpulse.com");const m=/^\/assets\/icons\/skin_icon_(\d{6,12})\.png$/i.exec(u.pathname);
 if(u.protocol!=="https:"||u.hostname!=="www.mightpulse.com"||u.port||u.username||u.password||u.search||u.hash||!m||m[1]!==id)return null;return{assetId:id,name};}catch{return null;}
}
async function publicJson(url:string):Promise<any|null>{
 const r=await fetch(url,{headers:{Accept:"application/json","Accept-Language":"en-US,en;q=0.9","User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",Referer:"https://www.mightpulse.com/"},signal:AbortSignal.timeout(TIMEOUT)});
 if(!safeJson(r,"www.mightpulse.com"))return null;const t=await boundedText(r,PROFILE_MAX);return t?JSON.parse(t):null;
}
async function getFrame(env:Env,id:string,refresh:boolean):Promise<Frame>{
 if(refresh)cache.delete(id);const c=cache.get(id);if(c&&c.expiresAt>Date.now())return c.frame;
 const active=inFlight.get(id);if(active)return active;
 const p=(async()=>{let frame:Frame=null,ttl=60_000;try{
  let uid:string|null=null;const hasKey=[env.MIGHTPULSE_API_KEY_6,env.MIGHTPULSE_API_KEY_5,env.MIGHTPULSE_API_KEY_4,env.MIGHTPULSE_API_KEY_3,env.MIGHTPULSE_API_KEY_2,env.MIGHTPULSE_API_KEY].some(v=>Boolean(String(v||"").trim()));
  if(hasKey)try{const endpoint="https://api.mightpulse.com/v1/players/"+encodeURIComponent(id)+"?include=base";const r=await fetchMightPulseNative(env,endpoint,TIMEOUT);if(safeJson(r,"api.mightpulse.com")){const t=await boundedText(r,PROFILE_MAX);if(t)uid=resolveUid(JSON.parse(t),id);}}catch{}
  if(!uid)try{const p=await publicJson("https://www.mightpulse.com/api/search?q="+encodeURIComponent(id)+"&limit=40&live=0");if(p)uid=resolveUid(p,id);}catch{}
  if(!uid)ttl=120_000;else{const p=await publicJson("https://www.mightpulse.com/api/players/"+uid);if(p){const n=p.player&&typeof p.player==="object"?p.player:{};const puid=String(p.uid??n.uid??"").trim();const fid=String(p.fid??p.governor_id??n.fid??n.governor_id??"").trim();if(puid===uid&&fid===id)frame=extractFrame(p);ttl=frame?3_600_000:300_000;}}
 }catch{ttl=60_000;}cache.set(id,{frame,expiresAt:Date.now()+ttl});return frame;})();
 inFlight.set(id,p);try{return await p;}finally{inFlight.delete(id);}
}
async function serveImage(id:string,request:Request):Promise<Response>{
 const ip=request.headers.get("CF-Connecting-IP")||"unknown";if(limited(imageBuckets,ip,120))return new Response(null,{status:429,headers:{"Retry-After":"60","Cache-Control":"no-store"}});
 try{const r=await fetch("https://www.mightpulse.com/assets/icons/skin_icon_"+id+".png",{headers:{Accept:"image/png"},signal:AbortSignal.timeout(TIMEOUT)});
 if(!r.ok||Number(r.headers.get("content-length")||0)>IMAGE_MAX||!/^image\/png(?:;|$)/i.test(r.headers.get("content-type")||""))return new Response(null,{status:404,headers:{"Cache-Control":"public, max-age=300"}});
 const b=await r.arrayBuffer();if(!b.byteLength||b.byteLength>IMAGE_MAX)return new Response(null,{status:404,headers:{"Cache-Control":"public, max-age=300"}});
 return new Response(b,{headers:{"Content-Type":"image/png","Content-Length":String(b.byteLength),"Cache-Control":"public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Cross-Origin-Resource-Policy":"same-origin"}});
 }catch{return new Response(null,{status:404,headers:{"Cache-Control":"no-store"}});}
}
export async function handleNativeAvatarFrame(request:Request,env:Env):Promise<Response>{
 if(request.method!=="GET")return err(405,"method_not_allowed","Method not allowed.");const u=new URL(request.url),mode=u.searchParams.get("frame");
 if(mode==="asset"){const id=u.searchParams.get("asset")||"";if(!/^\d{6,12}$/.test(id))return err(400,"invalid_frame_asset","Invalid frame asset.");return serveImage(id,request);}
 if(mode!=="profile")return err(400,"invalid_frame_request","Invalid frame request.");
 const ip=request.headers.get("CF-Connecting-IP")||"unknown";if(limited(profileBuckets,ip,30))return err(429,"rate_limit_exceeded","Too many frame lookups. Retry shortly.");
 const id=(u.searchParams.get("id")||"").trim();if(!/^\d{5,20}$/.test(id))return err(400,"invalid_player_id","Player ID must contain 5–20 digits.");
 const frame=await getFrame(env,id,u.searchParams.get("refresh")==="1");return Response.json({frame},{headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Cross-Origin-Resource-Policy":"same-origin","X-Edge-Backend":"cloudflare-mightpulse"}});
}
