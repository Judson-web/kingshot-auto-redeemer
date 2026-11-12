import { fetchMightPulseNative, mightPulsePlayerErrorStatus } from "./mightpulse.js";
import { handleNativeAvatarFrame } from "./avatar-frame.js";
import { handleNativeRegistration } from "./registration.js";
import { handleNativeRedemption } from "./redemption.js";
import { handleNativeV4 } from "./developer-v4.js";
import { handleNativeDeveloperAccount } from "./developer-account.js";
import { handleWebhookDeliveryDispatch } from "./webhook-delivery.js";
import { dispatchLegacyApi } from "./legacy-api-adapter.js";

interface Env {
  ASSETS: Fetcher;
  SUPABASE_WRITE_MODE?: string;
  PUBLIC_APP_URL?: string;
  V4_WEBHOOK_ENCRYPTION_KEY?: string;
  V4_WEBHOOK_WORKER_SECRET?: string;
  CRON_SECRET?: string;
  SHARD_WORKER?: { fetch(request: Request): Promise<Response> };
  EGRESS?: Fetcher;
  NEON_RECOVERY_DATABASE_URL?: string;
  SUPABASE_URL?: string;
  SECONDARY_SUPABASE_URL?: string;
  SECONDARY_SUPABASE_SERVICE_ROLE_KEY?: string;
  SECONDARY_REDEMPTION_ENABLED?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  DISCORD_BOT_TOKEN?: string;
  MIGHTPULSE_API_KEY?: string;
  MIGHTPULSE_API_KEY_2?: string;
  MIGHTPULSE_API_KEY_3?: string;
  MIGHTPULSE_API_KEY_4?: string;
  MIGHTPULSE_API_KEY_5?: string;
  MIGHTPULSE_API_KEY_6?: string;
}

const API_PREFIX = "/api";
const visitorBuckets = new Map<string, { count: number; resetAt: number }>();

function clean(value: unknown, max = 180): string | null {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) || null
    : null;
}

function classifyAgent(ua: string | null) {
  const value = ua || "";
  let browser = "Other";
  if (/Edg\//i.test(value)) browser = "Edge";
  else if (/OPR\//i.test(value)) browser = "Opera";
  else if (/SamsungBrowser\//i.test(value)) browser = "Samsung Internet";
  else if (/Firefox\//i.test(value)) browser = "Firefox";
  else if (/CriOS\//i.test(value)) browser = "Chrome (iOS)";
  else if (/Chrome\//i.test(value)) browser = "Chrome";
  else if (/FxiOS\//i.test(value)) browser = "Firefox (iOS)";
  else if (/Safari\//i.test(value) && !/Chrome\//i.test(value)) browser = "Safari";
  let operating_system = "Other";
  if (/Android/i.test(value)) operating_system = "Android";
  else if (/iPhone|iPad|iPod/i.test(value)) operating_system = "iOS";
  else if (/Windows/i.test(value)) operating_system = "Windows";
  else if (/Mac OS X|Macintosh/i.test(value)) operating_system = "macOS";
  else if (/Linux/i.test(value)) operating_system = "Linux";
  const device_type = /bot|crawler|spider|slurp|headless/i.test(value) ? "bot"
    : /iPad|Tablet/i.test(value) ? "tablet"
    : /Mobile|Android|iPhone|iPod/i.test(value) ? "mobile" : "desktop";
  return { browser, operating_system, device_type };
}

const registrationStatusBuckets = new Map<string, { count: number; resetAt: number }>();

async function handleRegistrationStatus(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "Method not allowed." }), {
    status: 405, headers: { Allow: "GET", "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return jsonError(503, "registration_status_unavailable",
    "Registration status is temporarily unavailable. No members were made selectable.");
  const params = new URL(request.url).searchParams;
  const rawIds = (params.get("ids") || "").split(",").map(value => value.trim()).filter(Boolean);
  const uniqueIds = [...new Set(rawIds)];
  const ids = uniqueIds.filter(id => /^\d{5,20}$/.test(id)).slice(0, 200);
  if (!ids.length || ids.length !== uniqueIds.length || uniqueIds.length > 200) {
    return jsonError(400, "invalid_player_ids", "Provide up to 200 valid Player IDs.");
  }
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  let bucket = registrationStatusBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + 60_000 };
  bucket.count++;
  registrationStatusBuckets.set(ip, bucket);
  if (registrationStatusBuckets.size > 5000) {
    for (const [key, value] of registrationStatusBuckets) if (value.resetAt <= now) registrationStatusBuckets.delete(key);
  }
  if (bucket.count > 20) return new Response(JSON.stringify({
    error: "Too many alliance lookups. Please wait before trying again.", code: "rate_limit_exceeded",
  }), { status: 429, headers: {
    "Content-Type": "application/json", "Cache-Control": "no-store",
    "Retry-After": String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
    "X-RateLimit-Limit": "20", "X-RateLimit-Remaining": "0",
  } });
  const base = String(env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co").replace(/\/$/, "");
  const query = new URLSearchParams({ select: "player_id", player_id: "in.(" + ids.join(",") + ")" });
  try {
    const response = await fetch(base + "/rest/v1/kingshot_autoredeem?" + query.toString(), {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return jsonError(503, "registration_status_unavailable",
      "Could not verify existing registrations. Please refresh and try again.");
    const rows: unknown = await response.json().catch(() => null);
    if (!Array.isArray(rows)) return jsonError(503, "registration_status_unavailable",
      "Could not verify existing registrations. Please refresh and try again.");
    const registeredIds = [...new Set(rows.map((row: Record<string, unknown>) =>
      String(row.player_id || "")).filter(id => ids.includes(id)))];
    return Response.json({ registeredIds }, { headers: {
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "X-Edge-Backend": "cloudflare-supabase",
    } });
  } catch {
    return jsonError(503, "registration_status_unavailable",
      "Could not verify existing registrations. Please refresh and try again.");
  }
}



const playerLookupBuckets = new Map<string, { count: number; resetAt: number }>();


const detailedProfileCache = new Map<string, { value: Record<string, unknown>; expiresAt: number }>();
const detailedProfileInFlight = new Map<string, Promise<Record<string, unknown>>>();

function playerIdOf(player: Record<string, unknown>): string {
  return String(player.governor_id ?? player.fid ?? player.player_id ?? "");
}
function normalizeNativePlayer(player: Record<string, any>): Record<string, any> {
  const existing = player.alliance && typeof player.alliance === "object" && !Array.isArray(player.alliance)
    ? player.alliance : {};
  const abbr = [existing.abbr, existing.tag, existing.abbreviation, existing.short_name, existing.shortName,
    player.alliance_abbr, player.allianceAbbr, player.alliance_tag, player.allianceTag]
    .map(value => typeof value === "string" ? value.trim() : "").find(Boolean) || "";
  const name = [existing.name, existing.alliance_name, player.alliance_name, player.allianceName,
    typeof player.alliance === "string" ? player.alliance : "", player.guild_name]
    .map(value => typeof value === "string" ? value.trim() : "").find(Boolean) || "";
  if (!abbr && !name) return player;
  return { ...player, alliance: { ...existing, ...(abbr ? { abbr } : {}), ...(name ? { name } : {}) } };
}
function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}
async function mightPulseJson(env: Env, url: string, timeoutMs: number, options: { totalTimeoutMs?: number; maxAttempts?: number } = {}): Promise<Record<string, any>> {
  const response = await fetchMightPulseNative(env, url, timeoutMs, options);
  const body = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw Object.assign(new Error("MightPulse enrichment unavailable."), { status: response.status });
  return body;
}
async function loadNativePlayerContext(env: Env, player: Record<string, any>): Promise<Record<string, unknown>> {
  const kid = String(player.kid ?? player.kingdom_id ?? "").trim();
  const allianceObject = player.alliance && typeof player.alliance === "object" && !Array.isArray(player.alliance) ? player.alliance : {};
  const allianceTag = String(player.alliance_tag ?? player.allianceTag ?? player.alliance_abbr ?? player.allianceAbbr ?? allianceObject.abbr ?? allianceObject.tag ?? allianceObject.abbreviation ?? allianceObject.short_name ?? allianceObject.shortName ?? "").replace(/^\\[|\\]$/g, "").trim().slice(0,32);
  const allianceName = String(player.alliance_name ?? player.allianceName ?? allianceObject.name ?? (typeof player.alliance === "string" ? player.alliance : "") ?? player.guild_name ?? "").trim().slice(0,100);
  const validKingdom = /^\d{1,10}$/.test(kid);
  const kingdomPromise = validKingdom
    ? mightPulseJson(env, "https://api.mightpulse.com/v1/kingdoms/" + encodeURIComponent(kid) + "?include=boards&limit=100", 4500)
    : Promise.resolve(null);
  const ranksPromise = validKingdom
    ? mightPulseJson(env, "https://api.mightpulse.com/v1/kingdoms/" + encodeURIComponent(kid) + "/ranks?limit=100", 4500)
    : Promise.resolve(null);
  const alliancePromise = validKingdom && /^[A-Za-z0-9_-]{1,20}$/.test(allianceTag)
    ? mightPulseJson(env, "https://api.mightpulse.com/v1/alliances/" + encodeURIComponent(kid) + "/" + encodeURIComponent(allianceTag) + "?include=info,roster", 5000)
    : Promise.resolve(null);
  const [kingdomResult, ranksResult, allianceResult] = await Promise.allSettled([kingdomPromise, ranksPromise, alliancePromise]);
  const boardRanks: Array<{board:string;rank:number|null;score:number|null}> = [];
  const ids = new Set([playerIdOf(player), String(player.uid ?? "")].filter(Boolean));
  const visit = (value: any, label = "", depth = 0): void => {
    if (!value || typeof value !== "object" || depth > 7) return;
    if (Array.isArray(value)) {
      value.forEach((row, index) => {
        if (!row || typeof row !== "object") return;
        const id = String(row.governor_id ?? row.fid ?? row.uid ?? "");
        if (ids.has(id)) {
          const score = row.score ?? row.value ?? row.power;
          const rank = row.rank ?? row.kingdom_rank ?? row.position ?? index + 1;
          boardRanks.push({board:String(row.board ?? row.board_name ?? row.type ?? row.label ?? label ?? "Kingdom leaderboard").slice(0,60),
            rank:numericOrNull(rank),score:numericOrNull(score)});
        } else visit(row, String(row.name ?? row.key ?? label), depth + 1);
      });
      return;
    }
    for (const [key, nested] of Object.entries(value)) visit(nested, String((value as any).name ?? (value as any).label ?? key ?? label), depth + 1);
  };
  const kingdomBody = kingdomResult.status === "fulfilled" ? kingdomResult.value : null;
  if (kingdomBody) {
    const data = kingdomBody.kingdom && typeof kingdomBody.kingdom === "object" ? kingdomBody.kingdom
      : kingdomBody.data?.kingdom && typeof kingdomBody.data.kingdom === "object" ? kingdomBody.data.kingdom
      : kingdomBody.data && typeof kingdomBody.data === "object" ? kingdomBody.data : kingdomBody;
    visit(kingdomBody.boards ?? kingdomBody.data?.boards ?? data.boards ?? kingdomBody.leaderboards ?? kingdomBody.data?.leaderboards ?? []);
  }
  const rankBody = ranksResult.status === "fulfilled" ? ranksResult.value : null;
  if (rankBody) visit(rankBody.boards ?? rankBody.rankings ?? rankBody.leaderboards ?? rankBody.ranks ?? rankBody.items ?? rankBody);
  const uniqueRanks = [...new Map(boardRanks.map(item => [item.board.toLowerCase(), item])).values()].slice(0,100);
  let allianceRoster: Record<string, unknown> | null = null;
  if (allianceResult.status === "fulfilled" && allianceResult.value) {
    const body = allianceResult.value;
    const source = body.data && typeof body.data === "object" ? body.data : body;
    const alliance = source.alliance && typeof source.alliance === "object" ? source.alliance : source;
    const raw = Array.isArray(source.members) ? source.members : Array.isArray(source.roster) ? source.roster : Array.isArray(alliance.members) ? alliance.members : Array.isArray(alliance.roster) ? alliance.roster : [];
    const members = raw.flatMap((member: Record<string, any>) => {
      const governorId = String(member.governor_id ?? member.fid ?? "").trim();
      if (!/^\d{5,20}$/.test(governorId)) return [];
      return [{governor_id:governorId,name:String(member.nick_name ?? member.name ?? member.nickname ?? "Kingshot Player").trim().slice(0,80),
        power:numericOrNull(member.power),town_center_level:numericOrNull(member.town_center_level),kills:numericOrNull(member.kills),
        alliance_rank:String(member.alliance_rank_label ?? member.alliance_rank ?? "").trim().slice(0,30),
        avatar_url:/^https:\/\//i.test(String(member.avatar_url ?? "")) ? String(member.avatar_url) : ""}];
    });
    members.sort((a:any,b:any)=>(b.power ?? -1)-(a.power ?? -1));
    const position=members.findIndex((member:any)=>member.governor_id===playerIdOf(player));
    allianceRoster={name:String(alliance.name ?? alliance.alliance_name ?? allianceName).trim().slice(0,100),tag:String(alliance.abbr ?? alliance.tag ?? alliance.alliance_tag ?? allianceTag).trim().slice(0,32),power:numericOrNull(alliance.power ?? alliance.score),members:members.slice(0,8),total:members.length,player_power_rank:position<0?null:position+1,
      fresh:typeof body.fresh==="boolean"?body.fresh:null,age_seconds:numericOrNull(body.age_seconds),cached_at:typeof body.cached_at==="string"?body.cached_at:null};
  }
  return {
    kingdom: kingdomBody ? (kingdomBody.kingdom && typeof kingdomBody.kingdom==="object" ? kingdomBody.kingdom
      : kingdomBody.data?.kingdom && typeof kingdomBody.data.kingdom==="object" ? kingdomBody.data.kingdom
      : kingdomBody.data && typeof kingdomBody.data==="object" ? kingdomBody.data : kingdomBody) : null,
    kingdom_board_ranks:uniqueRanks,
    kingdom_meta:kingdomBody?{fresh:typeof kingdomBody.fresh==="boolean"?kingdomBody.fresh:null,age_seconds:numericOrNull(kingdomBody.age_seconds),cached_at:typeof kingdomBody.cached_at==="string"?kingdomBody.cached_at:null}:null,
    alliance_roster:allianceRoster
  };
}
async function loadNativeDetailedProfile(env: Env, playerId: string, player: Record<string, any>): Promise<Record<string, unknown>> {
  const cached=detailedProfileCache.get(playerId);
  if(cached && cached.expiresAt>Date.now()) return cached.value;
  const active=detailedProfileInFlight.get(playerId);
  if(active) return active;
  const request=(async()=>{
    const endpoint="https://api.mightpulse.com/v1/players/"+encodeURIComponent(playerId)+"?include=base,heroes,ranks,gov_gear";
    const [detailsResult,contextResult]=await Promise.allSettled([
      mightPulseJson(env,endpoint,7000),
      loadNativePlayerContext(env,player)
    ]);
    const body=detailsResult.status==="fulfilled"?detailsResult.value:{};
    const context=contextResult.status==="fulfilled"?contextResult.value:{kingdom:null,kingdom_board_ranks:[],kingdom_meta:null,alliance_roster:null};
    const detailSource=body.data && typeof body.data==="object" ? body.data : body;
    const detailPlayer=detailSource.player && typeof detailSource.player==="object" ? detailSource.player : player;
    if(playerIdOf(detailPlayer)!==playerId) throw Object.assign(new Error("MightPulse returned a mismatched player profile."),{status:502});
    const result={
      ok:true,player,...context,
      heroes:Array.isArray(detailSource.heroes)?detailSource.heroes:[],
      ranks:detailSource.ranks && typeof detailSource.ranks==="object"?detailSource.ranks:null,
      gov_gear:detailSource.gov_gear && typeof detailSource.gov_gear==="object"?detailSource.gov_gear:null,
      fresh:typeof body.fresh==="boolean"?body.fresh:typeof detailSource.fresh==="boolean"?detailSource.fresh:null,
      cached_at:typeof body.cached_at==="string"?body.cached_at:typeof detailSource.cached_at==="string"?detailSource.cached_at:null,
      age_seconds:numericOrNull(body.age_seconds ?? detailSource.age_seconds),
      include:Array.isArray(body.include)?body.include:Array.isArray(detailSource.include)?detailSource.include:["heroes","ranks","gov_gear"],
      source:"mightpulse",extras_available:detailsResult.status==="fulfilled",
      extras_error:detailsResult.status==="rejected"?"Some extended player details could not be refreshed. The public profile is still available.":null
    };
    detailedProfileCache.set(playerId,{value:result,expiresAt:Date.now()+120_000});
    return result;
  })();
  detailedProfileInFlight.set(playerId,request);
  try{return await request;}finally{detailedProfileInFlight.delete(playerId);}
}
async function handleNativeDetailedPlayerProfile(request: Request, env: Env): Promise<Response> {
  if(request.method!=="GET") return new Response(JSON.stringify({error:"Method not allowed.",code:"method_not_allowed"}),{status:405,headers:{Allow:"GET","Content-Type":"application/json","Cache-Control":"no-store"}});
  const url=new URL(request.url);
  const playerId=(url.searchParams.get("id")||"").trim();
  if(!/^\d{5,20}$/.test(playerId)) return jsonError(400,"invalid_player_id","Player ID must contain 5–20 digits.");
  const ip=request.headers.get("CF-Connecting-IP")||"unknown";
  const now=Date.now();
  let bucket=playerLookupBuckets.get("detail:"+ip);
  if(!bucket||bucket.resetAt<=now) bucket={count:0,resetAt:now+60_000};
  bucket.count++;
  playerLookupBuckets.set("detail:"+ip,bucket);
  if(bucket.count>12) return new Response(JSON.stringify({error:"Too many detailed profile lookups. Please wait before trying again.",code:"rate_limit_exceeded"}),{
    status:429,headers:{"Content-Type":"application/json","Cache-Control":"no-store","Retry-After":String(Math.max(1,Math.ceil((bucket.resetAt-now)/1000)))}
  });
  const requestId=crypto.randomUUID();
  try{
    const upstream=await fetchMightPulseNative(env,"https://api.mightpulse.com/v1/players/"+encodeURIComponent(playerId)+"?include=base",9000);
    const baseBody=await upstream.json().catch(()=>({})) as Record<string,any>;
    if(!upstream.ok){
      const status=upstream.status===404?404:upstream.status===429?429:upstream.status>=500?503:502;
      return jsonError(status,status===404?"player_not_found":status===429?"provider_rate_limited":"profile_unavailable",
        status===404?"No Kingshot player was found for this ID.":status===429?"The game data provider is busy. Please wait a moment and try again.":"The basic player lookup is temporarily unavailable.");
    }
    const nestedBase=baseBody.data && typeof baseBody.data==="object" && !Array.isArray(baseBody.data)?baseBody.data:null;
    const rawPlayer=baseBody.player && typeof baseBody.player==="object"?baseBody.player
      :nestedBase?.player && typeof nestedBase.player==="object"?nestedBase.player:nestedBase??baseBody;
    const player=normalizeNativePlayer(rawPlayer);
    if(playerIdOf(player)!==playerId) return jsonError(502,"profile_mismatch","The provider returned a different player ID.");
    const profile=await loadNativeDetailedProfile(env,playerId,player);
    return Response.json({...profile,meta:{requestId,timestamp:new Date().toISOString()}},{
      headers:{"Cache-Control":"public, max-age=30, s-maxage=60, stale-while-revalidate=180","X-Request-Id":requestId,"X-Content-Type-Options":"nosniff","X-Edge-Backend":"cloudflare-mightpulse"}
    });
  }catch(error){
    const status=mightPulsePlayerErrorStatus(error);
    return jsonError(status,status===429?"provider_rate_limited":status===504?"upstream_timeout":"profile_unavailable",
      status===429?"The game data provider is busy. Please wait a moment and try again.":status===504?"The basic player lookup timed out. Please retry in a moment.":"The basic player lookup is temporarily unavailable.");
  }
}

function findNativeAllianceRows(value: unknown, depth = 0): Record<string, any>[] {
  if (!value || typeof value !== "object" || depth > 5) return [];
  if (Array.isArray(value)) {
    const rows = value.filter((item): item is Record<string, any> => Boolean(item && typeof item === "object" &&
      (item.abbr != null || item.tag != null) && (item.name != null || item.alliance_name != null || item.power != null || item.score != null)));
    if (rows.length) return rows;
    for (const item of value) { const nested = findNativeAllianceRows(item, depth + 1); if (nested.length) return nested; }
    return [];
  }
  for (const nestedValue of Object.values(value as Record<string, unknown>)) {
    const nested = findNativeAllianceRows(nestedValue, depth + 1); if (nested.length) return nested;
  }
  return [];
}
async function handleNativeAllianceLookup(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response(JSON.stringify({error:"Method not allowed."}), {status:405,headers:{Allow:"GET","Content-Type":"application/json","Cache-Control":"no-store"}});
  const url = new URL(request.url), p = url.searchParams;
  const mode = p.get("mode") || "";
  if (mode === "registration-status") return handleRegistrationStatus(request, env);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown", now = Date.now();
  const key = "alliance:" + ip;
  let bucket = playerLookupBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) bucket = {count:0,resetAt:now+60_000};
  bucket.count++; playerLookupBuckets.set(key,bucket);
  if (bucket.count > 20) return jsonError(429,"rate_limit_exceeded","Too many alliance lookups. Please wait before trying again.");
  const kid = (p.get("kingdomId") || "").trim().slice(0,10), tag = (p.get("tag") || "").trim().slice(0,20);
  if (!/^\d{1,10}$/.test(kid)) return jsonError(400,"invalid_kingdom_id","Enter a numeric kingdom ID.");
  const fast = p.get("discordFastPath") === "1";
  try {
    if (mode === "search") {
      const endpoint = "https://api.mightpulse.com/v1/kingdoms/"+encodeURIComponent(kid)+"/ranks?board=alliance_power&limit=100";
      const response = await fetchMightPulseNative(env,endpoint,fast?6000:12000,fast?{totalTimeoutMs:18_000,maxAttempts:2,fastPath:true}:{});
      const body = await response.json().catch(()=>({})) as Record<string,any>;
      if (!response.ok) return jsonError(response.status===404?404:response.status===429?429:502,response.status===404?"kingdom_not_found":response.status===429?"provider_rate_limited":"provider_unavailable",
        response.status===404?"That kingdom was not found in the alliance rankings.":response.status===429?"The game data provider is busy. Please wait a moment and try again.":"Alliance rankings are temporarily unavailable. Please try again shortly.");
      const rows=findNativeAllianceRows(body);
      const alliances=rows.flatMap((row,index)=>{
        const allianceTag=String(row.abbr??row.tag??row.alliance_tag??"").trim().slice(0,20);
        if(!/^[A-Za-z0-9_-]{1,20}$/.test(allianceTag))return [];
        const rawFlag=row.flag_url??row.flagUrl??row.flag??row.icon_url??row.iconUrl??row.image_url??row.imageUrl??row.logo_url??row.logoUrl??row.emblem_url??row.emblemUrl??"";
        const flag=typeof rawFlag==="string"?rawFlag.trim():String(rawFlag&&typeof rawFlag==="object"?rawFlag.url??rawFlag.src??rawFlag.image??"":"").trim();
        let flagUrl=""; if(flag)try{const u=new URL(flag,"https://www.mightpulse.com/");if(u.protocol==="https:"&&!u.username&&!u.password)flagUrl=u.href;}catch{}
        const num=(v:any)=>v==null||!Number.isFinite(Number(v))?null:Number(v);
        return [{name:String(row.name??row.alliance_name??allianceTag).trim().slice(0,80)||allianceTag,tag:allianceTag,
          kingdomId:String(row.kid??kid),power:num(row.power??row.score??row.alliance_power),
          memberCount:num(row.member_count??row.memberCount??row.count),leaderName:String(row.leader_name??row.leaderName??"").trim().slice(0,80),
          flagUrl,rank:num(row.rank)??index+1}];
      });
      const q=(p.get("q")||"").toLocaleLowerCase(), matches=q?alliances.filter(x=>(x.name+" "+x.tag).toLocaleLowerCase().includes(q)):alliances;
      return Response.json({alliances:matches,totalReturned:alliances.length,limitedToTop:100,
        sourceFresh:typeof body.fresh==="boolean"?body.fresh:null,cachedAt:typeof body.cached_at==="string"?body.cached_at:null,
        ageSeconds:numericOrNull(body.age_seconds)},{headers:{"Cache-Control":"private, no-store","X-Edge-Backend":"cloudflare-mightpulse"}});
    }
    if(!/^[A-Za-z0-9_-]{1,20}$/.test(tag))return jsonError(400,"invalid_alliance_tag","Enter the exact alliance tag/abbreviation shown in Kingshot.");
    const endpoint="https://api.mightpulse.com/v1/alliances/"+encodeURIComponent(kid)+"/"+encodeURIComponent(tag)+"?include=info,roster";
    const response=await fetchMightPulseNative(env,endpoint,fast?7000:15000,fast?{totalTimeoutMs:18_000,maxAttempts:2}:{});
    const body=await response.json().catch(()=>({})) as Record<string,any>;
    if(!response.ok)return jsonError(response.status===404?404:response.status===429?429:502,response.status===404?"alliance_not_found":response.status===429?"provider_rate_limited":"provider_unavailable",
      response.status===404?"No alliance was found for that kingdom and tag. Check both values and try again.":response.status===429?"The game data provider is busy. Please wait a moment and try again.":"Alliance data is temporarily unavailable. Please try again shortly.");
    const source=body.data&&typeof body.data==="object"?body.data:body, alliance=source.alliance??source;
    const raw=Array.isArray(source.members)?source.members:Array.isArray(source.roster)?source.roster:Array.isArray(alliance.members)?alliance.members:[];
    const members=raw.flatMap((m:Record<string,any>)=>{
      const playerId=String(m.governor_id??m.fid??"").trim();if(!/^\d{5,20}$/.test(playerId))return [];
      const num=(v:any)=>v==null||!Number.isFinite(Number(v))?null:Number(v), avatar=String(m.avatar_url??m.avatarUrl??"").trim();
      return [{playerId,name:String(m.nick_name??m.name??m.nickname??"Kingshot Player").trim().slice(0,80)||"Kingshot Player",
        power:num(m.power),townCenterLevel:num(m.town_center_level),avatarUrl:/^https:\/\//i.test(avatar)?avatar:"",
        allianceRank:String(m.alliance_rank_label??m.alliance_rank??"").trim().slice(0,30),kingdomId:String(m.kid??kid)}];
    });
    const num=(v:any)=>v==null||!Number.isFinite(Number(v))?null:Number(v);
    const count=num(alliance.count)??members.length;
    return Response.json({alliance:{name:String(alliance.name??alliance.alliance_name??tag).trim().slice(0,80)||tag,
      tag:String(alliance.abbr??alliance.tag??tag).trim().slice(0,20)||tag,kingdomId:kid,power:num(alliance.power),count,memberCount:count,
      leaderName:String(alliance.leader_name??"").trim().slice(0,80)},members,
      stale:body.fresh===false||Boolean(body.stale),fresh:typeof body.fresh==="boolean"?body.fresh:null,
      fetchedAt:typeof body.cached_at==="string"?body.cached_at:null,ageSeconds:num(body.age_seconds)},
      {headers:{"Cache-Control":"private, no-store","X-Edge-Backend":"cloudflare-mightpulse"}});
  } catch(error) {
    const status=mightPulsePlayerErrorStatus(error);
    return jsonError(status===429?429:502,status===429?"provider_rate_limited":"provider_unavailable",
      status===429?"The game data provider is busy. Please wait a moment and try again.":"Could not reach the alliance data provider. Please try again shortly.");
  }
}

async function handleNativePlayerLookup(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "Method not allowed.", code: "method_not_allowed" }), {
    status: 405, headers: { Allow: "GET", "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  const url = new URL(request.url);
  const playerId = (url.searchParams.get("id") || "").trim();
  if (!/^\d{5,20}$/.test(playerId)) return jsonError(400, "invalid_player_id",
    "Player ID must contain 5–20 digits. Copy it from Kingshot under Profile → Info; your kingdom number is different.");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  let bucket = playerLookupBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + 60_000 };
  bucket.count++;
  playerLookupBuckets.set(ip, bucket);
  if (playerLookupBuckets.size > 5000) {
    for (const [key, value] of playerLookupBuckets) if (value.resetAt <= now) playerLookupBuckets.delete(key);
  }
  if (bucket.count > 30) return new Response(JSON.stringify({ error: "Too many player lookups. Retry after the indicated delay.", code: "rate_limit_exceeded" }), {
    status: 429, headers: { "Content-Type": "application/json", "Cache-Control": "no-store",
      "Retry-After": String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
      "X-RateLimit-Limit": "30", "X-RateLimit-Remaining": "0" },
  });
  const requestId = crypto.randomUUID();
  try {
    const upstream = await fetchMightPulseNative(env, "https://api.mightpulse.com/v1/players/" + encodeURIComponent(playerId) + "?include=base", 9000);
    const body: unknown = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      const status = upstream.status === 404 ? 404 : upstream.status === 429 ? 429 : upstream.status >= 500 ? 503 : 502;
      return jsonError(status, status === 404 ? "player_not_found" : status === 429 ? "provider_rate_limited" : "upstream_unavailable",
        status === 404 ? "No player was found for this ID. Check it under Kingshot Profile → Info; if the ID is correct, try again shortly."
          : status === 429 ? "The game data provider is busy. Please wait a moment and try again."
          : "Player lookup provider is unavailable.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return jsonError(502, "invalid_provider_response", "Player lookup provider returned an invalid response.");
    const payload = body as Record<string, any>;
    const nested = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data : null;
    const rawPlayer = payload.player && typeof payload.player === "object" && !Array.isArray(payload.player)
      ? payload.player : nested?.player && typeof nested.player === "object" && !Array.isArray(nested.player)
        ? nested.player : nested ?? payload;
    const player = normalizeNativePlayer(rawPlayer);
    const returnedId = String(player.governor_id ?? player.fid ?? player.player_id ?? "");
    if (returnedId !== playerId) return jsonError(502, "profile_mismatch", "The provider returned a different player ID.");
    return Response.json({ player, data: { player }, meta: {
      requestId, timestamp: new Date().toISOString(), fetchedAt: new Date().toISOString(),
      source: "mightpulse", stale: false,
    } }, { headers: { "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60",
      "X-Request-Id": requestId, "X-Content-Type-Options": "nosniff", "X-Edge-Backend": "cloudflare-mightpulse" } });
  } catch (error) {
    const status = mightPulsePlayerErrorStatus(error);
    const code = status === 429 ? "provider_rate_limited" : status === 504 ? "upstream_timeout" : "upstream_unavailable";
    return jsonError(status, code, status === 429 ? "The game data provider is busy. Please wait a moment and try again."
      : status === 504 ? "MightPulse request timed out." : "Player lookup provider is temporarily unavailable.");
  }
}

async function handlePublicHealth(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405, headers: { Allow: "GET", "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  const params = new URL(request.url).searchParams;
  if (params.has("logs") || params.has("badge")) return jsonError(501, "health_detail_not_migrated", "Extended health diagnostics are not yet available on the native runtime.");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return jsonError(503, "health_backend_unconfigured", "Health backend is not configured.");
  const base = String(env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co").replace(/\/$/, "");
  const query = new URLSearchParams({ select: "last_started_at,last_finished_at,last_status,lock_until", id: "eq.true", limit: "1" });
  try {
    const response = await fetch(base + "/rest/v1/kingshot_worker_state?" + query.toString(), {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    const rows: unknown = await response.json().catch(() => []);
    if (!response.ok || !Array.isArray(rows) || !rows[0]) return jsonError(503, "worker_state_unavailable", "Worker state unavailable.");
    const state = rows[0] as Record<string, unknown>;
    const now = Date.now();
    const started = typeof state.last_started_at === "string" ? Date.parse(state.last_started_at) : NaN;
    const finished = typeof state.last_finished_at === "string" ? Date.parse(state.last_finished_at) : NaN;
    const ageMs = state.last_status === "RUNNING" && Number.isFinite(started) ? now - started
      : Number.isFinite(finished) ? now - finished : Infinity;
    const healthy = (state.last_status === "COMPLETED" || state.last_status === "RUNNING") && ageMs <= 12 * 60 * 1000;
    return Response.json({
      healthy, status: String(state.last_status || "UNKNOWN"),
      lastCompletedAt: state.last_finished_at || null,
      runningSince: state.last_status === "RUNNING" ? state.last_started_at || null : null,
      ageSeconds: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 1000)) : null,
      locked: Boolean(state.lock_until && Date.parse(String(state.lock_until)) > now),
    }, { status: healthy ? 200 : 503, headers: {
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Edge-Backend": "cloudflare-supabase",
    } });
  } catch {
    return jsonError(503, "health_check_unavailable", "Worker health check failed.");
  }
}

async function handleVisitorTelemetry(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") return handleEdgeLocale(request);
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { Allow: "GET, POST", "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return jsonError(503, "telemetry_storage_unconfigured", "Telemetry storage is not configured.");
  if (env.SUPABASE_WRITE_MODE !== "enabled") return jsonError(503, "telemetry_writes_disabled", "Telemetry writes are disabled in this preview environment.");
  const origin = request.headers.get("Origin");
  let originHost = "";
  try { originHost = origin ? new URL(origin).host.toLowerCase() : ""; } catch {}
  const requestHost = new URL(request.url).host.toLowerCase();
  if (!originHost || originHost !== requestHost) {
    return jsonError(403, "origin_not_allowed", "Origin not allowed.");
  }

  const now = Date.now();
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const bucketKey = "visitor-telemetry:" + ip;
  let bucket = visitorBuckets.get(bucketKey);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + 60_000 };
  bucket.count++;
  visitorBuckets.set(bucketKey, bucket);
  if (visitorBuckets.size > 5000) {
    for (const [key, value] of visitorBuckets) if (value.resetAt <= now) visitorBuckets.delete(key);
  }
  if (bucket.count > 12) {
    return new Response(JSON.stringify({ error: "Too many telemetry requests" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json", "Cache-Control": "no-store",
        "Retry-After": String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
        "X-RateLimit-Limit": "12",
        "X-RateLimit-Remaining": "0",
      },
    });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : {};
  } catch {
    return jsonError(400, "invalid_json", "Invalid request body.");
  }
  const path = clean(body.path, 180);
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("?") || path.includes("#")) {
    return jsonError(400, "invalid_page_path", "Invalid page path.");
  }
  const ua = clean(request.headers.get("User-Agent"), 500);
  const agent = classifyAgent(ua);
  const cf = (request.cf || {}) as Record<string, unknown>;
  const event = {
    ip_address: clean(request.headers.get("CF-Connecting-IP"), 64),
    country_code: clean(cf.country, 8),
    region: clean(cf.region, 100),
    city: clean(cf.city, 100),
    timezone: clean(cf.timezone, 80),
    path,
    referrer_host: clean(body.referrerHost, 180),
    user_agent: ua,
    browser: agent.browser,
    operating_system: agent.operating_system,
    device_type: agent.device_type,
    language: clean(request.headers.get("Accept-Language"), 160),
    screen_class: ["small", "medium", "large", "unknown"].includes(String(body.screenClass))
      ? body.screenClass : "unknown",
  };
  const base = String(env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co").replace(/\/$/, "");
  try {
    const response = await fetch(base + "/rest/v1/kingshot_visitor_events", {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
        "content-type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return jsonError(503, "telemetry_insert_failed", "Telemetry temporarily unavailable.");
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch {
    return jsonError(503, "telemetry_unavailable", "Telemetry temporarily unavailable.");
  }
}



async function handleDiscordAvatar(request: Request): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405, headers: { Allow: "GET", "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const params = new URL(request.url).searchParams;
  const id = (params.get("id") || "").trim();
  const hash = (params.get("hash") || "").trim();
  const requestedFormat = (params.get("format") || "png").toLowerCase();
  const format = ["png", "jpg", "jpeg", "webp", "gif"].includes(requestedFormat)
    ? (requestedFormat === "jpeg" ? "jpg" : requestedFormat) : "png";
  const size = Number(params.get("size") || 1024);
  const allowedSizes = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096];
  if (!/^\d{15,22}$/.test(id) || !/^[a-zA-Z0-9_]{20,80}$/.test(hash) || !allowedSizes.includes(size)) {
    return jsonError(400, "invalid_avatar_request", "Invalid avatar request.");
  }
  const animated = hash.startsWith("a_");
  if (!(animated ? ["gif"] : ["png", "jpg", "webp"]).includes(format)) {
    return jsonError(400, "invalid_avatar_format", animated
      ? "Animated avatars are only available as GIF."
      : "That format is not available for this avatar.");
  }
  const target = "https://cdn.discordapp.com/avatars/" + id + "/" + hash + "." + format + "?size=" + size;
  try {
    const upstream = await fetch(target, {
      headers: { Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok) {
      return jsonError(upstream.status === 404 ? 404 : 502, "avatar_unavailable", "Avatar image is unavailable in that format.");
    }
    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") || "image/" + format);
    headers.set("Cache-Control", "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return jsonError(timedOut ? 504 : 502, timedOut ? "avatar_timeout" : "avatar_fetch_failed",
      timedOut ? "The avatar took too long to load. Please try again." : "Could not load the avatar right now.");
  }
}


async function handleDiscordUser(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405,
      headers: { Allow: "GET", "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const id = (new URL(request.url).searchParams.get("id") || "").trim();
  if (!/^\d{15,22}$/.test(id)) {
    return jsonError(400, "invalid_discord_user_id", "Enter a valid Discord user ID.");
  }
  if (!env.DISCORD_BOT_TOKEN) {
    return jsonError(503, "discord_api_unconfigured", "Discord API access is not configured.");
  }
  let upstream: Response;
  try {
    upstream = await fetch("https://discord.com/api/v10/users/" + id, {
      headers: { Authorization: "Bot " + env.DISCORD_BOT_TOKEN, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return jsonError(timedOut ? 504 : 502, timedOut ? "discord_timeout" : "discord_unavailable",
      timedOut ? "Discord took too long to respond. Please try again." : "Could not reach Discord right now.");
  }
  if (!upstream.ok) {
    if (upstream.status === 404) return jsonError(404, "discord_user_not_found", "Discord user not found.");
    if (upstream.status === 429) {
      return new Response(JSON.stringify({ error: "Discord rate limit reached. Try again shortly." }), {
        status: 429,
        headers: {
          "Content-Type": "application/json", "Cache-Control": "no-store",
          "Retry-After": upstream.headers.get("retry-after") || "1",
        },
      });
    }
    return jsonError(502, "discord_api_failed", "Discord API request failed.");
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await upstream.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid profile payload");
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonError(502, "discord_invalid_response", "Discord returned an invalid profile.");
  }
  const avatar = typeof body.avatar === "string" && body.avatar ? body.avatar : null;
  const userId = typeof body.id === "string" && /^\d{15,22}$/.test(body.id) ? body.id : id;
  const animated = Boolean(avatar && avatar.startsWith("a_"));
  const defaultAvatarIndex = Number((BigInt(userId) >> 22n) % 6n);
  const format = animated ? "gif" : "png";
  const avatarUrl = avatar
    ? "https://cdn.discordapp.com/avatars/" + userId + "/" + avatar + "." + format + "?size=1024"
    : "https://cdn.discordapp.com/embed/avatars/" + defaultAvatarIndex + ".png?size=1024";
  return Response.json({
    id: userId,
    username: typeof body.username === "string" ? body.username : "",
    globalName: typeof body.global_name === "string" && body.global_name ? body.global_name : null,
    avatar,
    animated,
    format,
    avatarUrl,
    fetchedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" } });
}

function handleEdgeLocale(request: Request): Response {
  const country = (request.cf as { country?: unknown } | undefined)?.country;
  const countryCode = typeof country === "string" && /^[A-Z]{2}$/.test(country)
    ? country
    : null;
  return Response.json(
    { countryCode },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Vary": "CF-IPCountry",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    { error: message, code },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    const incoming = new URL(request.url);

    if (incoming.pathname === "/api/discord-avatar" || incoming.pathname === "/api/discord-tools/avatar") {
      return handleDiscordAvatar(request);
    }

    if (incoming.pathname === "/api/discord-user" || incoming.pathname === "/api/discord-tools/user") {
      return handleDiscordUser(request, env);
    }

    if (incoming.pathname === "/api/internal/v4/webhooks/dispatch") return handleWebhookDeliveryDispatch(request, env);

    if (incoming.pathname.startsWith("/api/v4/")) return handleNativeV4(request, env);

    if (incoming.pathname === "/api/kingshot-player") {
      const developerPath = incoming.searchParams.get("developerPath") || incoming.searchParams.get("developer") || "";
      // Keep Discord profile OAuth and role verification on the native account handler.
      // It shares the existing Supabase identity and server-side session RPCs.
      if (developerPath === "account-auth") return handleNativeDeveloperAccount(request, env, "auth");
      if (developerPath === "account-keys") return handleNativeDeveloperAccount(request, env, "keys");
    }

    if (incoming.pathname === "/api/kingshot-register") return handleNativeRegistration(request, env);
    if (incoming.pathname === "/api/kingshot-redeem") return handleNativeRedemption(request, env);

    // Preview writes are fail-closed until an isolated staging database is configured.
    if (incoming.pathname === "/api/kingshot-player" &&
      incoming.searchParams.get("developerPath") === "alliance-lookup") {
      return handleNativeAllianceLookup(request, env);
    }

    if (incoming.pathname === "/api/health" || incoming.pathname === "/api/ops-tools/health") return handlePublicHealth(request, env);
    if (incoming.pathname === "/api/ops-tools/shard-health") {
      if (!env.CRON_SECRET || request.headers.get("authorization") !== "Bearer " + env.CRON_SECRET) {
        return jsonError(401, "unauthorized", "Unauthorized");
      }
      if (!env.SHARD_WORKER) return jsonError(503, "shard_service_unavailable", "Internal shard service is not configured.");
      try {
        const shardResponse = await env.SHARD_WORKER.fetch(new Request("https://shard.internal/health"));
        const shardBody = await shardResponse.json().catch(() => ({}));
        if (!shardResponse.ok || shardBody?.ok !== true) {
          return jsonError(503, "shard_service_unhealthy", "Internal shard service health check failed.");
        }
        const routeProbe = await env.SHARD_WORKER.fetch(new Request(
          "https://shard.internal/api/kingshot-auto?mode=worker&slot=0",
          { method: "POST", headers: { authorization: "Bearer invalid-route-probe", "content-type": "application/json" }, body: "{}" },
        ));
        if (routeProbe.status !== 401) {
          return jsonError(503, "shard_route_probe_failed", "Internal shard worker route did not reach its authentication gate.");
        }
        return Response.json({
          ...shardBody,
          routeProbe: { ok: true, status: routeProbe.status, stage: "authentication_gate" },
        }, { status: 200, headers: { "Cache-Control": "no-store" } });
      } catch {
        return jsonError(503, "shard_service_unavailable", "Internal shard service health check failed.");
      }
    }

    if (incoming.pathname === "/api/kingshot-player" && incoming.searchParams.has("frame")) {
      return handleNativeAvatarFrame(request, env);
    }

    if (incoming.pathname === "/api/kingshot-player" && incoming.searchParams.get("profile") === "detail") {
      return handleNativeDetailedPlayerProfile(request, env);
    }

    if (incoming.pathname === "/api/kingshot-player" &&
      !incoming.searchParams.has("milestone") &&
      !incoming.searchParams.has("developerPath") &&
      !incoming.searchParams.has("developer") &&
      incoming.searchParams.get("profile") !== "detail" &&
      !incoming.searchParams.has("frame")) {
      return handleNativePlayerLookup(request, env);
    }

    if (incoming.pathname === "/api/ops-tools/visitor") {
      if (request.method === "GET") return handleEdgeLocale(request);
      if (env.SUPABASE_SERVICE_ROLE_KEY) return handleVisitorTelemetry(request, env);
    }

    const adapted = await dispatchLegacyApi(request, { waitUntil: promise => ctx.waitUntil(promise), env });
    if (adapted) return adapted;

    if (incoming.pathname === API_PREFIX || incoming.pathname.startsWith(API_PREFIX + "/")) {
      return jsonError(501, "route_not_migrated", "This API route has not yet been migrated to the native Cloudflare runtime.");
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

// Native Cloudflare runtime. All known API handlers execute in this Worker; unknown API paths fail closed.
