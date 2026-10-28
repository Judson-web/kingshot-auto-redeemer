import crypto from "node:crypto";
import { rateLimit } from "./request-rate-limit.js";
import { isDiscordOwner, verifiedDiscordId } from "./discord-identity.js";
import { fetchDiscordUser } from "./discord-user.js";

type Req = { method?: string; headers: Record<string,string|string[]|undefined>; body?: Record<string,unknown> };
type Res = { status(n:number):Res; json(v:unknown):Res; setHeader(k:string,v:string|string[]):void };
const SUPABASE_URL = process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const AUTH_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || KEY;
const COOKIE = "__Host-ks_developer_session";
const OWNER_COOKIE = "__Host-ks_owner_session";
const PROFILE_COOKIE = "__Host-ks_profile_session";
const OWNER_DISCORD_ID = "871756466900598815";
const sha = (v:string) => crypto.createHash("sha256").update(v).digest("hex");
const random = () => crypto.randomBytes(32).toString("hex");
const get = (req:Req,n:string) => { const v=req.headers[n.toLowerCase()]??req.headers[n]; return Array.isArray(v)?v[0]:v; };
function cookieValue(req:Req,name:string){const raw=String(get(req,"cookie")||"");const p=raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="));if(!p)return "";try{return decodeURIComponent(p.slice(name.length+1))}catch{return ""}}
function session(req:Req){return cookieValue(req,COOKIE)}
function ownerSession(req:Req){return cookieValue(req,OWNER_COOKIE)}
function profileSession(req:Req){return cookieValue(req,PROFILE_COOKIE)}
function setProfileCookie(res:Res,v:string,age=5184000){res.setHeader("Set-Cookie",PROFILE_COOKIE+"="+encodeURIComponent(v)+"; Max-Age="+age+"; Path=/; HttpOnly; Secure; SameSite=Strict")}
function clearProfileCookie(res:Res){res.setHeader("Set-Cookie",PROFILE_COOKIE+"=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict")}
function clearAllSessionCookies(res:Res){res.setHeader("Set-Cookie",[
 COOKIE+"=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict",
 OWNER_COOKIE+"=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict",
 PROFILE_COOKIE+"=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict",
 ])}
function setOwnerCookie(res:Res,v:string,age=5184000){res.setHeader("Set-Cookie",OWNER_COOKIE+"="+encodeURIComponent(v)+"; Max-Age="+age+"; Path=/; HttpOnly; Secure; SameSite=Strict")}
function clearOwnerCookie(res:Res){res.setHeader("Set-Cookie",OWNER_COOKIE+"=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict")}
function providersOf(user:any){return Array.isArray(user?.app_metadata?.providers)?user.app_metadata.providers:[]}
function hasProvider(user:any,provider:string){return providersOf(user).includes(provider)||(Array.isArray(user?.identities)&&user.identities.some((identity:any)=>identity?.provider===provider))}
function discordIdOf(user:any){return verifiedDiscordId(user)}
function roleOf(user:any){return isDiscordOwner(user,OWNER_DISCORD_ID)?"admin":"developer"}
function isOwner(user:any){return roleOf(user)==="admin"}
async function ownerFromSession(req:Req){const token=ownerSession(req);if(!token)return null;const userId=await rpc("kingshot_developer_account_session_get",{p_token_hash:sha(token)});if(typeof userId!=="string"||!userId)return null;if(!KEY)return null;const r=await fetch(SUPABASE_URL+"/auth/v1/admin/users/"+encodeURIComponent(userId),{headers:{apikey:KEY,authorization:"Bearer "+KEY},signal:AbortSignal.timeout(8000)});const d:any=await r.json().catch(()=>null);if(!r.ok||!isOwner(d))return null;return {email:d.email,user_name:d?.user_metadata?.user_name||d?.user_metadata?.preferred_username||"Judson-web"}}
function setCookie(res:Res,v:string,age:number){res.setHeader("Set-Cookie",COOKIE+"="+encodeURIComponent(v)+"; Max-Age="+age+"; Path=/; HttpOnly; Secure; SameSite=Strict")}
function clearCookie(res:Res){res.setHeader("Set-Cookie",COOKIE+"=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict")}
async function rpc(name:string,body:Record<string,unknown>){if(!KEY)throw new Error("Auth service is not configured");const r=await fetch(SUPABASE_URL+"/rest/v1/rpc/"+name,{method:"POST",headers:{apikey:KEY,authorization:"Bearer "+KEY,"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});const d:any=await r.json().catch(()=>null);if(!r.ok)throw new Error(d?.message||"Account service unavailable");return d}
async function authUser(accessToken:string){const r=await fetch(SUPABASE_URL+"/auth/v1/user",{headers:{apikey:AUTH_KEY||"",authorization:"Bearer "+accessToken},signal:AbortSignal.timeout(8000)});const d:any=await r.json().catch(()=>null);if(!r.ok||!d?.id){const e=new Error("Discord sign-in could not be verified. Check that Discord is enabled in Supabase Auth and try again.") as Error&{status?:number};e.status=r.status===429?429:401;throw e}return d}
const discordProfileCache = new Map<string,{expiresAt:number;profile:any}>();
const discordProfileInFlight = new Map<string,Promise<any>>();
async function liveDiscordProfile(id:string){
 if(!id||!process.env.DISCORD_BOT_TOKEN)return null;
 const cached=discordProfileCache.get(id);
 if(cached&&cached.expiresAt>Date.now())return cached.profile;
 const pending=discordProfileInFlight.get(id);
 if(pending)return pending;
 const request=fetchDiscordUser(id).then(profile=>{
  discordProfileCache.set(id,{profile,expiresAt:Date.now()+20000});
  return profile;
 }).finally(()=>discordProfileInFlight.delete(id));
 discordProfileInFlight.set(id,request);
 try{return await request}catch{return null}
}
async function publicProfile(user:any,role="user",kind=role){
 const metadata=user?.user_metadata||{};
 const verifiedId=discordIdOf(user);
 const latest=await liveDiscordProfile(verifiedId||"");
 const displayName=latest?.globalName||latest?.username||metadata.global_name||metadata.full_name||metadata.name||metadata.user_name||metadata.preferred_username||user?.email||"Discord user";
 return {
  email:user?.email||null,
  username:displayName,
  display_name:displayName,
  discord_username:latest?.username||metadata.user_name||metadata.preferred_username||null,
  global_name:latest?.globalName||metadata.global_name||metadata.full_name||null,
  avatar_url:latest?.avatarUrl||metadata.avatar_url||null,
  discord_id:latest?.id||verifiedId||null,
  discord_profile_fetched_at:latest?.fetchedAt||null,
  provider:"discord",
  providers:providersOf(user),
  providerIds:(Array.isArray(user?.identities)?user.identities:[]).map((identity:any)=>identity?.provider).filter(Boolean),
  kind,role
 };
}
async function logoutEverywhere(req:Req,res:Res){
 // Clear browser-side credentials first, even if a downstream revocation call fails.
 clearAllSessionCookies(res);
 const rawTokens=[session(req),ownerSession(req),profileSession(req)].filter(Boolean);
 const uniqueTokens=[...new Set(rawTokens)];
 const jobs:Promise<unknown>[] = uniqueTokens.map(token=>rpc("kingshot_developer_account_session_delete",{p_token_hash:sha(token)}));
 const ownerToken=ownerSession(req);
 if(ownerToken)jobs.push(rpc("kingshot_admin_delete_discord_session",{p_token_hash:sha(ownerToken)}));
 const accessToken=String(req.body?.access_token||"");
 if(accessToken&&accessToken.length<=8192&&AUTH_KEY){
  jobs.push((async()=>{
   const response=await fetch(SUPABASE_URL+"/auth/v1/logout",{method:"POST",headers:{apikey:AUTH_KEY,authorization:"Bearer "+accessToken},signal:AbortSignal.timeout(8000)});
   // An expired token is already unusable; all other provider-side failures are surfaced.
   if(!response.ok&&response.status!==401&&response.status!==403)throw new Error("Supabase Auth logout could not be confirmed.");
  })());
 }
 const results=await Promise.allSettled(jobs);
 if(results.some(result=>result.status==="rejected")){
  res.status(503).json({ok:false,error:"This browser's session cookies were cleared, but server-side logout could not be fully confirmed. Try signing out again."});
  return;
 }
 res.status(200).json({ok:true});
}
export default async function handler(req:Req,res:Res){res.setHeader("Cache-Control","private, no-store");res.setHeader("X-Content-Type-Options","nosniff");if(!["GET","POST","DELETE"].includes(String(req.method))){res.status(405).json({error:"Method not allowed"});return}try{
 if(req.method==="GET"){const token=session(req);if(!token){res.status(200).json({authenticated:false,role:"guest",kind:"user"});return}const sessionHash=sha(token);const userId=await rpc("kingshot_developer_account_session_get",{p_token_hash:sessionHash});if(typeof userId!=="string"||!userId){clearCookie(res);res.status(200).json({authenticated:false,role:"guest",kind:"user"});return}if(!KEY){clearCookie(res);res.status(503).json({error:"Developer role service is not configured."});return}const r=await fetch(SUPABASE_URL+"/auth/v1/admin/users/"+encodeURIComponent(userId),{headers:{apikey:KEY,authorization:"Bearer "+KEY},signal:AbortSignal.timeout(8000)});const user:any=await r.json().catch(()=>null);if(!r.ok||!hasProvider(user,"discord")){clearCookie(res);res.status(200).json({authenticated:false,role:"guest",kind:"user"});return}const role=roleOf(user);let activeKeyCount=0;if(role!=="admin"){try{const rows=await rpc("kingshot_developer_account_list_keys",{p_session_hash:sessionHash});if(Array.isArray(rows))activeKeyCount=rows.filter((key:any)=>key&&key.revoked_at==null).length}catch(e){console.error("[developer-auth] developer role lookup failed",e instanceof Error?e.message:"unknown error");res.status(503).json({error:"Could not verify developer access. Please retry."});return}if(activeKeyCount===0){await rpc("kingshot_developer_account_session_delete",{p_token_hash:sessionHash}).catch(()=>{});clearCookie(res);res.status(200).json({authenticated:false,role:"guest",kind:"user",activeKeyCount:0});return}}res.status(200).json({authenticated:true,role,kind:role==="admin"?"admin":"developer",activeKeyCount,user:await publicProfile(user,role,role==="admin"?"admin":"developer")});return}
 if(req.method==="DELETE"){await logoutEverywhere(req,res);return}
 const action=String(req.body?.action||"");
  const protectedAuthActions=new Set(["profile-link-url","profile-link-complete","developer-enroll","profile-oauth","dev-verify","oauth","oauth-url","dev-oauth-url","dev-discord-oauth-url","discord-oauth-url","site-discord-oauth-url","profile-discord-url"]);
  if(protectedAuthActions.has(action)&&!rateLimit(req,res,"developer-account-auth:"+action,8,900000)){res.status(429).json({error:"Too many attempts. Try again in 15 minutes."});return}
 if(action==="profile-link-url"){const accessToken=String(req.body?.access_token||"");const provider=String(req.body?.provider||"");if(provider!=="discord"||!accessToken||accessToken.length>8192){res.status(400).json({error:"Only Discord identity linking is supported."});return}const current=await authUser(accessToken);const currentSession=profileSession(req);if(!currentSession){res.status(401).json({error:"Sign in to your profile again before linking an account."});return}const currentId=await rpc("kingshot_developer_account_session_get",{p_token_hash:sha(currentSession)});if(currentId!==current.id){res.status(403).json({error:"This sign-in token does not match your current profile. Sign in again and retry."});return}if(hasProvider(current,provider)){res.status(409).json({error:"This profile is already linked to "+provider+"."});return}const redirectTo="https://kingshot-autoredeemer.vercel.app/profile?link="+provider;const endpoint=SUPABASE_URL+"/auth/v1/user/identities/authorize?provider="+provider+"&redirect_to="+encodeURIComponent(redirectTo);const r=await fetch(endpoint,{method:"POST",headers:{apikey:AUTH_KEY||"",authorization:"Bearer "+accessToken,"content-type":"application/json"},body:JSON.stringify({redirect_to:redirectTo}),signal:AbortSignal.timeout(8000)});const d:any=await r.json().catch(()=>null);if(!r.ok||!d?.url){res.status(r.status===429?429:400).json({error:d?.msg||d?.message||"Could not start secure account linking. Please sign in again and retry."});return}res.status(200).json({url:d.url,provider});return}
 if(action==="profile-link-complete"){const accessToken=String(req.body?.access_token||"");const provider=String(req.body?.provider||"");if(provider!=="discord"||!accessToken){res.status(400).json({error:"Only Discord identity linking is supported."});return}const user=await authUser(accessToken);const currentSession=profileSession(req);const currentId=currentSession?await rpc("kingshot_developer_account_session_get",{p_token_hash:sha(currentSession)}):null;if(!currentId||currentId!==user.id){res.status(403).json({error:"The linked identity did not return to the same account. Sign in again before linking."});return}if(!hasProvider(user,provider)){res.status(403).json({error:"Supabase did not confirm the linked "+provider+" identity."});return}res.status(200).json({ok:true,role:"user",user:await publicProfile(user,"user","user")});return}
 if(action==="developer-enroll"){const profileToken=profileSession(req);if(!profileToken){res.status(401).json({error:"Sign in to your profile with Discord before creating your first API key."});return}const userId=await rpc("kingshot_developer_account_session_get",{p_token_hash:sha(profileToken)});if(typeof userId!=="string"||!userId){clearProfileCookie(res);res.status(401).json({error:"Your profile session has expired. Sign in again."});return}if(!KEY){res.status(503).json({error:"Developer account service is not configured."});return}const response=await fetch(SUPABASE_URL+"/auth/v1/admin/users/"+encodeURIComponent(userId),{headers:{apikey:KEY,authorization:"Bearer "+KEY},signal:AbortSignal.timeout(8000)});const user:any=await response.json().catch(()=>null);if(!response.ok||!hasProvider(user,"discord")){res.status(403).json({error:"A verified Discord profile is required to enable developer access."});return}const token=random();const created=await rpc("kingshot_developer_account_session_create",{p_token_hash:sha(token),p_user_id:userId});if(created!==true){res.status(403).json({error:"Could not enable developer access for this profile."});return}setCookie(res,token,5184000);res.status(200).json({ok:true,role:roleOf(user),user:{email:user.email||null,username:user.user_metadata?.user_name||user.user_metadata?.preferred_username||user.email}});return}
 if(action==="profile-check"){const token=profileSession(req);if(!token){const devToken=session(req);if(devToken){const devHash=sha(devToken);const devUserId=await rpc("kingshot_developer_account_session_get",{p_token_hash:devHash});if(typeof devUserId==="string"&&devUserId&&KEY){const ur=await fetch(SUPABASE_URL+"/auth/v1/admin/users/"+encodeURIComponent(devUserId),{headers:{apikey:KEY,authorization:"Bearer "+KEY},signal:AbortSignal.timeout(8000)});const du:any=await ur.json().catch(()=>null);if(ur.ok&&hasProvider(du,"discord")){const admin=isOwner(du);let n=0;if(!admin){const rows=await rpc("kingshot_developer_account_list_keys",{p_session_hash:devHash});if(Array.isArray(rows))n=rows.filter((key:any)=>key&&key.revoked_at==null).length}if(admin||n>0){const role=admin?"admin":"developer";res.status(200).json({authenticated:true,role,kind:role,activeKeyCount:n,user:await publicProfile(du,role,role)});return}}}}res.status(200).json({authenticated:false,role:"user",kind:"user"});return}const sessionHash=sha(token);const userId=await rpc("kingshot_developer_account_session_get",{p_token_hash:sessionHash});if(typeof userId!=="string"||!userId){clearProfileCookie(res);res.status(200).json({authenticated:false,role:"user",kind:"user"});return}if(!KEY){res.status(503).json({error:"Account role service is not configured."});return}const r=await fetch(SUPABASE_URL+"/auth/v1/admin/users/"+encodeURIComponent(userId),{headers:{apikey:KEY,authorization:"Bearer "+KEY},signal:AbortSignal.timeout(8000)});const user:any=await r.json().catch(()=>null);if(!r.ok||!hasProvider(user,"discord")){clearProfileCookie(res);res.status(200).json({authenticated:false,role:"user",kind:"user"});return}let activeKeyCount=0;try{const rows=await rpc("kingshot_developer_account_list_keys",{p_session_hash:sessionHash});if(Array.isArray(rows))activeKeyCount=rows.filter((key:any)=>key&&key.revoked_at==null).length}catch(e){console.error("[developer-auth] profile role lookup failed",e instanceof Error?e.message:"unknown error");res.status(503).json({error:"Could not verify developer access. Please retry."});return}const admin=isOwner(user);const role=admin?"admin":activeKeyCount>0?"developer":"user";res.status(200).json({authenticated:true,role,kind:role,activeKeyCount,user:await publicProfile(user,role,role)});return}
 if(action==="profile-logout"){await logoutEverywhere(req,res);return}
 if(action==="profile-oauth"){const accessToken=String(req.body?.access_token||"");const provider=String(req.body?.provider||"");if(provider!=="discord"||!accessToken||accessToken.length>8192){res.status(400).json({error:"Sign in with Discord only."});return}const user=await authUser(accessToken);if(!hasProvider(user,"discord")){res.status(403).json({error:"Discord identity was not confirmed by Supabase. Ensure Discord is enabled as an Auth provider."});return}const token=random();const created=await rpc("kingshot_developer_account_session_create",{p_token_hash:sha(token),p_user_id:user.id});if(created!==true){res.status(403).json({error:"Could not establish your profile session. Verify the account is enabled in Supabase."});return}setProfileCookie(res,token,5184000);let activeKeyCount=0;try{const rows=await rpc("kingshot_developer_account_list_keys",{p_session_hash:sha(token)});if(Array.isArray(rows))activeKeyCount=rows.filter((key:any)=>key&&key.revoked_at==null).length}catch(e){console.error("[developer-auth] post-login role lookup failed",e instanceof Error?e.message:"unknown error");res.status(503).json({error:"Signed in, but account access could not be verified. Refresh the page to retry."});return}const role=isOwner(user)?"admin":activeKeyCount>0?"developer":"user";res.status(200).json({ok:true,role,kind:role,activeKeyCount,user:await publicProfile(user,role,role)});return}
 if(action==="dev-check"){let user=await ownerFromSession(req);if(user){res.status(200).json({authenticated:true,user});return}const profileToken=profileSession(req);if(profileToken&&KEY){const userId=await rpc("kingshot_developer_account_session_get",{p_token_hash:sha(profileToken)});if(typeof userId==="string"&&userId){const r=await fetch(SUPABASE_URL+"/auth/v1/admin/users/"+encodeURIComponent(userId),{headers:{apikey:KEY,authorization:"Bearer "+KEY},signal:AbortSignal.timeout(8000)});const existing:any=await r.json().catch(()=>null);if(r.ok&&isOwner(existing)){const token=random();const created=await rpc("kingshot_developer_account_session_create",{p_token_hash:sha(token),p_user_id:userId});if(created===true){setOwnerCookie(res,token);user={email:existing.email,user_name:existing?.user_metadata?.user_name||existing?.user_metadata?.preferred_username||"Judson-web"};res.status(200).json({authenticated:true,user});return}}}}clearOwnerCookie(res);res.status(200).json({authenticated:false});return}
 if(action==="dev-logout"){await logoutEverywhere(req,res);return}
 if(action==="oauth-url"||action==="dev-oauth-url"||action==="dev-discord-oauth-url"||action==="discord-oauth-url"||action==="site-discord-oauth-url"||action==="profile-discord-url"){if(!AUTH_KEY){res.status(503).json({error:"Discord sign-in is not configured. Enable Discord under Supabase Authentication providers."});return}const destination=action==="dev-oauth-url"||action==="dev-discord-oauth-url"?"https://kingshot-autoredeemer.vercel.app/dev?provider=discord":action==="site-discord-oauth-url"||action==="profile-discord-url"?"https://kingshot-autoredeemer.vercel.app/profile?provider=discord":"https://kingshot-autoredeemer.vercel.app/developer?provider=discord";const url=SUPABASE_URL+"/auth/v1/authorize?provider=discord&redirect_to="+encodeURIComponent(destination)+"&apikey="+encodeURIComponent(AUTH_KEY);res.status(200).json({url,provider:"discord"});return}
 if(action==="dev-verify"){const accessToken=String(req.body?.access_token||"");if(!accessToken||accessToken.length>8192){res.status(400).json({error:"Missing or invalid Discord session token."});return}const user=await authUser(accessToken);if(!isOwner(user)){res.status(403).json({error:"This developer hub is restricted to its owner."});return}const token=random();const created=await rpc("kingshot_developer_account_session_create",{p_token_hash:sha(token),p_user_id:user.id});if(created!==true){res.status(403).json({error:"Could not establish the owner session. Confirm the Discord account is enabled in Supabase."});return}setOwnerCookie(res,token);res.status(200).json({ok:true,user:{email:user.email,user_name:user?.user_metadata?.user_name||user?.user_metadata?.preferred_username||"Judson-web"}});return}
  if(action==="oauth"){const accessToken=String(req.body?.access_token||"");const provider=String(req.body?.provider||"discord");if(provider!=="discord"){res.status(400).json({error:"Only Discord sign-in is supported."});return}if(!accessToken||accessToken.length>8192){res.status(400).json({error:"Missing or invalid Discord session token."});return}const user=await authUser(accessToken);if(!hasProvider(user,"discord")){res.status(403).json({error:"Discord identity was not confirmed by Supabase. Ensure Discord is enabled as an Auth provider."});return}const token=random();const ok=await rpc("kingshot_developer_account_session_create",{p_token_hash:sha(token),p_user_id:user.id});if(ok!==true){res.status(403).json({error:"Could not establish a developer session for this Discord account."});return}setCookie(res,token,5184000);res.status(200).json({ok:true,role:roleOf(user),provider:"discord"});return}
 res.status(400).json({error:"Only Discord OAuth sign-in is supported for developer accounts."});return;
 }catch(e){const err=e as Error&{status?:number};const status=err.status===400||err.status===422?400:err.status===429?429:err.status===403?403:500;res.status(status).json({error:status===500?"Developer account service is temporarily unavailable.":err.message})}}

/** Validate the profile's server-side Discord session for protected alliance tools. */
export async function isAuthenticatedProfileRequest(req: { headers: Record<string, string | string[] | undefined> }): Promise<boolean> {
 try {
  const token = cookieValue(req as Req, PROFILE_COOKIE);
  if (!token || !KEY) return false;
  const userId = await rpc("kingshot_developer_account_session_get", { p_token_hash: sha(token) });
  if (typeof userId !== "string" || !userId) return false;
  const response = await fetch(SUPABASE_URL + "/auth/v1/admin/users/" + encodeURIComponent(userId), {
   headers: { apikey: KEY, authorization: "Bearer " + KEY },
   signal: AbortSignal.timeout(8000)
  });
  const user: any = await response.json().catch(() => null);
  return Boolean(response.ok && hasProvider(user, "discord"));
 } catch { return false; }
}
