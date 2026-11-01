import { rateLimit } from "../lib/request-rate-limit.js";
import { fetchMightPulse } from "../lib/mightpulse-key-pool.js";
import developerApi from "../lib/developer-api.js";
import developerApiV3 from "../lib/developer-api-v3.js";
import developerApiV4 from "../lib/developer-api-v4.js";
import webhookWorker from "../lib/api-v4/webhooks.js";
import developerAuth, { isAuthenticatedProfileRequest } from "../lib/developer-auth.js";
import allianceSyncHandler from "../internal/kingshot/alliance-sync-handler.js";
import allianceSyncWorker from "../internal/kingshot/alliance-sync-worker.js";
import developerAccount from "../lib/developer-account.js";
import { isValidPlayerId, lookupPlayer, normalizePlayerId, PlayerLookupError } from "../internal/kingshot/player.js";
import { extractMightPulseAvatarFrameFromPlayerData, resolveMightPulseProfileUid, validateFrameAssetId } from "../lib/mightpulse-avatar-frame.js";
interface RequestLike { url?: string; method?: string; query?: Record<string, unknown>; headers: Record<string, string | string[] | undefined>; body?: Record<string, unknown>; }
interface ResponseLike { status(code: number): ResponseLike; json(body: unknown): ResponseLike; send(body: unknown): ResponseLike; end(body?: unknown): ResponseLike; setHeader(name: string, value: string): void; }
function sendError(res: ResponseLike, status: number, code: string, message: string, requestId: string): void { res.setHeader("X-Request-Id", requestId); res.status(status).json({ error: message, code, meta: { requestId, timestamp: new Date().toISOString() } }); }

type AvatarFrame = { assetId: string; name: string } | null;
type AvatarFrameCacheEntry = { frame: AvatarFrame; expiresAt: number };
const avatarFrameCache = new Map<string, AvatarFrameCacheEntry>();
const avatarFrameInFlight = new Map<string, Promise<AvatarFrame>>();
const AVATAR_FRAME_TIMEOUT_MS = 5000;
const MAX_AVATAR_PROFILE_BYTES = 2_000_000;
const MAX_AVATAR_FRAME_BYTES = 500_000;

function setAvatarFrameHeaders(res: ResponseLike, cacheControl: string): void {
 res.setHeader("Cache-Control", cacheControl);
 res.setHeader("X-Content-Type-Options", "nosniff");
 res.setHeader("Referrer-Policy", "no-referrer");
 res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

async function getMightPulseAvatarFrame(playerId: string, forceRefresh = false): Promise<AvatarFrame> {
 if (forceRefresh) avatarFrameCache.delete(playerId);
 const cached = avatarFrameCache.get(playerId);
 if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.frame;
 const active = avatarFrameInFlight.get(playerId);
 if (active) return active;

 const request = (async (): Promise<AvatarFrame> => {
  let frame: AvatarFrame = null;
  let ttl = 60_000;
  try {
   // The public player API maps a governor ID to MightPulse's internal UID.
   let profileUid: string | null = null;
   const hasMightPulseKey = [process.env.MIGHTPULSE_API_KEY_6, process.env.MIGHTPULSE_API_KEY_5, process.env.MIGHTPULSE_API_KEY_4, process.env.MIGHTPULSE_API_KEY_3, process.env.MIGHTPULSE_API_KEY_2, process.env.MIGHTPULSE_API_KEY].some(value => Boolean(String(value || "").trim()));
   if (hasMightPulseKey) {
    try {
     const apiUrl = "https://api.mightpulse.com/v1/players/" + encodeURIComponent(playerId) + "?include=base";
     const apiResponse = await fetchMightPulse(apiUrl, {
      headers: { Accept: "application/json" },
     }, { timeoutMs: AVATAR_FRAME_TIMEOUT_MS });
     const apiFinalUrl = new URL(apiResponse.url || apiUrl);
     const apiContentType = apiResponse.headers.get("content-type") || "";
     const apiLength = Number(apiResponse.headers.get("content-length") || 0);
     if (
      apiResponse.ok &&
      apiFinalUrl.protocol === "https:" &&
      apiFinalUrl.hostname === "api.mightpulse.com" &&
      !apiFinalUrl.port &&
      !apiFinalUrl.username &&
      !apiFinalUrl.password &&
      apiContentType.toLowerCase().includes("application/json") &&
      !(apiLength > MAX_AVATAR_PROFILE_BYTES)
     ) {
      const body = await apiResponse.text();
      if (body.length <= MAX_AVATAR_PROFILE_BYTES) {
       profileUid = resolveMightPulseProfileUid(JSON.parse(body), playerId);
      }
     }
    } catch {
     // Fall back to the public site's exact-ID search.
    }
   }

   if (!profileUid) {
    try {
     const searchUrl = "https://www.mightpulse.com/api/search?q=" + encodeURIComponent(playerId) + "&limit=40&live=0";
     const searchResponse = await fetch(searchUrl, {
      headers: {
       Accept: "application/json",
       "Accept-Language": "en-US,en;q=0.9",
       "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
       Referer: "https://www.mightpulse.com/",
      },
      signal: AbortSignal.timeout(AVATAR_FRAME_TIMEOUT_MS),
     });
     const searchFinalUrl = new URL(searchResponse.url || searchUrl);
     const searchContentType = searchResponse.headers.get("content-type") || "";
     const searchLength = Number(searchResponse.headers.get("content-length") || 0);
     if (
      searchResponse.ok &&
      searchFinalUrl.protocol === "https:" &&
      searchFinalUrl.hostname === "www.mightpulse.com" &&
      !searchFinalUrl.port &&
      !searchFinalUrl.username &&
      !searchFinalUrl.password &&
      searchContentType.toLowerCase().includes("application/json") &&
      !(searchLength > MAX_AVATAR_PROFILE_BYTES)
     ) {
      const body = await searchResponse.text();
      if (body.length <= MAX_AVATAR_PROFILE_BYTES) {
       profileUid = resolveMightPulseProfileUid(JSON.parse(body), playerId);
      }
     }
    } catch {
     // Optional decoration must never make player lookup fail.
    }
   }

   if (!profileUid) {
    ttl = 2 * 60_000;
   } else {
    // The profile HTML is only a shell; its public JSON contains the equipped skins.
    const playerDataUrl = "https://www.mightpulse.com/api/players/" + profileUid;
    const upstream = await fetch(playerDataUrl, {
     headers: {
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Referer: "https://www.mightpulse.com/",
     },
     signal: AbortSignal.timeout(AVATAR_FRAME_TIMEOUT_MS),
    });
    const finalUrl = new URL(upstream.url || playerDataUrl);
    const contentType = upstream.headers.get("content-type") || "";
    const contentLength = Number(upstream.headers.get("content-length") || 0);
    if (
     upstream.ok &&
     finalUrl.protocol === "https:" &&
     finalUrl.hostname === "www.mightpulse.com" &&
     !finalUrl.port &&
     !finalUrl.username &&
     !finalUrl.password &&
     contentType.toLowerCase().includes("application/json") &&
     !(contentLength > MAX_AVATAR_PROFILE_BYTES)
    ) {
     const body = await upstream.text();
     if (body.length <= MAX_AVATAR_PROFILE_BYTES) {
      const profile = JSON.parse(body) as Record<string, unknown>;
      const nestedProfile = profile.player && typeof profile.player === "object"
       ? profile.player as Record<string, unknown> : {};
      const returnedUid = String(profile.uid ?? nestedProfile.uid ?? "").trim();
      const returnedGovernorId = String(
       profile.fid ?? profile.governor_id ?? nestedProfile.fid ?? nestedProfile.governor_id ?? ""
      ).trim();
      // Require both IDs to match before accepting upstream-provided frame metadata.
      if (returnedUid === profileUid && returnedGovernorId === playerId) {
       frame = extractMightPulseAvatarFrameFromPlayerData(profile);
      }
     }
     ttl = frame ? 60 * 60_000 : 5 * 60_000;
    }
   }
  } catch {
   // The optional frame must never change the redemption outcome.
   ttl = 60_000;
  }
  avatarFrameCache.set(playerId, { frame, expiresAt: Date.now() + ttl });
  return frame;
 })();

 avatarFrameInFlight.set(playerId, request);
 try {
  return await request;
 } finally {
  avatarFrameInFlight.delete(playerId);
 }
}

async function serveMightPulseFrameImage(assetId: string, req: RequestLike, res: ResponseLike): Promise<void> {
 if (!rateLimit(req, res, "mightpulse-frame-image", 120, 60_000)) {
  res.status(429).end();
  return;
 }
 try {
  // The hostname and path are fixed; only a validated numeric asset ID is interpolated.
  const assetUrl = "https://www.mightpulse.com/assets/icons/skin_icon_" + assetId + ".png";
  const upstream = await fetch(assetUrl, {
   headers: { Accept: "image/png" },
   signal: AbortSignal.timeout(AVATAR_FRAME_TIMEOUT_MS),
  });
  const contentLength = Number(upstream.headers.get("content-length") || 0);
  const contentType = upstream.headers.get("content-type") || "";
  if (!upstream.ok || contentLength > MAX_AVATAR_FRAME_BYTES || !/^image\/png(?:;|$)/i.test(contentType)) {
   res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
   res.status(404).end();
   return;
  }
  const bytes = Buffer.from(await upstream.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_AVATAR_FRAME_BYTES) {
   res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
   res.status(404).end();
   return;
  }
  setAvatarFrameHeaders(res, "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000");
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", String(bytes.length));
  res.status(200).send(bytes);
 } catch {
  res.setHeader("Cache-Control", "no-store");
  res.status(404).end();
 }
}

async function handleMightPulseFrameRequest(req: RequestLike, res: ResponseLike, requestUrl: URL, requestId: string): Promise<void> {
 if (req.method && req.method.toUpperCase() !== "GET") {
  res.setHeader("Allow", "GET");
  sendError(res, 405, "method_not_allowed", "Method not allowed.", requestId);
  return;
 }
 const mode = requestUrl.searchParams.get("frame");
 if (mode === "profile") {
  if (!rateLimit(req, res, "mightpulse-frame-profile", 30, 60_000)) {
   sendError(res, 429, "rate_limit_exceeded", "Too many frame lookups. Retry shortly.", requestId);
   return;
  }
  const playerId = requestUrl.searchParams.get("id") || "";
  if (!/^\d{5,20}$/.test(playerId)) {
   sendError(res, 400, "invalid_player_id", "Player ID must contain 5–20 digits. Copy it from Kingshot under Profile → Info; your kingdom number is different.", requestId);
   return;
  }
  const forceRefresh = requestUrl.searchParams.get("refresh") === "1";
  const frame = await getMightPulseAvatarFrame(playerId, forceRefresh);
  setAvatarFrameHeaders(res, "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).json({ frame });
  return;
 }
 if (mode === "asset") {
  const assetId = validateFrameAssetId(requestUrl.searchParams.get("asset"));
  if (!assetId) {
   sendError(res, 400, "invalid_frame_asset", "Invalid frame asset.", requestId);
   return;
  }
  await serveMightPulseFrameImage(assetId, req, res);
  return;
 }
 sendError(res, 400, "invalid_frame_request", "Invalid frame request.", requestId);
}


function findAllianceRows(value: unknown, depth = 0): Record<string, any>[] {
 if (!value || typeof value !== "object" || depth > 5) return [];
 if (Array.isArray(value)) {
  const rows = value.filter((item): item is Record<string, any> => Boolean(
   item && typeof item === "object" && (item.abbr != null || item.tag != null) &&
   (item.name != null || item.alliance_name != null || item.power != null || item.score != null)
  ));
  if (rows.length) return rows;
  for (const item of value) {
   const nested = findAllianceRows(item, depth + 1);
   if (nested.length) return nested;
  }
  return [];
 }
 for (const nestedValue of Object.values(value as Record<string, unknown>)) {
  const nested = findAllianceRows(nestedValue, depth + 1);
  if (nested.length) return nested;
 }
 return [];
}

async function handleAllianceLookup(req: RequestLike, res: ResponseLike): Promise<void> {
 // Alliance discovery and public roster lookup are read-only and do not require sign-in.
 if (req.method && req.method.toUpperCase() !== "GET") {
  res.setHeader("Allow", "GET");
  res.status(405).json({ error: "Method not allowed." });
  return;
 }
 if (!rateLimit(req, res, "alliance-lookup", 20, 60_000)) {
  res.status(429).json({ error: "Too many alliance lookups. Please wait before trying again.", code: "rate_limit_exceeded" });
  return;
 }
 res.setHeader("Cache-Control", "private, no-store");
 const url = new URL(req.url || "/", "http://localhost");
 const param = (key: string) => String(req.query?.[key] ?? url.searchParams.get(key) ?? "").trim();
 const kingdomId = param("kingdomId").slice(0, 10);
 const tag = param("tag").slice(0, 20);
 const mode = param("mode");
 const discordFastPath = param("discordFastPath") === "1";
 const allianceRequestOptions = discordFastPath
  ? { timeoutMs: 10_000, fastPath: true, maxAttempts: 2, totalTimeoutMs: 18_000 }
  : { timeoutMs: 20_000 };
 if (mode === "registration-status") {
  const rawIds = param("ids").split(",").map(value => value.trim()).filter(Boolean);
  const ids = [...new Set(rawIds)].filter(id => /^\d{5,20}$/.test(id)).slice(0, 200);
  if (!ids.length || ids.length !== [...new Set(rawIds)].length) {
   res.status(400).json({ error: "Provide up to 200 valid Player IDs.", code: "invalid_player_ids" });
   return;
  }
  const supabaseUrl = String(process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co").replace(/\/$/, "");
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();
  if (!serviceKey) {
   res.status(503).json({ error: "Registration status is temporarily unavailable. No members were made selectable.", code: "registration_status_unavailable" });
   return;
  }
  const query = new URLSearchParams({ select: "player_id", player_id: "in.(" + ids.join(",") + ")" });
  const statusResponse = await fetch(supabaseUrl + "/rest/v1/kingshot_autoredeem?" + query.toString(), {
   method: "GET",
   headers: { apikey: serviceKey, authorization: "Bearer " + serviceKey, Accept: "application/json" },
   signal: AbortSignal.timeout(10_000)
  });
  if (!statusResponse.ok) {
   res.status(503).json({ error: "Could not verify existing registrations. Please refresh and try again.", code: "registration_status_unavailable" });
   return;
  }
  const rows = await statusResponse.json().catch(() => null);
  if (!Array.isArray(rows)) {
   res.status(503).json({ error: "Could not verify existing registrations. Please refresh and try again.", code: "registration_status_unavailable" });
   return;
  }
  res.status(200).json({ registeredIds: [...new Set(rows.map((row: Record<string, unknown>) => String(row.player_id || "")).filter(id => ids.includes(id)))] });
  return;
 }
 if (!/^\d{1,10}$/.test(kingdomId)) {
  res.status(400).json({ error: "Enter a numeric kingdom ID.", code: "invalid_kingdom_id" });
  return;
 }

 try {
  if (mode === "search") {
   const upstreamUrl = "https://api.mightpulse.com/v1/kingdoms/" + encodeURIComponent(kingdomId) + "/ranks?board=alliance_power&limit=100";
   const upstream = await fetchMightPulse(upstreamUrl, { headers: { Accept: "application/json" } }, allianceRequestOptions);
   const body = await upstream.json().catch(() => ({})) as Record<string, any>;
   if (!upstream.ok) {
    if (upstream.status === 404) {
     res.status(404).json({ error: "That kingdom was not found in the alliance rankings.", code: "kingdom_not_found" });
     return;
    }
    if (upstream.status === 429) {
     res.status(429).json({ error: "The game data provider is busy. Please wait a moment and try again.", code: "provider_rate_limited" });
     return;
    }
    res.status(502).json({ error: "Alliance rankings are temporarily unavailable. Please try again shortly.", code: "provider_unavailable" });
    return;
   }
   const rows = findAllianceRows(body);
   const alliances = rows.flatMap((row, index) => {
    const allianceTag = String(row.abbr ?? row.tag ?? row.alliance_tag ?? "").trim().slice(0, 20);
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(allianceTag)) return [];
    const name = String(row.name ?? row.alliance_name ?? allianceTag).trim().slice(0, 80) || allianceTag;
    const powerRaw = row.power ?? row.score ?? row.alliance_power;
    const countRaw = row.member_count ?? row.memberCount ?? row.count;
    const flagRaw = row.flag_url ?? row.flagUrl ?? row.flag ?? row.icon_url ?? row.iconUrl ?? row.image_url ?? row.imageUrl ?? row.logo_url ?? row.logoUrl ?? row.emblem_url ?? row.emblemUrl ?? "";
    const flag = typeof flagRaw === "string" ? flagRaw.trim() : String((flagRaw && typeof flagRaw === "object" ? flagRaw.url ?? flagRaw.src ?? flagRaw.image ?? "" : "")).trim();
    let normalizedFlag = "";
    if (flag) {
     try {
      const candidate = new URL(flag, "https://www.mightpulse.com/");
      if (candidate.protocol === "https:" && !candidate.username && !candidate.password) normalizedFlag = candidate.href;
     } catch { /* Ignore malformed optional alliance artwork. */ }
    }
    return [{
     name, tag: allianceTag, kingdomId: String(row.kid ?? kingdomId),
     power: powerRaw == null || !Number.isFinite(Number(powerRaw)) ? null : Number(powerRaw),
     memberCount: countRaw == null || !Number.isFinite(Number(countRaw)) ? null : Number(countRaw),
     leaderName: String(row.leader_name ?? row.leaderName ?? "").trim().slice(0, 80),
     flagUrl: normalizedFlag,
     rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : index + 1
    }];
   });
   const needle = param("q").toLocaleLowerCase();
   const matches = needle ? alliances.filter(item => (item.name + " " + item.tag).toLocaleLowerCase().includes(needle)) : alliances;
   res.status(200).json({
    alliances: matches,
    totalReturned: alliances.length,
    limitedToTop: 100,
    sourceFresh: typeof body.fresh === "boolean" ? body.fresh : null,
    cachedAt: typeof body.cached_at === "string" ? body.cached_at : null,
    ageSeconds: Number.isFinite(Number(body.age_seconds)) ? Number(body.age_seconds) : null
   });
   return;
  }

  if (!/^[A-Za-z0-9_-]{1,20}$/.test(tag)) {
   res.status(400).json({ error: "Enter the exact alliance tag/abbreviation shown in Kingshot.", code: "invalid_alliance_tag" });
   return;
  }
  const upstreamUrl = "https://api.mightpulse.com/v1/alliances/" + encodeURIComponent(kingdomId) + "/" + encodeURIComponent(tag) + "?include=info,roster";
  const upstream = await fetchMightPulse(upstreamUrl, { headers: { Accept: "application/json" } }, allianceRequestOptions);
  const body = await upstream.json().catch(() => ({})) as Record<string, any>;
  if (!upstream.ok) {
   if (upstream.status === 404) {
    res.status(404).json({ error: "No alliance was found for that kingdom and tag. Check both values and try again.", code: "alliance_not_found" });
    return;
   }
   if (upstream.status === 429) {
    res.status(429).json({ error: "The game data provider is busy. Please wait a moment and try again.", code: "provider_rate_limited" });
    return;
   }
   res.status(502).json({ error: "Alliance data is temporarily unavailable. Please try again shortly.", code: "provider_unavailable" });
   return;
  }
  const source = body.data && typeof body.data === "object" ? body.data : body;
  const alliance = source.alliance ?? source;
  const rawMembers = Array.isArray(source.members) ? source.members
   : Array.isArray(source.roster) ? source.roster
   : Array.isArray(alliance.members) ? alliance.members : [];
  const members = rawMembers.flatMap((member: Record<string, any>) => {
   const playerId = String(member.governor_id ?? member.fid ?? "").trim();
   if (!/^\d{5,20}$/.test(playerId)) return [];
   const avatarUrl = String(member.avatar_url ?? member.avatarUrl ?? "").trim();
   return [{
    playerId,
    name: String(member.nick_name ?? member.name ?? member.nickname ?? "Kingshot Player").trim().slice(0, 80) || "Kingshot Player",
    power: member.power == null || !Number.isFinite(Number(member.power)) ? null : Number(member.power),
    townCenterLevel: member.town_center_level == null || !Number.isFinite(Number(member.town_center_level)) ? null : Number(member.town_center_level),
    avatarUrl: /^https:\/\//i.test(avatarUrl) ? avatarUrl : "",
    allianceRank: String(member.alliance_rank_label ?? member.alliance_rank ?? "").trim().slice(0, 30),
    kingdomId: String(member.kid ?? kingdomId)
   }];
  });
  const allianceTag = String(alliance.abbr ?? alliance.tag ?? tag).trim().slice(0, 20) || tag;
  res.status(200).json({
   alliance: {
    name: String(alliance.name ?? alliance.alliance_name ?? tag).trim().slice(0, 80) || tag,
    tag: allianceTag,
    kingdomId,
    power: alliance.power == null || !Number.isFinite(Number(alliance.power)) ? null : Number(alliance.power),
    count: Number.isFinite(Number(alliance.count)) ? Number(alliance.count) : members.length,
    memberCount: Number.isFinite(Number(alliance.count)) ? Number(alliance.count) : members.length,
    leaderName: String(alliance.leader_name ?? "").trim().slice(0, 80)
   },
   members,
   stale: body.fresh === false || Boolean(body.stale),
   fresh: typeof body.fresh === "boolean" ? body.fresh : null,
   fetchedAt: typeof body.cached_at === "string" ? body.cached_at : null,
   ageSeconds: Number.isFinite(Number(body.age_seconds)) ? Number(body.age_seconds) : null
  });
 } catch (error) {
  const typed = error as { status?: number; message?: string };
  if (typed.status === 429) {
   res.status(429).json({ error: "The game data provider is busy. Please wait a moment and try again.", code: "provider_rate_limited" });
   return;
  }
  res.status(502).json({ error: "Could not reach the alliance data provider. Please try again shortly.", code: "provider_unavailable" });
 }
}



async function loadPlayerContext(player: Record<string, any>, fast = false): Promise<Record<string, any>> {
 const kid = String(player.kid ?? "").trim();
 const allianceTag = String(player.alliance?.abbr ?? "").trim();
 const kingdomRequest = /^\d{1,10}$/.test(kid)
  ? fetchMightPulse("https://api.mightpulse.com/v1/kingdoms/" + encodeURIComponent(kid) + "?include=boards&limit=100", { headers: { Accept: "application/json" } }, { timeoutMs: fast ? 3000 : 7000, totalTimeoutMs: fast ? 4000 : 10000, fastPath: true, maxAttempts: 1 }).then(async response => {
    const body = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok) throw Object.assign(new Error("Kingdom context unavailable."), { status: response.status });
    const data = body.kingdom && typeof body.kingdom === "object" ? body.kingdom
     : body.data?.kingdom && typeof body.data.kingdom === "object" ? body.data.kingdom
     : body.data && typeof body.data === "object" ? body.data : body;
    const playerIds = new Set([String(player.governor_id ?? player.fid ?? ""), String(player.uid ?? "")].filter(Boolean));
    const boardRanks: Array<{ board: string; rank: number | null; score: number | null }> = [];
    const visitBoards = (value: any, boardName = "", depth = 0): void => {
     if (!value || typeof value !== "object" || depth > 7) return;
     if (Array.isArray(value)) {
      value.forEach((row: any, index: number) => {
       if (row && typeof row === "object") {
        const id = String(row.governor_id ?? row.fid ?? row.uid ?? "");
        if (playerIds.has(id)) {
         const scoreRaw = row.score ?? row.value ?? row.power;
         const rankRaw = row.rank ?? row.kingdom_rank ?? row.position ?? index + 1;
         boardRanks.push({
          board: String(row.board ?? row.board_name ?? row.type ?? row.label ?? boardName ?? "Kingdom leaderboard").slice(0, 60),
          rank: Number.isFinite(Number(rankRaw)) ? Number(rankRaw) : null,
          score: scoreRaw == null || !Number.isFinite(Number(scoreRaw)) ? null : Number(scoreRaw)
         });
        } else visitBoards(row, String(row.name ?? row.key ?? boardName), depth + 1);
       }
      });
      return;
     }
     const nestedName = String(value.board ?? value.board_name ?? value.type ?? value.label ?? value.name ?? value.key ?? boardName);
     for (const [key, nested] of Object.entries(value)) visitBoards(nested, Array.isArray(nested) ? (nestedName || key) : nestedName, depth + 1);
    };
    visitBoards(body.boards ?? body.data?.boards ?? data.boards ?? body.leaderboards ?? body.data?.leaderboards ?? []);
    const uniqueBoardRanks = [...new Map(boardRanks.map(item => [item.board.toLowerCase(), item])).values()].slice(0, 30);
    return { data, board_ranks: uniqueBoardRanks, fresh: typeof body.fresh === "boolean" ? body.fresh : null, age_seconds: Number.isFinite(Number(body.age_seconds)) ? Number(body.age_seconds) : null, cached_at: typeof body.cached_at === "string" ? body.cached_at : null };
   })
  : Promise.resolve(null);
 const allianceRequest = /^\d{1,10}$/.test(kid) && /^[A-Za-z0-9_-]{1,20}$/.test(allianceTag)
  ? fetchMightPulse("https://api.mightpulse.com/v1/alliances/" + encodeURIComponent(kid) + "/" + encodeURIComponent(allianceTag) + "?include=info,roster", { headers: { Accept: "application/json" } }, { timeoutMs: fast ? 3500 : 8000, totalTimeoutMs: fast ? 4500 : 11000, fastPath: true, maxAttempts: 1 }).then(async response => {
    const body = await response.json().catch(() => ({})) as Record<string, any>;
    if (!response.ok) throw Object.assign(new Error("Alliance roster unavailable."), { status: response.status });
    const source = body.data && typeof body.data === "object" ? body.data : body;
    const raw = Array.isArray(source.members) ? source.members : Array.isArray(source.roster) ? source.roster : Array.isArray(source.alliance?.members) ? source.alliance.members : [];
    const members = raw.flatMap((member: Record<string, any>) => {
     const governorId = String(member.governor_id ?? member.fid ?? "").trim();
     if (!/^\d{5,20}$/.test(governorId)) return [];
     return [{
      governor_id: governorId,
      name: String(member.nick_name ?? member.name ?? member.nickname ?? "Kingshot Player").trim().slice(0, 80),
      power: member.power == null || !Number.isFinite(Number(member.power)) ? null : Number(member.power),
      town_center_level: member.town_center_level == null || !Number.isFinite(Number(member.town_center_level)) ? null : Number(member.town_center_level),
      kills: member.kills == null || !Number.isFinite(Number(member.kills)) ? null : Number(member.kills),
      alliance_rank: String(member.alliance_rank_label ?? member.alliance_rank ?? "").trim().slice(0, 30),
      avatar_url: /^https:\/\//i.test(String(member.avatar_url ?? "")) ? String(member.avatar_url) : ""
     }];
    });
    members.sort((a: any,b: any) => (b.power ?? -1) - (a.power ?? -1));
    const position = members.findIndex((member: any) => member.governor_id === String(player.governor_id ?? player.fid ?? ""));
    return { members: members.slice(0, 8), total: raw.length, player_power_rank: position < 0 ? null : position + 1, fresh: typeof body.fresh === "boolean" ? body.fresh : null, age_seconds: Number.isFinite(Number(body.age_seconds)) ? Number(body.age_seconds) : null, cached_at: typeof body.cached_at === "string" ? body.cached_at : null };
   })
  : Promise.resolve(null);
 const [kingdomResult, allianceResult] = await Promise.allSettled([kingdomRequest, allianceRequest]);
 return {
  kingdom: kingdomResult.status === "fulfilled" ? kingdomResult.value?.data ?? null : null,
  kingdom_board_ranks: kingdomResult.status === "fulfilled" ? kingdomResult.value?.board_ranks ?? [] : [],
  kingdom_meta: kingdomResult.status === "fulfilled" && kingdomResult.value ? { fresh: kingdomResult.value.fresh, age_seconds: kingdomResult.value.age_seconds, cached_at: kingdomResult.value.cached_at } : null,
  alliance_roster: allianceResult.status === "fulfilled" ? allianceResult.value : null
 };
}

const detailedProfileCache = new Map<string, { value: Record<string, any>; expiresAt: number }>();
const detailedProfileInFlight = new Map<string, Promise<Record<string, any>>>();
const DETAILED_PROFILE_CACHE_MS = 2 * 60_000;

async function loadDetailedPlayerProfile(playerId: string, player: Record<string, any>): Promise<Record<string, any>> {
 const cached = detailedProfileCache.get(playerId);
 if (cached && cached.expiresAt > Date.now()) return cached.value;
 const active = detailedProfileInFlight.get(playerId);
 if (active) return active;
 const request = (async () => {
  // The base profile is already available. Treat heroes, gear and kingdom context
  // as optional enrichments and cap their wait so a slow refresh cannot blank the page.
  const endpoint = "https://api.mightpulse.com/v1/players/" + encodeURIComponent(playerId) + "?include=heroes,ranks,gov_gear";
  const [detailsResult, contextResult] = await Promise.allSettled([
   fetchMightPulse(endpoint, { headers: { Accept: "application/json" } }, {
    timeoutMs: 6500, totalTimeoutMs: 8000, fastPath: true, maxAttempts: 1
   }).then(async upstream => {
    const body = await upstream.json().catch(() => ({})) as Record<string, any>;
    if (!upstream.ok) throw Object.assign(new Error("Optional player details are unavailable."), { status: upstream.status });
    if (body.player && String(body.player.governor_id ?? body.player.fid ?? "") !== playerId) {
     throw Object.assign(new Error("MightPulse returned a mismatched player profile."), { status: 502 });
    }
    return body;
   }),
   loadPlayerContext(player, true)
  ]);
  const body = detailsResult.status === "fulfilled" ? detailsResult.value : {};
  const context = contextResult.status === "fulfilled" ? contextResult.value : {
   kingdom: null, kingdom_board_ranks: [], kingdom_meta: null, alliance_roster: null
  };
  const result = {
   ok: true,
   player,
   ...context,
   heroes: Array.isArray(body.heroes) ? body.heroes : [],
   ranks: body.ranks && typeof body.ranks === "object" ? body.ranks : null,
   gov_gear: body.gov_gear && typeof body.gov_gear === "object" ? body.gov_gear : null,
   fresh: typeof body.fresh === "boolean" ? body.fresh : null,
   cached_at: typeof body.cached_at === "string" ? body.cached_at : null,
   age_seconds: Number.isFinite(Number(body.age_seconds)) ? Number(body.age_seconds) : null,
   include: Array.isArray(body.include) ? body.include : ["heroes", "ranks", "gov_gear"],
   source: "mightpulse",
   extras_available: detailsResult.status === "fulfilled",
   extras_error: detailsResult.status === "rejected" ? "Some extended player details could not be refreshed. The public profile is still available." : null
  };
  detailedProfileCache.set(playerId, { value: result, expiresAt: Date.now() + DETAILED_PROFILE_CACHE_MS });
  return result;
 })();
 detailedProfileInFlight.set(playerId, request);
 try { return await request; }
 finally { detailedProfileInFlight.delete(playerId); }
}

async function handleDetailedPlayerProfile(req: RequestLike, res: ResponseLike, requestUrl: URL, requestId: string): Promise<void> {
 if (req.method && req.method.toUpperCase() !== "GET") {
  res.setHeader("Allow", "GET");
  sendError(res, 405, "method_not_allowed", "Method not allowed.", requestId);
  return;
 }
 if (!rateLimit(req, res, "detailed-player-profile", 12, 60_000)) {
  sendError(res, 429, "rate_limit_exceeded", "Too many detailed profile lookups. Please wait before trying again.", requestId);
  return;
 }
 const playerId = normalizePlayerId(requestUrl.searchParams.get("id"));
 if (!isValidPlayerId(playerId)) {
  sendError(res, 400, "invalid_player_id", "Player ID must contain 5–20 digits.", requestId);
  return;
 }
 try {
  const player = await lookupPlayer(playerId);
  if (String(player.governor_id ?? player.fid ?? "") !== playerId) {
   sendError(res, 502, "profile_mismatch", "The provider returned a different player ID.", requestId);
   return;
  }
  const profile = await loadDetailedPlayerProfile(playerId, player);
  res.setHeader("Cache-Control", "public, max-age=30, s-maxage=60, stale-while-revalidate=180");
  res.setHeader("X-Request-Id", requestId);
  res.status(200).json({ ...profile, meta: { requestId, timestamp: new Date().toISOString() } });
 } catch (error) {
  const status = Number((error as any)?.status) || 502;
  if (status === 404) {
   sendError(res, 404, "player_not_found", "No Kingshot player was found for this ID.", requestId);
   return;
  }
  if (status === 429) {
   sendError(res, 429, "provider_rate_limited", "The game data provider is busy. Please wait a moment and try again.", requestId);
   return;
  }
  if (status === 504 || /timed out|deadline|abort/i.test(String((error as any)?.message || ""))) {
   sendError(res, 504, "upstream_timeout", "The basic player lookup timed out. Please retry in a moment.", requestId);
   return;
  }
  sendError(res, status === 503 ? 503 : 502, "profile_unavailable", "The basic player lookup is temporarily unavailable.", requestId);
 }
}

export default async function handler(req: RequestLike, res: ResponseLike): Promise<void> {
 const requestId = globalThis.crypto?.randomUUID?.() || `req-${Date.now().toString(36)}`;
 res.setHeader("X-Request-Id", requestId);
 const requestUrl = new URL(req.url || "/", "http://localhost");
 if (requestUrl.searchParams.get("milestone") === "count") {
  if (req.method && req.method.toUpperCase() !== "GET") { res.setHeader("Allow", "GET"); return void res.status(405).json({ error: "Method not allowed." }); }
  const base = String(process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co").replace(/\\/$/, "");
  try {
   const response = await fetch(base + "/rest/v1/rpc/kingshot_public_registration_count", { method: "POST", headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "", authorization: "Bearer " + (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ""), "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(5000) });
   if (!response.ok) throw Error("Count unavailable");
   const value = Number(await response.json());
   if (!Number.isSafeInteger(value) || value < 0) throw Error("Invalid count");
   res.setHeader("Cache-Control", "public, max-age=30, s-maxage=30, stale-while-revalidate=60");
   return void res.status(200).json({ registeredIds: value, milestone: 1000, remaining: Math.max(0, 1000 - value) });
  } catch { res.setHeader("Cache-Control", "no-store"); return void res.status(503).json({ error: "Registration count is temporarily unavailable." }); }
 }

 const developerPath = String(req.query?.developerPath || requestUrl.searchParams.get("developerPath") || req.query?.developer || requestUrl.searchParams.get("developer") || "").replace(/^\/+|\/+$/g, "");
 if (developerPath === "alliance-sync") { await allianceSyncHandler(req as any, res as any); return; }
 if (developerPath === "alliance-sync-worker") return allianceSyncWorker(req as any, res as any);
 if (developerPath === "v4-webhook-worker") return webhookWorker(req as any, res as any);
 if (developerPath === "alliance-lookup") return handleAllianceLookup(req, res);
 if (developerPath === "account-auth") return developerAuth(req, res);
 if (developerPath === "account-keys") return developerAccount(req, res);
 if (developerPath.startsWith("v3-")) return developerApiV3(req, res, developerPath.slice(3));
 if (developerPath.startsWith("v4-")) return developerApiV4(req, res, developerPath.slice(3));
 if (developerPath) return developerApi(req, res, developerPath);
 if (requestUrl.searchParams.get("profile") === "detail") return handleDetailedPlayerProfile(req, res, requestUrl, requestId);
 if (requestUrl.searchParams.has("frame")) return handleMightPulseFrameRequest(req, res, requestUrl, requestId);
 if (req.method !== "GET") { res.setHeader("Allow", "GET"); return void sendError(res, 405, "method_not_allowed", "Method not allowed.", requestId); }
 if (!rateLimit(req, res, "player-lookup", 30, 60000)) return void sendError(res, 429, "rate_limit_exceeded", "Too many player lookups. Retry after the indicated delay.", requestId);
 const id = normalizePlayerId(new URL(req.url || "/", "http://localhost").searchParams.get("id"));
 if (!isValidPlayerId(id)) return void sendError(res, 400, "invalid_player_id", "Player ID must contain 5–20 digits. Copy it from Kingshot under Profile → Info; your kingdom number is different.", requestId);
 try { const player = await lookupPlayer(id); res.status(200).json({ player, data: { player }, meta: { requestId, timestamp: new Date().toISOString(), fetchedAt: new Date().toISOString(), source: "mightpulse", stale: false } }); }
 catch (error) { const typed = error as PlayerLookupError;
  if (typed.status === 404) return void sendError(res, 404, "player_not_found", "No player was found for this ID. Check it under Kingshot Profile → Info; if the ID is correct, try again shortly.", requestId);
  if (/timed out|abort/i.test(typed.message || "")) return void sendError(res, 504, "upstream_timeout", "MightPulse request timed out.", requestId);
  sendError(res, typed.status === 503 ? 503 : 502, "upstream_unavailable", "Player lookup provider is unavailable.", requestId);
 }
}
