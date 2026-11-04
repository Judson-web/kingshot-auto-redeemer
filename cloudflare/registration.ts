import { fetchMightPulseNative } from "./mightpulse.js";

interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_WRITE_MODE?: string;
  MIGHTPULSE_API_KEY?: string;
  MIGHTPULSE_API_KEY_2?: string;
  MIGHTPULSE_API_KEY_3?: string;
  MIGHTPULSE_API_KEY_4?: string;
  MIGHTPULSE_API_KEY_5?: string;
  MIGHTPULSE_API_KEY_6?: string;
  DISCORD_KINGSHOT_WEBHOOK_URL?: string;
  DISCORD_SCRAPER_WEBHOOK_URL?: string;
}
const OWNER_DISCORD_ID = "871756466900598815";
const COOKIE = "__Host-ks_profile_session";
const buckets = new Map<string, { count: number; resetAt: number }>();
const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
function error(status: number, code: string, message: string): Response {
  return Response.json({ error: message, code }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
function cookieValue(request: Request, name: string): string {
  const raw = request.headers.get("Cookie") || "";
  const part = raw.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  if (!part) return "";
  try { return decodeURIComponent(part.slice(name.length + 1)); } catch { return ""; }
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
}
async function rpc(env: Env, name: string, body: Record<string, unknown>, timeoutMs = 8000): Promise<any> {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!base || !key) throw new Error("Registration database is not configured.");
  const response = await fetch(base + "/rest/v1/rpc/" + name, {
    method: "POST", headers: { apikey: key, authorization: "Bearer " + key, "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || "Registration database request failed.");
  return Array.isArray(data) ? data[0] : data;
}
async function authenticatedProfile(request: Request, env: Env): Promise<boolean> {
  const token = cookieValue(request, COOKIE);
  if (!token || token.length > 256 || !env.SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const userId = await rpc(env, "kingshot_developer_account_session_get", { p_token_hash: await sha256(token) });
    if (typeof userId !== "string" || !userId) return false;
    const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
    const key = String(env.SUPABASE_SERVICE_ROLE_KEY);
    const response = await fetch(base + "/auth/v1/admin/users/" + encodeURIComponent(userId), {
      headers: { apikey: key, authorization: "Bearer " + key }, signal: AbortSignal.timeout(8000),
    });
    const user: any = await response.json().catch(() => null);
    if (!response.ok) return false;
    const identities = Array.isArray(user?.identities) ? user.identities : [];
    const providers = Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : [];
    return providers.includes("discord") || identities.some((item: any) => item?.provider === "discord");
  } catch { return false; }
}
function limited(request: Request): boolean {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  let bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + 60_000 };
  bucket.count++;
  buckets.set(ip, bucket);
  if (buckets.size > 5000) for (const [key, value] of buckets) if (value.resetAt <= now) buckets.delete(key);
  return bucket.count > 60;
}
function profileFromPlayer(player: Record<string, any>): Record<string, unknown> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const kingdom = String(player.kid ?? player.kingdom_id ?? "").replace(/\D/g, "").slice(0, 10);
  const name = clean(player.nick_name ?? player.name ?? player.nickname, 120);
  const avatar = clean(player.avatar_url ?? player.avatar ?? player.avatarUrl, 500);
  const powerRaw = player.power ?? player.player_power ?? player.total_power;
  const power = powerRaw == null ? NaN : Number(String(powerRaw).replace(/,/g, ""));
  const tcRaw = player.town_center_level ?? player.tc_level ?? player.townCenterLevel ?? player.town_center;
  const tc = tcRaw == null ? NaN : Number(String(tcRaw).replace(/,/g, ""));
  const alliance = player.alliance && typeof player.alliance === "object" ? player.alliance : {};
  const allianceName = clean(alliance.name ?? player.alliance_name ?? player.allianceName, 100);
  const allianceTag = clean(alliance.abbr ?? alliance.tag ?? player.alliance_tag ?? player.allianceTag, 30);
  if (kingdom) payload.kingdom_id = kingdom;
  if (name) payload.player_name = name;
  if (avatar && /^https:\/\//i.test(avatar)) payload.avatar_url = avatar;
  if (Number.isFinite(power) && power >= 0) payload.player_power = String(power);
  if (Number.isFinite(tc) && tc >= 0 && tc <= 100) payload.town_center_level = String(tc);
  if (allianceName) payload.alliance_name = allianceName;
  if (allianceTag) payload.alliance_tag = allianceTag;
  return payload;
}
async function syncProfile(env: Env, playerId: string, player: Record<string, any>): Promise<void> {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  const payload = profileFromPlayer(player);
  if (Object.keys(payload).length <= 1) return;
  const response = await fetch(base + "/rest/v1/kingshot_autoredeem?player_id=eq." + encodeURIComponent(playerId) + "&select=player_id", {
    method: "PATCH", headers: { apikey: key, authorization: "Bearer " + key, "content-type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Could not save the refreshed player profile.");
}
export async function handleNativeRegistration(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return error(405, "method_not_allowed", "Method not allowed.");
  let body: Record<string, any>;
  try {
    const raw = await request.text();
    if (raw.length > 16_384) return error(413, "payload_too_large", "Registration request is too large.");
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return error(400, "invalid_request", "Invalid registration request.");
    body = parsed;
  } catch { return error(400, "invalid_json", "Registration request must be valid JSON."); }
  const playerId = clean(body.playerId, 32);
  const kingdomId = clean(body.kingdomId, 20);
  const playerName = clean(body.playerName, 120);
  const avatarUrl = clean(body.avatarUrl, 500);
  if (!/^\d{5,20}$/.test(playerId)) return error(400, "invalid_player_id", "Use the numeric Player ID shown in Kingshot under Profile → Info. It must contain 5–20 digits; your kingdom number is different.");
  if (kingdomId && !/^\d{1,10}$/.test(kingdomId)) return error(400, "invalid_kingdom_id", "Kingdom ID must contain 1–10 digits.");
  if (String(request.headers.get("x-alliance-registration") || "") === "1" && !(await authenticatedProfile(request, env))) {
    return error(401, "authentication_required", "Sign in with Discord to register alliance members.");
  }
  if (limited(request)) return error(429, "rate_limit_exceeded", "Too many registration requests. Retry after the indicated delay.");
  if (String(env.SUPABASE_WRITE_MODE || "").toLowerCase() !== "enabled") {
    return error(503, "writes_disabled", "Registration writes are disabled until an isolated writable environment is configured.");
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return error(503, "registration_unavailable", "Registration service is not configured.");
  try {
    const banQuery = new URLSearchParams({ select: "player_id,reason,created_at", player_id: "eq." + playerId, limit: "1" });
    const banResponse = await fetch(String(env.SUPABASE_URL).replace(/\/$/, "") + "/rest/v1/kingshot_player_bans?" + banQuery, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!banResponse.ok) return error(503, "registration_policy_unavailable", "Registration policy check is temporarily unavailable. Please retry.");
    const bans: any = await banResponse.json().catch(() => []);
    if (Array.isArray(bans) && bans[0]) return Response.json({
      error: "This Player ID is blocked from registration. Reason: " + clean(bans[0].reason || "Blocked by administrator", 240),
      code: "player_banned", banned: true, ban: bans[0],
    }, { status: 403, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    const result = await rpc(env, "register_kingshot_player_v2", {
      p_player_id: playerId, p_kingdom_id: kingdomId || null, p_player_name: playerName || null, p_avatar_url: avatarUrl || null,
    }, 10_000);
    const alreadyRegistered = Boolean(result?.already_registered);
    try {
      const upstream = await fetchMightPulseNative(env, "https://api.mightpulse.com/v1/players/" + encodeURIComponent(playerId) + "?include=base", 9000);
      const data: any = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        if (upstream.status === 404) {
          await rpc(env, "mark_kingshot_player_stale", { p_player_id: playerId, p_reason: "MIGHTPULSE_PLAYER_NOT_FOUND" });
          return Response.json({ registered: true, alreadyRegistered, registrationStatus: result?.registration_status || (alreadyRegistered ? "ALREADY_REGISTERED" : "NEW"), kingdomVerified: false, stale: true, player: result?.player || result }, { headers: { "Cache-Control": "no-store" } });
        }
        throw new Error("Kingdom verification is temporarily unavailable.");
      }
      const player = data.player && typeof data.player === "object" ? data.player : data;
      const returnedId = String(player.governor_id ?? player.fid ?? player.player_id ?? "");
      if (returnedId !== playerId) throw new Error("MightPulse returned a mismatched player profile.");
      const verifiedKingdomId = String(player.kid ?? player.kingdom_id ?? "").replace(/\D/g, "");
      if (!/^\d{1,10}$/.test(verifiedKingdomId)) throw new Error("Kingdom verification returned no kingdom.");
      await rpc(env, "record_kingshot_kingdom_revalidation", {
        p_player_id: playerId, p_kingdom_id: verifiedKingdomId,
        p_player_name: clean(player.nick_name ?? player.name ?? player.nickname ?? playerName, 120) || null,
        p_avatar_url: clean(player.avatar_url ?? player.avatar ?? player.avatarUrl ?? avatarUrl, 500) || null,
      });
      try { await syncProfile(env, playerId, player); } catch { /* Registration remains successful if optional profile enrichment fails. */ }
      return Response.json({ registered: true, alreadyRegistered, registrationStatus: result?.registration_status || (alreadyRegistered ? "ALREADY_REGISTERED" : "NEW"), kingdomVerified: true, verifiedKingdomId, player: result?.player || result }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ registered: true, alreadyRegistered, registrationStatus: result?.registration_status || (alreadyRegistered ? "ALREADY_REGISTERED" : "NEW"), kingdomVerified: false, verificationPending: true, player: result?.player || result }, { headers: { "Cache-Control": "no-store" } });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Registration service timed out.";
    return error(504, "registration_failed", message === "Could not register this player." ? message : "Registration service timed out.");
  }
}
