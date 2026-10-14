import crypto from "node:crypto";
import { getPlayer } from "../../internal/kingshot/mightpulse.js";

type HeaderValue = string | string[] | undefined;
interface RequestLike { method?: string; url?: string; headers: Record<string, HeaderValue>; body?: Record<string, unknown>; query?: Record<string, unknown>; }
interface ResponseLike { status(code: number): ResponseLike; json(body: unknown): ResponseLike; setHeader(name: string, value: string): void; }
const SUPABASE_URL = process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const ADMIN_COOKIE = "__Host-ks_admin_session";
const sha256 = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const header = (req: RequestLike, name: string) => { const value = req.headers[name.toLowerCase()] ?? req.headers[name]; return Array.isArray(value) ? value[0] : value; };
function clientIp(req: RequestLike): string {
  const value = String(header(req, "x-vercel-forwarded-for") || "").split(",")[0].trim();
  return value.length > 0 && value.length <= 64 ? value : "";
}
function adminSession(req: RequestLike): string {
  const cookie = String(header(req, "cookie") || "");
  const pair = cookie.split(";").map(part => part.trim()).find(part => part.startsWith(ADMIN_COOKIE + "="));
  if (!pair) return "";
  try { return decodeURIComponent(pair.slice(ADMIN_COOKIE.length + 1)); } catch { return ""; }
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
function respondError(res: ResponseLike, error: unknown): void {
  const message = error instanceof Error ? error.message : "Request failed.";
  const status = (error as { status?: number } | null)?.status;
  if (status === 401 || /unauthorized/i.test(message)) { res.status(401).json({ error: "Admin session expired. Sign in again." }); return; }
  if (/lifetime limit of two API keys/i.test(message)) { res.status(429).json({ error: "This IP address has reached the lifetime limit of two API keys." }); return; }
  if (/developer API is not configured/i.test(message)) { res.status(503).json({ error: message }); return; }
  console.error("[developer-api] database operation failed", { status, message });
  res.status(502).json({ error: "Developer API could not complete the request." });
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
    if (Number.isFinite(reset)) res.setHeader("X-RateLimit-Reset", String(Math.ceil(reset / 1000)));
  }
}
export default async function developerApi(req: RequestLike, res: ResponseLike, path: string): Promise<void> {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset");
  if (req.method === "OPTIONS") { res.status(204).json({}); return; }
  const adminToken = adminSession(req);
  const adminTokenHash = adminToken ? sha256(adminToken) : "";

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
  if (path === "player" && req.method === "GET") {
    const rawKey = keyFromRequest(req);
    if (!rawKey) { res.setHeader("WWW-Authenticate", "Bearer"); res.status(401).json({ error: "A valid developer API key is required." }); return; }
    const ip = clientIp(req);
    if (!ip) { res.status(503).json({ error: "The trusted client IP is unavailable." }); return; }
    try {
      const authorization = await rpc<Record<string, unknown>>("kingshot_developer_authorize_key", { p_key_hash: sha256(rawKey), p_ip_hash: sha256(ip) });
      setRateHeaders(res, authorization);
      if (authorization.allowed !== true) {
        const reason = String(authorization.reason || "");
        const status = reason === "invalid_api_key" ? 401 : 429;
        res.status(status).json({ error: status === 401 ? "Invalid or revoked developer API key." : "API rate limit or quota exceeded.", code: reason, ...(authorization.reset_at ? { resetAt: authorization.reset_at } : {}) });
        return;
      }
      const url = new URL(req.url || "/", "https://local.invalid");
      const id = url.searchParams.get("id")?.trim() || "";
      if (!/^\d{5,20}$/.test(id)) { res.status(400).json({ error: "Provide a player ID containing 5–20 digits.", code: "invalid_player_id" }); return; }
      const player = await getPlayer(id);
      res.status(200).json({ data: {
        playerId: String(player.governor_id || player.fid || player.id || id),
        name: String(player.nick_name || player.name || player.nickname || "").slice(0, 120),
        kingdomId: String(player.kid ?? player.kingdom_id ?? ""),
        power: player.power ?? null,
        townCenterLevel: player.town_center_level ?? player.tc_level ?? null,
        avatarUrl: String(player.avatar_url || player.avatar || player.avatarUrl || "").slice(0, 500) || null
      }, meta: { requestId: crypto.randomUUID(), remaining: authorization.remaining, dailyRemaining: authorization.daily_remaining } });
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      if (status === 404) { res.status(404).json({ error: "Player not found.", code: "player_not_found" }); return; }
      console.error("[developer-api] player lookup failed", error instanceof Error ? error.message : "unknown error");
      res.status(502).json({ error: "Player lookup provider is unavailable.", code: "upstream_unavailable" });
    }
    return;
  }
  res.status(404).json({ error: "Developer API route not found.", documentation: "/developer" });
}
