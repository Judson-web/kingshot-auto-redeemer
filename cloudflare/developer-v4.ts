import { fetchMightPulseNative, mightPulsePlayerErrorStatus } from "./mightpulse.js";

interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  MIGHTPULSE_API_KEY?: string;
  MIGHTPULSE_API_KEY_2?: string;
  MIGHTPULSE_API_KEY_3?: string;
  MIGHTPULSE_API_KEY_4?: string;
  MIGHTPULSE_API_KEY_5?: string;
  MIGHTPULSE_API_KEY_6?: string;
}

const DEVELOPER = {
  name: "Judson",
  discord: "@judson00713",
  url: "https://discord.com/users/871756466900598815",
};

const DEFAULT_SCOPES = [
  "players:read", "alliances:read", "redemptions:write",
  "redemptions:read", "webhooks:manage", "usage:read",
];

function headers(methods: string): Headers {
  return new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "X-API-Version": "4",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": methods + ", OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
    "Access-Control-Expose-Headers": "X-Request-Id, X-API-Version, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Daily-Limit, X-RateLimit-Daily-Remaining, Retry-After, Idempotency-Replayed",
    "Vary": "Origin",
  });
}

function response(status: number, data: unknown, error: unknown, requestId: string, extra: Record<string, unknown> = {}, responseHeaders?: Headers): Response {
  const h = responseHeaders || headers("GET");
  h.set("X-Request-Id", requestId);
  h.set("X-API-Version", "4");
  return Response.json({
    success: status >= 200 && status < 300 && error == null,
    data: error == null ? data : null,
    error: error == null ? null : error,
    meta: { apiVersion: "4", requestId, timestamp: new Date().toISOString(), ...extra },
    dev: DEVELOPER,
  }, { status, headers: h });
}

function retryHint(status: number, code: string): { retryable: boolean; retryHint: string } {
  if (status === 429) return { retryable: true, retryHint: "honor_retry_after" };
  if ([502, 503, 504].includes(status) && !["player_not_found", "invalid_player_id"].includes(code)) {
    return { retryable: true, retryHint: "bounded_backoff" };
  }
  return { retryable: false, retryHint: "do_not_retry" };
}

function fail(status: number, code: string, message: string, requestId: string, meta: Record<string, unknown> = {}, h?: Headers): Response {
  return response(status, null, { code, message, ...retryHint(status, code) }, requestId, meta, h);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

function playerData(player: Record<string, any>, requestedId: string) {
  const rawId = String(player.player_id ?? player.governor_id ?? player.fid ?? player.id ?? requestedId).trim();
  if (rawId !== requestedId) throw new Error("provider_player_mismatch");
  const number = (value: unknown): number | null => {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const parsed = Number(String(value).replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const alliance = player.alliance && typeof player.alliance === "object" && !Array.isArray(player.alliance)
    ? player.alliance : {};
  const first = (...values: unknown[]) => values.find(value => typeof value === "string" && value.trim()) as string | undefined;
  const safeUrl = first(player.avatar_url, player.avatar, player.avatarUrl);
  let avatarUrl: string | null = null;
  if (safeUrl) {
    try { const parsed = new URL(safeUrl); if (parsed.protocol === "https:") avatarUrl = parsed.toString().slice(0, 500); } catch {}
  }
  return {
    playerId: requestedId,
    name: (first(player.nick_name, player.name, player.nickname) || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) || null,
    kingdomId: /^\d{1,10}$/.test(String(player.kid ?? player.kingdom_id ?? "")) ? String(player.kid ?? player.kingdom_id) : null,
    power: number(player.power),
    townCenterLevel: number(player.town_center_level ?? player.tc_level ?? player.townCenterLevel),
    avatarUrl,
    allianceName: first(alliance.name, alliance.alliance_name, player.alliance_name, player.allianceName,
      typeof player.alliance === "string" ? player.alliance : "", player.guild_name) || null,
    allianceTag: first(alliance.abbr, alliance.tag, alliance.abbreviation, alliance.short_name,
      player.alliance_abbr, player.allianceAbbr, player.alliance_tag, player.allianceTag) || null,
  };
}

async function authorize(request: Request, env: Env, requestId: string, h: Headers): Promise<{ keyId: string; scopes: string[] } | Response> {
  const authorization = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+(ks_live_[a-f0-9]{64})$/.exec(authorization.trim());
  if (!match) {
    h.set("WWW-Authenticate", "Bearer");
    return fail(401, "missing_api_key", "A valid developer Bearer API key is required.", requestId, {}, h);
  }
  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (!ip || ip.length > 64) return fail(503, "client_ip_unavailable", "The trusted client IP is unavailable; the request cannot be authorized safely.", requestId, {}, h);
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const secret = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!base || !secret) return fail(503, "service_not_configured", "The developer API is not configured on the server.", requestId, {}, h);
  try {
    const [keyHash, ipHash] = await Promise.all([sha256(match[1]), sha256(ip)]);
    const result = await fetch(base + "/rest/v1/rpc/kingshot_developer_authorize_key", {
      method: "POST",
      headers: { apikey: secret, authorization: "Bearer " + secret, "content-type": "application/json" },
      body: JSON.stringify({ p_key_hash: keyHash, p_ip_hash: ipHash }),
      signal: AbortSignal.timeout(2200),
    });
    const body: any = await result.json().catch(() => null);
    if (!result.ok || !body || typeof body !== "object" || Array.isArray(body)) {
      return fail(503, "authorization_unavailable", "The developer authorization service is temporarily unavailable.", requestId, {}, h);
    }
    const limit = Number(body.limit), remaining = Number(body.remaining), dailyRemaining = Number(body.daily_remaining);
    if (Number.isFinite(limit)) h.set("X-RateLimit-Limit", String(limit));
    if (Number.isFinite(remaining)) h.set("X-RateLimit-Remaining", String(remaining));
    h.set("X-RateLimit-Daily-Limit", "1000");
    if (Number.isFinite(dailyRemaining)) h.set("X-RateLimit-Daily-Remaining", String(dailyRemaining));
    if (typeof body.reset_at === "string") {
      const reset = Date.parse(body.reset_at);
      if (Number.isFinite(reset)) {
        h.set("X-RateLimit-Reset", String(Math.ceil(reset / 1000)));
        if (body.allowed !== true) h.set("Retry-After", String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))));
      }
    }
    if (body.allowed !== true) {
      const reason = String(body.reason || "");
      if (reason === "invalid_api_key") {
        h.set("WWW-Authenticate", "Bearer");
        return fail(401, "invalid_api_key", "The API key is invalid or has been revoked.", requestId, {}, h);
      }
      if (reason === "client_ip_unavailable") return fail(503, "client_ip_unavailable", "The trusted client IP is unavailable.", requestId, {}, h);
      return fail(429, "rate_limit_exceeded", "The per-key or per-IP request limit has been reached.", requestId, {
        reason: reason || "quota_exceeded",
        resetAt: typeof body.reset_at === "string" ? body.reset_at : undefined,
      }, h);
    }
    return {
      keyId: String(body.key_id || ""),
      scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : DEFAULT_SCOPES,
    };
  } catch {
    return fail(503, "authorization_unavailable", "The developer authorization service is temporarily unavailable.", requestId, {}, h);
  }
}

export async function handleNativeV4(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const requestId = crypto.randomUUID();
  const match = /^\/api\/v4\/players\/(\d{5,20})\/?$/.exec(url.pathname);
  const isPlayer = Boolean(match);
  const method = request.method.toUpperCase();
  const methods = isPlayer ? "GET" : "GET, POST, DELETE";
  const h = headers(methods);

  if (method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (isPlayer && method !== "GET") {
    h.set("Allow", "GET, OPTIONS");
    return fail(405, "method_not_allowed", "This method is not supported for the requested V4 route.", requestId, {}, h);
  }
  if (!isPlayer) {
    return fail(501, "route_not_migrated", "This V4 route is not yet available on the native Cloudflare runtime.", requestId, {
      migrationStatus: "pending",
      documentation: "/developer-v4.md",
    }, h);
  }

  const auth = await authorize(request, env, requestId, h);
  if (auth instanceof Response) return auth;
  if (!auth.scopes.includes("players:read")) {
    return fail(403, "insufficient_scope", "This API key does not have the required scope: players:read", requestId, {}, h);
  }

  const playerId = match![1];
  try {
    const upstream = await fetchMightPulseNative(env,
      "https://api.mightpulse.com/v1/players/" + encodeURIComponent(playerId) + "?include=base",
      3400, { totalTimeoutMs: 8000, maxAttempts: 2 });
    const body: any = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      const status = upstream.status === 404 ? 404 : upstream.status === 429 ? 503 : upstream.status >= 500 ? 503 : 502;
      const code = status === 404 ? "player_not_found" : upstream.status === 429 ? "upstream_rate_limited" : "upstream_unavailable";
      return fail(status, code, status === 404 ? "No player was found for this ID." : "The player lookup provider is temporarily unavailable.", requestId, {}, h);
    }
    const source = body?.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : body;
    const player = source?.player && typeof source.player === "object" ? source.player : body?.player && typeof body.player === "object" ? body.player : source;
    if (!player || typeof player !== "object" || Array.isArray(player)) {
      return fail(502, "upstream_invalid_response", "The player lookup provider returned an invalid response.", requestId, {}, h);
    }
    let data: ReturnType<typeof playerData>;
    try { data = playerData(player, playerId); }
    catch { return fail(502, "upstream_invalid_response", "The player lookup provider returned a different player ID.", requestId, {}, h); }
    const fetchedAt = typeof body?.cached_at === "string" && Number.isFinite(Date.parse(body.cached_at)) ? body.cached_at : null;
    const age = Number(body?.age_seconds);
    return response(200, data, null, requestId, {
      fetchedAt,
      providerFresh: typeof body?.fresh === "boolean" ? body.fresh : null,
      providerAgeSeconds: Number.isFinite(age) && age >= 0 ? Math.floor(age) : null,
      stale: typeof body?.fresh === "boolean" ? !body.fresh : null,
      source: "mightpulse",
      rateLimit: {
        perMinuteLimit: Number.isFinite(Number((auth as any).limit)) ? Number((auth as any).limit) : 60,
        perMinuteRemaining: Number.isFinite(Number((auth as any).remaining)) ? Number((auth as any).remaining) : null,
        perDayLimit: 1000,
        perDayRemaining: Number.isFinite(Number((auth as any).daily_remaining)) ? Number((auth as any).daily_remaining) : null,
      },
    }, h);
  } catch (error) {
    const status = mightPulsePlayerErrorStatus(error);
    const code = status === 429 ? "upstream_rate_limited" : status === 504 ? "upstream_timeout" : "upstream_unavailable";
    return fail(status === 429 ? 503 : status, code,
      status === 504 ? "The player lookup provider timed out after a bounded retry." : "The player lookup provider is temporarily unavailable.",
      requestId, {}, h);
  }
}
