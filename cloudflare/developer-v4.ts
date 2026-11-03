import { fetchMightPulseNative, mightPulsePlayerErrorStatus } from "./mightpulse.js";
import { handleNativeRedemption } from "./redemption.js";

interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_WRITE_MODE?: string;
  V4_WEBHOOK_ENCRYPTION_KEY?: string;
  NEON_RECOVERY_DATABASE_URL?: string;
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

function retryHint(status: number, code: string, retryAfterAvailable = false): { retryable: boolean; retryHint: string } {
  if (code === "idempotency_in_progress") return { retryable: true, retryHint: "same_idempotency_key" };
  if (["idempotency_key_reused", "idempotency_record_invalid", "service_not_configured", "upstream_not_configured"].includes(code)) {
    return { retryable: false, retryHint: "do_not_retry" };
  }
  if (status === 429) return { retryable: true, retryHint: retryAfterAvailable ? "honor_retry_after" : "bounded_backoff" };
  if ([502, 503, 504].includes(status) && !["player_not_found", "invalid_player_id"].includes(code)) {
    return { retryable: true, retryHint: code === "idempotency_unavailable" ? "same_idempotency_key" : "bounded_backoff" };
  }
  return { retryable: false, retryHint: "do_not_retry" };
}

function fail(status: number, code: string, message: string, requestId: string, meta: Record<string, unknown> = {}, h?: Headers): Response {
  const headerRetry = Number(h?.get("Retry-After"));
  const metaRetry = Number(meta.retryAfterSeconds);
  const retryAfterSeconds = Number.isFinite(headerRetry) && headerRetry > 0 ? Math.ceil(headerRetry)
    : Number.isFinite(metaRetry) && metaRetry > 0 ? Math.ceil(metaRetry) : undefined;
  return response(status, null, {
    code,
    message,
    ...retryHint(status, code, Boolean(retryAfterSeconds || meta.resetAt)),
    ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
  }, requestId, meta, h);
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

async function authorize(request: Request, env: Env, requestId: string, h: Headers): Promise<{ keyId: string; scopes: string[]; rateLimit: Record<string, unknown> } | Response> {
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
      rateLimit: {
        perMinuteLimit: Number.isFinite(limit) ? limit : 60,
        perMinuteRemaining: Number.isFinite(remaining) ? remaining : null,
        perDayLimit: 1000,
        perDayRemaining: Number.isFinite(dailyRemaining) ? dailyRemaining : null,
        ...(typeof body.reset_at === "string" ? { resetAt: body.reset_at } : {}),
      },
    };
  } catch {
    return fail(503, "authorization_unavailable", "The developer authorization service is temporarily unavailable.", requestId, {}, h);
  }
}

async function database(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const secret = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!base || !secret) throw new Error("database_unconfigured");
  const result = await fetch(base + path, {
    ...init,
    headers: { apikey: secret, authorization: "Bearer " + secret, "content-type": "application/json", ...(init.headers || {}) },
    signal: init.signal || AbortSignal.timeout(6000),
  });
  const body = await result.json().catch(() => null);
  if (!result.ok) throw new Error("database_request_failed");
  return body;
}


function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function isSafeWebhookRegistrationUrl(value: string): URL | null {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const isIpv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
    const isIpv6 = host.includes(":");
    if (url.protocol !== "https:" || url.username || url.password ||
        (url.port && url.port !== "443") || isIpv4 || isIpv6 ||
        host === "localhost" || host.endsWith(".localhost") ||
        host.endsWith(".local") || host.endsWith(".internal") ||
        !host.includes(".") || host.length > 253) return null;
    return url;
  } catch { return null; }
}

async function encryptWebhookSecret(env: Env, secret: string): Promise<string> {
  const hex = String(env.V4_WEBHOOK_ENCRYPTION_KEY || "");
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("webhook_encryption_unconfigured");
  const keyBytes = new Uint8Array(hex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret)));
  const tag = encrypted.slice(encrypted.length - 16);
  const ciphertext = encrypted.slice(0, encrypted.length - 16);
  return base64Url(iv) + "." + base64Url(tag) + "." + base64Url(ciphertext);
}

async function createWebhookSecret(): Promise<string> {
  return "whsec_" + base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function boundedInteger(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}


async function handleV4Redemption(
  request: Request,
  env: Env,
  auth: { keyId: string; scopes: string[]; rateLimit: Record<string, unknown> },
  requestId: string,
  h: Headers,
): Promise<Response> {
  if ((request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/json") {
    return fail(415, "unsupported_media_type", "Content-Type must be application/json.", requestId, {}, h);
  }

  let raw: string;
  let parsed: any;
  try {
    raw = await request.clone().text();
    if (raw.length > 8192) return fail(413, "payload_too_large", "Redemption request is too large.", requestId, {}, h);
    parsed = JSON.parse(raw || "{}");
  } catch {
    return fail(400, "invalid_json", "Redemption request must be valid JSON.", requestId, {}, h);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail(400, "invalid_request_body", "Provide a JSON object containing playerId, code, and kid.", requestId, {}, h);
  }
  const allowed = new Set(["playerId", "code", "kid"]);
  if (Object.keys(parsed).some(key => !allowed.has(key))) {
    return fail(400, "unknown_fields", "The request body contains unsupported fields.", requestId, {}, h);
  }
  const playerId = typeof parsed.playerId === "string" ? parsed.playerId.trim() : "";
  const code = typeof parsed.code === "string" ? parsed.code.trim() : "";
  const kid = typeof parsed.kid === "string" ? parsed.kid.trim() : "";
  if (!/^\d{5,20}$/.test(playerId)) return fail(400, "invalid_player_id", "playerId must be a string containing 5–20 digits.", requestId, {}, h);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(code)) return fail(400, "invalid_gift_code", "code must contain 1–64 letters, digits, underscores, or hyphens.", requestId, {}, h);
  if (!/^\d{1,10}$/.test(kid)) return fail(400, "invalid_kingdom_id", "kid must be a string containing 1–10 digits.", requestId, {}, h);

  const idempotencyKey = request.headers.get("Idempotency-Key") || "";
  const hasIdempotencyKey = request.headers.has("Idempotency-Key");
  if (hasIdempotencyKey && !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
    return fail(400, "invalid_idempotency_key", "Idempotency-Key must be 8–128 safe ASCII characters and appear only once.", requestId, {}, h);
  }

  const normalizedRequest = { playerId, code, kid };
  const requestHash = await sha256(JSON.stringify(normalizedRequest));
  let keyHash = "";
  if (hasIdempotencyKey) {
    // Match the documented V4 namespace while storing only a one-way digest.
    keyHash = await sha256("v4_" + await sha256(idempotencyKey));
    let claim: any;
    try {
      claim = await database(env, "/rest/v1/rpc/kingshot_developer_v4_begin_redemption", {
        method: "POST",
        body: JSON.stringify({ p_key_id: auth.keyId, p_key_hash: keyHash, p_request_hash: requestHash }),
      });
    } catch {
      return fail(503, "idempotency_unavailable", "Durable redemption idempotency is temporarily unavailable. Do not submit this operation with a new key.", requestId, {}, h);
    }

    const state = String(claim?.state || "");
    if (state === "conflict") return fail(409, "idempotency_key_reused", "This Idempotency-Key was already used with a different request body.", requestId, {}, h);
    if (state === "in_progress") return fail(409, "idempotency_in_progress", "This keyed redemption is still processing. Retry only with the same key and identical body.", requestId, {}, h);
    if (state === "replay" || state === "unknown") {
      const storedStatus = Number(claim.response_status);
      const stored = claim.response_body;
      if (!Number.isInteger(storedStatus) || storedStatus < 100 || storedStatus > 599 ||
          !stored || typeof stored !== "object" || Array.isArray(stored)) {
        return fail(503, "idempotency_record_invalid", "The stored redemption outcome needs review. Do not submit another attempt.", requestId, {}, h);
      }
      h.set("Idempotency-Replayed", "true");
      return response(storedStatus, stored.data ?? null, stored.error ?? null, requestId,
        { ...(stored.meta && typeof stored.meta === "object" ? stored.meta : {}), rateLimit: auth.rateLimit }, h);
    }
    if (state !== "started") return fail(503, "idempotency_unavailable", "The idempotency service returned an invalid state. No redemption was submitted.", requestId, {}, h);
  }

  let upstream: Response;
  try {
    upstream = await handleNativeRedemption(request, env, { v4: true });
  } catch {
    const error = {
      code: "redemption_outcome_unknown",
      message: "The redemption adapter stopped unexpectedly. Do not submit another attempt.",
      retryable: hasIdempotencyKey,
      retryHint: hasIdempotencyKey ? "same_idempotency_key" : "do_not_retry",
    };
    const result = response(503, null, error, requestId, { rateLimit: auth.rateLimit }, h);
    if (hasIdempotencyKey) {
      try {
        const stored = await result.clone().json();
        await database(env, "/rest/v1/rpc/kingshot_developer_v4_finish_redemption", {
          method: "POST",
          body: JSON.stringify({ p_key_id: auth.keyId, p_key_hash: keyHash, p_response_status: 503, p_response_body: stored, p_outcome_unknown: true }),
        });
      } catch {}
    }
    return result;
  }

  const rawResult: any = await upstream.json().catch(() => null);
  const hasGameResult = rawResult && typeof rawResult === "object" &&
    typeof rawResult.status === "string" && typeof rawResult.ok === "boolean";
  let result: Response;
  let outcomeUnknown = false;
  let safeToRelease = false;

  if (!rawResult || typeof rawResult !== "object") {
    outcomeUnknown = true;
    result = response(503, null, {
      code: "redemption_outcome_unknown",
      message: "The redemption adapter returned no readable outcome. Do not submit another attempt.",
      retryable: hasIdempotencyKey,
      retryHint: hasIdempotencyKey ? "same_idempotency_key" : "do_not_retry",
    }, requestId, { rateLimit: auth.rateLimit }, h);
  } else if (rawResult?.errorCategory === "HTTP_RATE_LIMIT") {
    const retryAfterSeconds = Math.max(1, Math.min(3600, Number(rawResult.retryAfterSeconds) || 60));
    h.set("Retry-After", String(retryAfterSeconds));
    safeToRelease = true;
    result = fail(429, "upstream_rate_limited", "Kingshot is rate-limiting redemption requests. Retry after the supplied delay.", requestId, {
      rateLimit: auth.rateLimit,
      retryAfterSeconds,
      cooldownPersisted: rawResult.cooldownPersisted ?? null,
    }, h);
  } else if (hasGameResult) {
    result = response(200, {
      ok: rawResult.ok,
      status: rawResult.status,
      statusLabel: rawResult.statusLabel ?? null,
      message: rawResult.message ?? rawResult.error ?? "The redemption request completed.",
      errorCategory: rawResult.errorCategory ?? null,
      errCode: rawResult.errCode ?? null,
      error: rawResult.error ?? null,
      cooldownPersisted: rawResult.cooldownPersisted ?? null,
    }, null, requestId, { rateLimit: auth.rateLimit, source: "kingshot" }, h);
  } else {
    const code = String(rawResult?.code || "redemption_unavailable");
    const message = String(rawResult?.error || "The redemption request could not be completed.");
    if (code === "redemption_outcome_needs_review") {
      outcomeUnknown = true;
      result = response(503, null, {
        code: "redemption_outcome_unknown",
        message: "Kingshot may have processed this redemption, but its outcome needs review. Do not submit another attempt.",
        retryable: hasIdempotencyKey,
        retryHint: hasIdempotencyKey ? "same_idempotency_key" : "do_not_retry",
      }, requestId, { rateLimit: auth.rateLimit }, h);
    } else {
      safeToRelease = ["writes_disabled", "redemption_unavailable", "upstream_cooldown", "rate_limit_exceeded"].includes(code);
      result = fail(upstream.status, code, message, requestId, { rateLimit: auth.rateLimit }, h);
    }
  }

  if (hasIdempotencyKey) {
    try {
      if (safeToRelease) {
        const released = await database(env, "/rest/v1/rpc/kingshot_developer_v4_release_redemption", {
          method: "POST",
          body: JSON.stringify({ p_key_id: auth.keyId, p_key_hash: keyHash }),
        });
        if (released !== true) throw new Error("idempotency claim was not released");
      } else {
        const stored = await result.clone().json();
        const finished = await database(env, "/rest/v1/rpc/kingshot_developer_v4_finish_redemption", {
          method: "POST",
          body: JSON.stringify({
            p_key_id: auth.keyId,
            p_key_hash: keyHash,
            p_response_status: result.status,
            p_response_body: stored,
            p_outcome_unknown: outcomeUnknown,
          }),
        });
        if (finished !== true) throw new Error("idempotency outcome was not persisted");
      }
    } catch {
      const error = {
        code: "outcome_persistence_failed",
        message: "The redemption was handled, but its idempotency outcome could not be confirmed. Retry only with the same key and identical body.",
        retryable: true,
        retryHint: "same_idempotency_key",
      };
      return response(503, null, error, requestId, { rateLimit: auth.rateLimit }, h);
    }
  }
  return result;
}

export async function handleNativeV4(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const requestId = crypto.randomUUID();
  const playerMatch = /^\/api\/v4\/players\/(\d{5,20})\/?$/.exec(url.pathname);
  const webhookMatch = /^\/api\/v4\/webhooks\/([0-9a-f-]{36})\/?$/i.exec(url.pathname);
  const route = playerMatch ? "player"
    : webhookMatch ? "webhook-item"
    : url.pathname === "/api/v4/alliances" ? "alliances"
    : url.pathname === "/api/v4/redemption-history" ? "redemption-history"
    : url.pathname === "/api/v4/usage" ? "usage"
    : url.pathname === "/api/v4/webhooks" ? "webhooks"
    : url.pathname === "/api/v4/redemptions" ? "redemptions"
    : "";
  const method = request.method.toUpperCase();
  const h = headers(route === "redemptions" ? "POST" : route === "webhooks" ? "GET, POST" : route === "webhook-item" ? "DELETE" : "GET");

  if (method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (!route) return fail(501, "route_not_migrated", "This V4 route is not yet available on the native Cloudflare runtime.", requestId, {
    migrationStatus: "pending", documentation: "/developer-v4.md",
  }, h);
  const allowedMethods = route === "redemptions" ? ["POST"] : route === "webhooks" ? ["GET", "POST"] : route === "webhook-item" ? ["DELETE"] : ["GET"];
  if (!allowedMethods.includes(method)) {
    h.set("Allow", allowedMethods.join(", ") + ", OPTIONS");
    return fail(405, "method_not_allowed", "This method is not supported for the requested V4 route.", requestId, {}, h);
  }

  if ((route === "redemptions" || (route === "webhooks" && method === "POST") || route === "webhook-item") && String(env.SUPABASE_WRITE_MODE || "").toLowerCase() !== "enabled") {
    return fail(503, "writes_disabled", "This V4 mutation is disabled in this environment; no authorization or database writes were attempted.", requestId, {}, h);
  }

  const auth = await authorize(request, env, requestId, h);
  if (auth instanceof Response) return auth;
  const requiredScope = route === "player" ? "players:read"
    : route === "alliances" ? "alliances:read"
    : route === "redemption-history" ? "redemptions:read"
    : route === "usage" ? "usage:read" : route === "redemptions" ? "redemptions:write" : "webhooks:manage";
  if (!auth.scopes.includes(requiredScope)) {
    return fail(403, "insufficient_scope", "This API key does not have the required scope: " + requiredScope, requestId, {}, h);
  }

  if (route === "redemptions") return handleV4Redemption(request, env, auth, requestId, h);

  if (route === "webhooks" && method === "POST") {
    if ((request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/json") {
      return fail(415, "unsupported_media_type", "Content-Type must be application/json.", requestId, {}, h);
    }
    let body: any;
    try {
      const raw = await request.clone().text();
      if (raw.length > 8192) return fail(413, "payload_too_large", "Webhook subscription request is too large.", requestId, {}, h);
      body = JSON.parse(raw || "{}");
    } catch { return fail(400, "invalid_json", "Provide a valid JSON request body.", requestId, {}, h); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["url", "events"].includes(key))) {
      return fail(400, "invalid_request_body", "Provide only url and events.", requestId, {}, h);
    }
    const target = typeof body.url === "string" ? isSafeWebhookRegistrationUrl(body.url.trim()) : null;
    if (!target) return fail(400, "invalid_webhook_url", "Provide an HTTPS URL with no credentials, non-standard port, IP literal, or local hostname.", requestId, {}, h);
    const allowedEvents = new Set(["redemption.completed", "redemption.unknown"]);
    const events = Array.isArray(body.events) ? [...new Set(body.events.map(String))] : [];
    if (!events.length || events.length > 2 || events.some((event: string) => !allowedEvents.has(event))) {
      return fail(400, "invalid_webhook_events", "Supported events: redemption.completed and redemption.unknown.", requestId, {}, h);
    }
    if (!/^[0-9a-f]{64}$/i.test(String(env.V4_WEBHOOK_ENCRYPTION_KEY || ""))) {
      return fail(503, "webhook_encryption_unconfigured", "Webhook secret encryption is not configured on this runtime.", requestId, {}, h);
    }
    try {
      const existing = await database(env, "/rest/v1/kingshot_developer_webhooks?select=id&key_id=eq." + encodeURIComponent(auth.keyId) + "&disabled_at=is.null");
      if (Array.isArray(existing) && existing.length >= 5) return fail(409, "webhook_limit_reached", "Each API key can have at most five active subscriptions.", requestId, {}, h);
      const secret = await createWebhookSecret();
      const ciphertext = await encryptWebhookSecret(env, secret);
      const created = await database(env, "/rest/v1/kingshot_developer_webhooks?select=id,url,events,created_at", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ key_id: auth.keyId, url: target.href, events,
          secret_hash: await sha256(secret), secret_ciphertext: ciphertext }),
      });
      const item = Array.isArray(created) ? created[0] : created;
      if (!item?.id) return fail(503, "webhook_creation_unconfirmed", "The subscription was not confirmed by storage. Check the subscription list before retrying.", requestId, {}, h);
      return response(201, { id: item.id, url: item.url, events: item.events,
        secret, warning: "Store this signing secret now. It will not be shown again.",
        deliveryStatus: "paused_pending_secure_egress" }, null, requestId, { rateLimit: auth.rateLimit }, h);
    } catch {
      return fail(503, "webhook_creation_unavailable", "Webhook subscription storage is temporarily unavailable.", requestId, {}, h);
    }
  }

  if (route === "webhook-item" && method === "DELETE") {
    try {
      const disabled = await database(env, "/rest/v1/kingshot_developer_webhooks?id=eq." + encodeURIComponent(webhookMatch![1]) + "&key_id=eq." + encodeURIComponent(auth.keyId), {
        method: "PATCH", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ disabled_at: new Date().toISOString() }),
      });
      return response(200, { revoked: Array.isArray(disabled) && disabled.length > 0 }, null, requestId, { rateLimit: auth.rateLimit }, h);
    } catch { return fail(503, "webhook_revocation_unavailable", "Webhook revocation could not be confirmed.", requestId, {}, h); }
  }

  if (route === "player") {
    const playerId = playerMatch![1];
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
        rateLimit: auth.rateLimit,
      }, h);
    } catch (error) {
      const status = mightPulsePlayerErrorStatus(error);
      const code = status === 429 ? "upstream_rate_limited" : status === 504 ? "upstream_timeout" : "upstream_unavailable";
      return fail(status === 429 ? 503 : status, code,
        status === 504 ? "The player lookup provider timed out after a bounded retry." : "The player lookup provider is temporarily unavailable.",
        requestId, {}, h);
    }
  }

  try {
    if (route === "alliances") {
      const kingdomId = (url.searchParams.get("kingdomId") || "").trim();
      const tag = (url.searchParams.get("tag") || "").trim();
      if (!/^\d{1,10}$/.test(kingdomId)) return fail(400, "invalid_kingdom_id", "kingdomId must contain 1–10 digits.", requestId, {}, h);
      if (tag && !/^[A-Za-z0-9_-]{1,20}$/.test(tag)) return fail(400, "invalid_alliance_tag", "Invalid alliance tag.", requestId, {}, h);
      const limit = boundedInteger(url.searchParams.get("limit"), 50, 1, 100);
      const offset = boundedInteger(url.searchParams.get("offset"), 0, 0, 10000);
      const endpoint = tag
        ? "https://api.mightpulse.com/v1/alliances/" + encodeURIComponent(kingdomId) + "/" + encodeURIComponent(tag) + "?include=info,roster"
        : "https://api.mightpulse.com/v1/kingdoms/" + encodeURIComponent(kingdomId) + "/ranks?board=alliance_power&limit=100";
      const upstream = await fetchMightPulseNative(env, endpoint, 9000, { totalTimeoutMs: 12000, maxAttempts: 2 });
      const body: any = await upstream.json().catch(() => null);
      if (!upstream.ok) return fail(upstream.status === 404 ? 404 : 502,
        upstream.status === 404 ? "alliance_not_found" : "alliance_provider_unavailable",
        "Alliance data is temporarily unavailable.", requestId, {}, h);
      const source = body?.data && typeof body.data === "object" ? body.data : body || {};
      const alliance = source.alliance && typeof source.alliance === "object" ? source.alliance : source;
      const raw = tag
        ? (Array.isArray(source.members) ? source.members : Array.isArray(source.roster) ? source.roster : [])
        : (Array.isArray(source.rankings) ? source.rankings : Array.isArray(source.ranks) ? source.ranks : Array.isArray(source.items) ? source.items : []);
      const members = raw.map((member: any) => ({
        playerId: String(member.player_id ?? member.playerId ?? member.governor_id ?? member.id ?? ""),
        name: String(member.nick_name ?? member.name ?? member.nickname ?? "").slice(0, 80),
        power: Number.isFinite(Number(member.power)) ? Number(member.power) : null,
        townCenterLevel: Number.isFinite(Number(member.town_center_level ?? member.townCenterLevel)) ? Number(member.town_center_level ?? member.townCenterLevel) : null,
        rank: String(member.alliance_rank_label ?? member.alliance_rank ?? member.rank ?? "").slice(0, 30),
      })).filter((member: any) => /^\d{5,20}$/.test(member.playerId));
      const fingerprint = await sha256(JSON.stringify(members));
      const cursor = url.searchParams.get("cursor") || "";
      return response(200, {
        alliance: {
          name: String(alliance.name ?? alliance.alliance_name ?? tag ?? "").slice(0, 80),
          tag: String(alliance.abbr ?? alliance.tag ?? tag ?? "").slice(0, 20),
          kingdomId,
          power: Number.isFinite(Number(alliance.power)) ? Number(alliance.power) : null,
          memberCount: members.length,
        },
        members: members.slice(offset, offset + limit),
        total: members.length,
        offset,
        limit,
        hasMore: offset + limit < members.length,
        nextCursor: offset + limit < members.length ? String(offset + limit) : null,
        changeCursor: fingerprint,
        changed: !cursor || cursor !== fingerprint,
        stale: body?.fresh === false || Boolean(body?.stale),
        fetchedAt: typeof body?.cached_at === "string" ? body.cached_at : null,
      }, null, requestId, { source: "mightpulse", rateLimit: auth.rateLimit }, h);
    }

    if (route === "redemption-history") {
      const playerId = (url.searchParams.get("playerId") || "").trim();
      if (!/^\d{5,20}$/.test(playerId)) return fail(400, "invalid_player_id", "playerId must contain 5–20 digits.", requestId, {}, h);
      const limit = boundedInteger(url.searchParams.get("limit"), 25, 1, 100);
      const offset = boundedInteger(url.searchParams.get("offset"), 0, 0, 10000);
      const query = new URLSearchParams({
        select: "player_id,gift_code,status,err_code,message,attempted_at",
        player_id: "eq." + playerId,
        order: "attempted_at.desc",
        limit: String(limit),
        offset: String(offset),
      });
      const rows = await database(env, "/rest/v1/kingshot_redemptions?" + query.toString());
      return response(200, {
        playerId,
        items: Array.isArray(rows) ? rows : [],
        limit,
        offset,
        hasMore: Array.isArray(rows) && rows.length === limit,
      }, null, requestId, { rateLimit: auth.rateLimit }, h);
    }

    if (route === "usage") {
      const usage = await database(env, "/rest/v1/rpc/kingshot_developer_get_usage", {
        method: "POST",
        body: JSON.stringify({ p_key_id: auth.keyId }),
      });
      return response(200, usage, null, requestId, { rateLimit: auth.rateLimit }, h);
    }

    const rows = await database(env,
      "/rest/v1/kingshot_developer_webhooks?select=id,url,events,created_at,updated_at,disabled_at&key_id=eq." +
      encodeURIComponent(auth.keyId) + "&order=created_at.desc");
    return response(200, { items: Array.isArray(rows) ? rows : [] }, null, requestId, { rateLimit: auth.rateLimit }, h);
  } catch {
    return fail(503, "feature_unavailable", "The requested V4 feature is temporarily unavailable.", requestId, {}, h);
  }
}
