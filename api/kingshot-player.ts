import { rateLimit } from "../lib/request-rate-limit.js";
import developerApi from "../lib/developer-api.js";
import developerApiV3 from "../lib/developer-api-v3.js";
import developerAuth from "../lib/developer-auth.js";
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
   const apiKey = process.env.MIGHTPULSE_API_KEY_3 || process.env.MIGHTPULSE_API_KEY_2 || process.env.MIGHTPULSE_API_KEY || process.env.KSS_API_KEY;
   if (apiKey) {
    try {
     const apiUrl = "https://api.mightpulse.com/v1/players/" + encodeURIComponent(playerId) + "?include=base";
     const apiResponse = await fetch(apiUrl, {
      headers: { Accept: "application/json", Authorization: "Bearer " + apiKey },
      signal: AbortSignal.timeout(AVATAR_FRAME_TIMEOUT_MS),
     });
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
   sendError(res, 400, "invalid_player_id", "Player ID must contain 5–20 digits.", requestId);
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

export default async function handler(req: RequestLike, res: ResponseLike): Promise<void> {
 const requestId = globalThis.crypto?.randomUUID?.() || `req-${Date.now().toString(36)}`;
 res.setHeader("X-Request-Id", requestId);
 const requestUrl = new URL(req.url || "/", "http://localhost");
 const developerPath = String(req.query?.developerPath || requestUrl.searchParams.get("developerPath") || req.query?.developer || requestUrl.searchParams.get("developer") || "").replace(/^\/+|\/+$/g, "");
 if (developerPath === "account-auth") return developerAuth(req, res);
 if (developerPath === "account-keys") return developerAccount(req, res);
 if (developerPath.startsWith("v3-")) return developerApiV3(req, res, developerPath.slice(3));
 if (developerPath) return developerApi(req, res, developerPath);
 if (requestUrl.searchParams.has("frame")) return handleMightPulseFrameRequest(req, res, requestUrl, requestId);
 if (req.method !== "GET") { res.setHeader("Allow", "GET"); return void sendError(res, 405, "method_not_allowed", "Method not allowed.", requestId); }
 if (!rateLimit(req, res, "player-lookup", 30, 60000)) return void sendError(res, 429, "rate_limit_exceeded", "Too many player lookups. Retry after the indicated delay.", requestId);
 const id = normalizePlayerId(new URL(req.url || "/", "http://localhost").searchParams.get("id"));
 if (!isValidPlayerId(id)) return void sendError(res, 400, "invalid_player_id", "Player ID must contain 5–20 digits.", requestId);
 try { const player = await lookupPlayer(id); res.status(200).json({ player, data: { player }, meta: { requestId, timestamp: new Date().toISOString(), fetchedAt: new Date().toISOString(), source: "mightpulse", stale: false } }); }
 catch (error) { const typed = error as PlayerLookupError;
  if (typed.status === 404) return void sendError(res, 404, "player_not_found", "MightPulse could not find this player.", requestId);
  if (/timed out|abort/i.test(typed.message || "")) return void sendError(res, 504, "upstream_timeout", "MightPulse request timed out.", requestId);
  sendError(res, typed.status === 503 ? 503 : 502, "upstream_unavailable", "Player lookup provider is unavailable.", requestId);
 }
}
