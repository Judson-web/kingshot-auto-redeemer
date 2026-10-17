import crypto from "node:crypto";
import { getPlayer } from "../internal/kingshot/mightpulse.js";
import { redeemKingshot } from "../internal/kingshot/redeem.js";

type HeaderValue = string | string[] | undefined;
interface RequestLike { method?: string; url?: string; headers: Record<string, HeaderValue>; body?: Record<string, unknown>; query?: Record<string, unknown>; }
interface ResponseLike { status(code: number): ResponseLike; json(body: unknown): ResponseLike; setHeader(name: string, value: string): void; }
const SUPABASE_URL = process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const DEVELOPER_COOKIE = "__Host-ks_developer_session";
const sha256 = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const header = (req: RequestLike, name: string) => { const value = req.headers[name.toLowerCase()] ?? req.headers[name]; return Array.isArray(value) ? value[0] : value; };
function clientIp(req: RequestLike): string {
  const value = String(header(req, "x-vercel-forwarded-for") || "").split(",")[0].trim();
  return value.length > 0 && value.length <= 64 ? value : "";
}
function developerSession(req: RequestLike): string {
  const cookie = String(header(req, "cookie") || "");
  const pair = cookie.split(";").map(part => part.trim()).find(part => part.startsWith(DEVELOPER_COOKIE + "="));
  if (!pair) return "";
  try { return decodeURIComponent(pair.slice(DEVELOPER_COOKIE.length + 1)); } catch { return ""; }
}
async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!SUPABASE_KEY) throw new Error("Developer API is not configured.");
  const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, {
    method: "POST", headers: { apikey: SUPABASE_KEY, authorization: "Bearer " + SUPABASE_KEY, "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(7000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) { const error = new Error(typeof data?.message === "string" ? data.message : "Developer API database request failed.") as Error & { status?: number }; error.status = response.status; throw error; }
  return data as T;
}
function requestId(res: ResponseLike): string { const id = crypto.randomUUID(); res.setHeader("X-Request-Id", id); return id; }
function apiError(res: ResponseLike, status: number, code: string, message: string, requestIdValue: string = crypto.randomUUID(), extra: Record<string, unknown> = {}): void { res.setHeader("X-Request-Id", requestIdValue); res.status(status).json({ error: message, code, meta: { requestId: requestIdValue, timestamp: new Date().toISOString() }, ...extra }); }
function respondError(res: ResponseLike, error: unknown): void {
  const id = requestId(res);
  const message = error instanceof Error ? error.message : "Request failed.";
  const status = (error as { status?: number } | null)?.status;
  if (status === 401 || /unauthorized/i.test(message)) { apiError(res, 401, "unauthorized", "Developer session expired. Sign in again.", id); return; }
  if (/lifetime limit of two API keys/i.test(message)) { apiError(res, 429, "ip_issuance_limit", "This IP address has reached the lifetime limit of two API keys.", id); return; }
  if (/developer API is not configured/i.test(message)) { apiError(res, 503, "service_not_configured", message, id); return; }
  console.error("[developer-api] database operation failed", { status, message });
  apiError(res, 502, "internal_error", "Developer API could not complete the request.", id);
}
function keyFromRequest(req: RequestLike): string {
  const match = /^Bearer\s+(ks_live_[a-f0-9]{64})$/i.exec(String(header(req, "authorization") || "").trim());
  return match ? match[1] : "";
}
function setRateHeaders(res: ResponseLike, result: Record<string, unknown>): void {
  if (typeof result.limit === "number") res.setHeader("X-RateLimit-Limit", String(result.limit));
  if (typeof result.remaining === "number") res.setHeader("X-RateLimit-Remaining", String(result.remaining));
  if (typeof result.reset_at === "string" || typeof result.reset_at === "number") {
    const reset = typeof result.reset_at === "number" ? result.reset_at : Date.parse(result.reset_at);
    if (Number.isFinite(reset)) { res.setHeader("X-RateLimit-Reset", String(Math.ceil(reset / 1000))); res.setHeader("Retry-After", String(Math.max(1, Math.ceil((reset - Date.now()) / 1000)))); }
  }
}
export default async function developerApi(req: RequestLike, res: ResponseLike, path: string): Promise<void> {
  const rid = requestId(res);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Only the documented bearer-key API is intentionally cross-origin. Cookie-backed
  // key management and admin-player routes stay same-origin and never advertise CORS.
  const publicApiRoute = path === "player" || path === "redeem";
  if (publicApiRoute) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Expose-Headers", "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset");
  }
  if (req.method === "OPTIONS") { res.status(204).json({}); return; }
  const developerToken = developerSession(req);
  const adminTokenHash = developerToken ? sha256(developerToken) : "";

  if (path === "keys" && req.method === "GET") {
    try { const keys = await rpc<unknown>("kingshot_developer_list_keys", { p_admin_token_hash: adminTokenHash }); res.status(200).json({ keys }); }
    catch (error) { respondError(res, error); }
    return;
  }
  if (path === "keys" && req.method === "POST") {
    const ip = clientIp(req);
    if (!ip) { res.status(503).json({ error: "The trusted client IP is unavailable; key issuance is disabled for this request." }); return; }
    const label = String(req.body?.label || "Developer key").trim().slice(0, 80) || "Developer key";
    const secret = "ks_live_" + crypto.randomBytes(32).toString("hex");
    try {
      const created = await rpc<Record<string, unknown>>("kingshot_developer_create_key", { p_admin_token_hash: adminTokenHash, p_ip_hash: sha256(ip), p_key_hash: sha256(secret), p_key_prefix: secret.slice(0, 16), p_label: label });
      res.status(201).json({ key: secret, ...created, warning: "Copy this key now. It cannot be retrieved again." });
    } catch (error) { respondError(res, error); }
    return;
  }
  const revoke = /^keys\/([0-9a-f-]{36})$/i.exec(path);
  if (revoke && req.method === "DELETE") {
    try {
      const revoked = await rpc<boolean>("kingshot_developer_revoke_key", { p_admin_token_hash: adminTokenHash, p_key_id: revoke[1] });
      if (!revoked) { res.status(404).json({ error: "API key not found." }); return; }
      res.status(200).json({ ok: true });
    } catch (error) { respondError(res, error); }
    return;
  }
  if (path === "admin-player" && req.method === "GET") {
    if (!adminTokenHash) { res.status(401).json({ error: "Developer session expired. Sign in again." }); return; }
    try {
      await rpc<unknown>("kingshot_developer_list_keys", { p_admin_token_hash: adminTokenHash });
      const id = new URL(req.url || "/", "https://local.invalid").searchParams.get("id")?.trim() || "";
      if (!/^\\d{5,20}$/.test(id)) { res.status(400).json({ error: "Provide a player ID containing 5–20 digits." }); return; }
      const player = await getPlayer(id);
      res.status(200).json({ player });
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      if (status === 404) { res.status(404).json({ error: "Player not found." }); return; }
      respondError(res, error);
    }
    return;
  }

  if (path === "redeem" && req.method === "POST") {
    const rawKey = keyFromRequest(req);
    if (!rawKey) { res.setHeader("WWW-Authenticate", "Bearer"); apiError(res, 401, "missing_api_key", "A valid developer API key is required.", rid); return; }
    const ip = clientIp(req);
    if (!ip) { apiError(res, 503, "client_ip_unavailable", "The trusted client IP is unavailable.", rid); return; }
    try {
      const authorization = await rpc<Record<string, unknown>>("kingshot_developer_authorize_key", { p_key_hash: sha256(rawKey), p_ip_hash: sha256(ip) });
      setRateHeaders(res, authorization);
      if (authorization.allowed !== true) {
        const invalid = String(authorization.reason || "") === "invalid_api_key";
        apiError(res, invalid ? 401 : 429, invalid ? "invalid_api_key" : "rate_limit_exceeded", invalid ? "Invalid or revoked developer API key." : "API rate limit or quota exceeded.", rid, { reason: authorization.reason || "quota_exceeded" });
        return;
      }
      const playerId = String(req.body?.playerId || "").trim();
      const code = String(req.body?.code || "").trim();
      const kid = String(req.body?.kid || "").trim();
      if (!/^\\d{5,20}$/.test(playerId) || !/^[A-Za-z0-9_-]{1,64}$/.test(code) || !/^\\d{1,10}$/.test(kid)) {
        apiError(res, 400, "invalid_redemption_input", "Provide playerId (5–20 digits), code (1–64 safe characters), and kid (1–10 digits).", rid); return;
      }
      const result = await redeemKingshot({ playerId, code, kid });
      const status = result.httpStatus >= 500 ? 502 : result.httpStatus;
      res.status(status).json({ data: { ok: Boolean(result.ok), status: result.status || "ERROR", statusLabel: result.statusLabel || null, message: result.message || result.error || "Redemption request completed.", errorCategory: result.errorCategory || null, errCode: result.errCode ?? null }, meta: { requestId: rid, timestamp: new Date().toISOString(), remaining: authorization.remaining, dailyRemaining: authorization.daily_remaining } });
    } catch (error) { console.error("[developer-api] redemption request failed", error instanceof Error ? error.message : "unknown error"); apiError(res, 502, "redemption_unavailable", "Redemption provider is temporarily unavailable.", rid); }
    return;
  }

  if (path === "player" && req.method === "GET") {
    const rawKey = keyFromRequest(req);
    if (!rawKey) { res.setHeader("WWW-Authenticate", "Bearer"); apiError(res, 401, "missing_api_key", "A valid developer API key is required.", rid); return; }
    const ip = clientIp(req);
    if (!ip) { apiError(res, 503, "client_ip_unavailable", "The trusted client IP is unavailable.", rid); return; }
    try {
      const authorization = await rpc<Record<string, unknown>>("kingshot_developer_authorize_key", { p_key_hash: sha256(rawKey), p_ip_hash: sha256(ip) });
      setRateHeaders(res, authorization);
      if (authorization.allowed !== true) {
        const reason = String(authorization.reason || "");
        const status = reason === "invalid_api_key" ? 401 : 429;
        apiError(res, status, status === 401 ? "invalid_api_key" : "rate_limit_exceeded", status === 401 ? "Invalid or revoked developer API key." : "API rate limit or quota exceeded.", rid, { reason, ...(authorization.reset_at ? { resetAt: authorization.reset_at } : {}) });
        return;
      }
      const url = new URL(req.url || "/", "https://local.invalid");
      const id = url.searchParams.get("id")?.trim() || "";
      if (!/^\d{5,20}$/.test(id)) { apiError(res, 400, "invalid_player_id", "Provide a player ID containing 5–20 digits.", rid); return; }
      const player = await getPlayer(id);
      res.status(200).json({ data: {
        playerId: String(player.governor_id || player.fid || player.id || id),
        name: String(player.nick_name || player.name || player.nickname || "").slice(0, 120),
        kingdomId: String(player.kid ?? player.kingdom_id ?? ""),
        power: player.power ?? null,
        townCenterLevel: player.town_center_level ?? player.tc_level ?? null,
        avatarUrl: String(player.avatar_url || player.avatar || player.avatarUrl || "").slice(0, 500) || null
      }, meta: { requestId: rid, timestamp: new Date().toISOString(), fetchedAt: new Date().toISOString(), source: "mightpulse", stale: false, remaining: authorization.remaining, dailyRemaining: authorization.daily_remaining } });
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      if (status === 404) { apiError(res, 404, "player_not_found", "Player not found.", rid); return; }
      console.error("[developer-api] player lookup failed", error instanceof Error ? error.message : "unknown error");
      apiError(res, 502, "upstream_unavailable", "Player lookup provider is unavailable.", rid);
    }
    return;
  }
  apiError(res, 404, "route_not_found", "Developer API route not found.", rid, { documentation: "/developer" });
}
