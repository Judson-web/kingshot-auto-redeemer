import { fetchMightPulseNative, mightPulsePlayerErrorStatus } from "./mightpulse.js";

interface Env {
  ASSETS: Fetcher;
  SUPABASE_WRITE_MODE?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
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
function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}
async function mightPulseJson(env: Env, url: string, timeoutMs: number): Promise<Record<string, any>> {
  const response = await fetchMightPulseNative(env, url, timeoutMs);
  const body = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw Object.assign(new Error("MightPulse enrichment unavailable."), { status: response.status });
  return body;
}
async function loadNativePlayerContext(env: Env, player: Record<string, any>): Promise<Record<string, unknown>> {
  const kid = String(player.kid ?? player.kingdom_id ?? "").trim();
  const allianceTag = String(player.alliance?.abbr ?? player.alliance_tag ?? player.allianceTag ?? "").trim();
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
    const raw = Array.isArray(source.members) ? source.members : Array.isArray(source.roster) ? source.roster : Array.isArray(source.alliance?.members) ? source.alliance.members : [];
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
    allianceRoster={members:members.slice(0,8),total:raw.length,player_power_rank:position<0?null:position+1,
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
    const detailPlayer=body.player && typeof body.player==="object" ? body.player : player;
    if(playerIdOf(detailPlayer)!==playerId) throw Object.assign(new Error("MightPulse returned a mismatched player profile."),{status:502});
    const result={
      ok:true,player,...context,
      heroes:Array.isArray(body.heroes)?body.heroes:[],
      ranks:body.ranks && typeof body.ranks==="object"?body.ranks:null,
      gov_gear:body.gov_gear && typeof body.gov_gear==="object"?body.gov_gear:null,
      fresh:typeof body.fresh==="boolean"?body.fresh:null,
      cached_at:typeof body.cached_at==="string"?body.cached_at:null,
      age_seconds:numericOrNull(body.age_seconds),
      include:Array.isArray(body.include)?body.include:["heroes","ranks","gov_gear"],
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
    const player=baseBody.player && typeof baseBody.player==="object"?baseBody.player:baseBody;
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
    const payload = body as Record<string, unknown>;
    const player = payload.player && typeof payload.player === "object" && !Array.isArray(payload.player)
      ? payload.player as Record<string, unknown> : payload;
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

async function handleRegistrationMilestoneCount(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "Method not allowed." }), {
    status: 405, headers: { Allow: "GET", "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return jsonError(503, "registration_count_unavailable", "Registration count is temporarily unavailable.");
  const base = String(env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co").replace(/\/$/, "");
  try {
    const response = await fetch(base + "/rest/v1/rpc/kingshot_public_registration_count", {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
        "content-type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return jsonError(503, "registration_count_unavailable", "Registration count is temporarily unavailable.");
    const value = Number(await response.json());
    if (!Number.isSafeInteger(value) || value < 0) return jsonError(503, "registration_count_invalid", "Registration count is temporarily unavailable.");
    return Response.json({ registeredIds: value, milestone: 1000, remaining: Math.max(0, 1000 - value) }, {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=60", "X-Content-Type-Options": "nosniff", "X-Edge-Backend": "cloudflare-supabase" },
    });
  } catch {
    return jsonError(503, "registration_count_unavailable", "Registration count is temporarily unavailable.");
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
  async fetch(request: Request, env: Env): Promise<Response> {
    const incoming = new URL(request.url);

    if (incoming.pathname === "/api/discord-avatar" || incoming.pathname === "/api/discord-tools/avatar") {
      return handleDiscordAvatar(request);
    }

    if ((incoming.pathname === "/api/discord-user" || incoming.pathname === "/api/discord-tools/user") && env.DISCORD_BOT_TOKEN) {
      return handleDiscordUser(request, env);
    }

    // Preview writes are fail-closed until an isolated staging database is configured.
    if (incoming.pathname === "/api/kingshot-player" &&
      incoming.searchParams.get("developerPath") === "alliance-lookup" &&
      incoming.searchParams.get("mode") === "registration-status") {
      return handleRegistrationStatus(request, env);
    }

    if (incoming.pathname === "/api/ops-tools/health") return handlePublicHealth(request, env);

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

    if (incoming.pathname === "/api/kingshot-player" && incoming.searchParams.get("milestone") === "count") {
      return handleRegistrationMilestoneCount(request, env);
    }

    if (incoming.pathname === "/api/ops-tools/visitor") {
      if (request.method === "GET") return handleEdgeLocale(request);
      if (env.SUPABASE_SERVICE_ROLE_KEY) return handleVisitorTelemetry(request, env);
    }

    if (incoming.pathname === API_PREFIX || incoming.pathname.startsWith(API_PREFIX + "/")) {
      return jsonError(501, "route_not_migrated", "This API route has not yet been migrated to the native Cloudflare runtime.");
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

// Native Cloudflare runtime. Unported routes fail closed; no legacy host fallback exists.
