interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_WRITE_MODE?: string;
}
const DEVELOPER_COOKIE = "__Host-ks_developer_session";
const PROFILE_COOKIE = "__Host-ks_profile_session";
const OWNER_DISCORD_ID = "871756466900598815";
const SESSION_AGE = 60 * 60 * 24 * 60;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
type Json = Record<string, unknown>;

function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Cache-Control", "private, no-store");
  h.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: h });
}
function cookie(request: Request, name: string): string {
  const raw = request.headers.get("Cookie") || "";
  const pair = raw.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
  if (!pair) return "";
  try { return decodeURIComponent(pair.slice(name.length + 1)); } catch { return ""; }
}
function cookieHeader(name: string, value: string, age: number): string {
  return name + "=" + encodeURIComponent(value) + "; Max-Age=" + age + "; Path=/; HttpOnly; Secure; SameSite=Strict";
}
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(v => v.toString(16).padStart(2, "0")).join("");
}
async function sha(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
}
function allowedWrite(env: Env): boolean {
  return String(env.SUPABASE_WRITE_MODE || "").toLowerCase() === "enabled";
}
function limited(request: Request, bucket: string, max: number, windowMs: number): boolean {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = bucket + ":" + ip;
  const now = Date.now();
  let state = rateBuckets.get(key);
  if (!state || state.resetAt <= now) state = { count: 0, resetAt: now + windowMs };
  state.count++;
  rateBuckets.set(key, state);
  if (rateBuckets.size > 4000) {
    for (const [k, v] of rateBuckets) if (v.resetAt <= now) rateBuckets.delete(k);
  }
  return state.count <= max;
}
async function rpc(env: Env, name: string, body: Json): Promise<any> {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!base || !key) throw new Error("Developer account service is not configured.");
  const response = await fetch(base + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { apikey: key, authorization: "Bearer " + key, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(String(data?.message || "Developer account service unavailable.")), { status: response.status });
  return data;
}
async function adminUser(env: Env, userId: string): Promise<any> {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!base || !key) throw new Error("Developer account service is not configured.");
  const response = await fetch(base + "/auth/v1/admin/users/" + encodeURIComponent(userId), {
    headers: { apikey: key, authorization: "Bearer " + key },
    signal: AbortSignal.timeout(8000),
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) throw new Error("Discord account could not be verified.");
  return user;
}
function hasDiscord(user: any): boolean {
  const providers = Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : [];
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  return providers.includes("discord") || identities.some((identity: any) => identity?.provider === "discord");
}
function isOwner(user: any): boolean {
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  const identity = identities.find((item: any) => item?.provider === "discord");
  const id = String(identity?.identity_data?.provider_id || identity?.identity_data?.sub ||
    identity?.identity_data?.id || identity?.identity_data?.user_id || identity?.id || "");
  return hasDiscord(user) && id === OWNER_DISCORD_ID;
}
async function verifiedOAuthUser(env: Env, accessToken: string): Promise<any> {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!base || !key) throw new Error("Discord sign-in is not configured.");
  const response = await fetch(base + "/auth/v1/user", {
    headers: { apikey: key, authorization: "Bearer " + accessToken },
    signal: AbortSignal.timeout(8000),
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id || !hasDiscord(user)) throw new Error("Supabase could not verify this Discord sign-in.");
  return user;
}
async function sessionUser(env: Env, token: string): Promise<{ hash: string; user: any } | null> {
  if (!token || token.length > 256) return null;
  const hash = await sha(token);
  const userId = await rpc(env, "kingshot_developer_account_session_get", { p_token_hash: hash });
  if (typeof userId !== "string" || !userId) return null;
  const user = await adminUser(env, userId);
  if (!hasDiscord(user)) return null;
  return { hash, user };
}
function errorStatus(error: any): number {
  if (error?.status === 401 || error?.status === 403 || /unauthorized/i.test(String(error?.message || ""))) return 401;
  if (/lifetime limit|limit of three active/i.test(String(error?.message || ""))) return 429;
  return 503;
}

export async function handleNativeDeveloperAccount(request: Request, env: Env, route: "auth" | "keys"): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const headers = new Headers();
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");

  if (route === "auth") {
    if (method === "GET") {
      const token = cookie(request, DEVELOPER_COOKIE);
      if (!token) return json(200, { authenticated: false, role: "guest", kind: "user" }, headers);
      try {
        const session = await sessionUser(env, token);
        if (!session) return json(200, { authenticated: false, role: "guest", kind: "user" }, headers);
        let activeKeyCount = 0;
        if (!isOwner(session.user)) {
          const keys = await rpc(env, "kingshot_developer_account_list_keys", { p_session_hash: session.hash });
          activeKeyCount = Array.isArray(keys) ? keys.filter((key: any) => key && !key.revoked_at && (!key.expires_at || Date.parse(key.expires_at) > Date.now())).length : 0;
          if (!activeKeyCount) return json(200, { authenticated: false, role: "guest", kind: "user", activeKeyCount: 0 }, headers);
        }
        const metadata = session.user.user_metadata || {};
        const identity = (session.user.identities || []).find((item: any) => item?.provider === "discord");
        const discordId = String(identity?.identity_data?.provider_id || identity?.identity_data?.sub || identity?.id || "");
        const role = isOwner(session.user) ? "admin" : "developer";
        return json(200, { authenticated: true, role, kind: role, activeKeyCount, user: {
          email: session.user.email || null,
          username: metadata.global_name || metadata.user_name || metadata.preferred_username || session.user.email || "Discord user",
          display_name: metadata.global_name || metadata.user_name || metadata.preferred_username || "Discord user",
          discord_id: discordId || null, provider: "discord", role, kind: role,
        } }, headers);
      } catch (error) { return json(errorStatus(error), { error: "Could not verify developer access. Please retry." }, headers); }
    }
    if (method === "DELETE") {
      const tokens = [...new Set([cookie(request, DEVELOPER_COOKIE), cookie(request, PROFILE_COOKIE)].filter(Boolean))];
      if (allowedWrite(env)) {
        const hashes = await Promise.all(tokens.map(token => sha(token)));\n        await Promise.allSettled(hashes.map(p_token_hash => rpc(env, "kingshot_developer_account_session_delete", { p_token_hash })));
      }
      headers.append("Set-Cookie", cookieHeader(DEVELOPER_COOKIE, "", 0));
      headers.append("Set-Cookie", cookieHeader(PROFILE_COOKIE, "", 0));
      return json(200, { ok: true, localSessionCleared: true }, headers);
    }
    if (method !== "POST") return json(405, { error: "Method not allowed." }, { ...Object.fromEntries(headers), Allow: "GET, POST, DELETE" });
    if (!allowedWrite(env)) return json(503, { error: "writes_disabled", code: "writes_disabled" }, headers);
    if (!limited(request, "developer-auth", 8, 900_000)) return json(429, { error: "Too many attempts. Try again in 15 minutes." }, headers);
    let body: Json;
    try { body = await request.json() as Json; } catch { return json(400, { error: "Invalid JSON body." }, headers); }
    const action = String(body.action || "");
    try {
      if (action !== "oauth" && action !== "profile-oauth" && action !== "developer-enroll") {
        return json(400, { error: "Only Discord OAuth sign-in is supported." }, headers);
      }
      let user: any;
      if (action === "developer-enroll") {
        const profileToken = cookie(request, PROFILE_COOKIE);
        const existing = await sessionUser(env, profileToken);
        if (!existing) return json(401, { error: "Sign in to your profile with Discord before enabling developer access." }, headers);
        user = existing.user;
      } else {
        const accessToken = String(body.access_token || "");
        if (!accessToken || accessToken.length > 8192) return json(400, { error: "Missing or invalid Discord session token." }, headers);
        user = await verifiedOAuthUser(env, accessToken);
      }
      const token = randomToken();
      const created = await rpc(env, "kingshot_developer_account_session_create", {
        p_token_hash: await sha(token), p_user_id: user.id,
      });
      if (created !== true) return json(403, { error: "Could not establish a verified Discord session." }, headers);
      const profileOnly = action === "profile-oauth";
      headers.append("Set-Cookie", cookieHeader(profileOnly ? PROFILE_COOKIE : DEVELOPER_COOKIE, token, SESSION_AGE));
      const role = isOwner(user) ? "admin" : "user";
      return json(200, { ok: true, role, provider: "discord", kind: role }, headers);
    } catch (error) { return json(errorStatus(error), { error: String((error as Error)?.message || "Discord sign-in failed.") }, headers); }
  }

  if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) return json(405, { error: "Method not allowed." }, { ...Object.fromEntries(headers), Allow: "GET, POST, PATCH, DELETE" });
  if (url.searchParams.get("action") === "webhooks") return json(501, { error: "Webhook management is not yet available in the native account runtime.", code: "webhook_management_not_migrated" }, headers);\n  const tokens = [...new Set([cookie(request, PROFILE_COOKIE), cookie(request, DEVELOPER_COOKIE)].filter(Boolean))];
  if (!tokens.length) return json(401, { error: "Sign in with Discord to manage your API keys." }, headers);
  try {
    let session: { hash: string; user: any } | null = null;
    for (const token of tokens) { session = await sessionUser(env, token); if (session) break; }
    if (!session) return json(401, { error: "Your session is invalid. Sign in again." }, headers);
    const keys = await rpc(env, "kingshot_developer_account_list_keys", { p_session_hash: session.hash });
    if (method === "GET") return json(200, { keys: Array.isArray(keys) ? keys : [] }, headers);
    if (!allowedWrite(env)) return json(503, { error: "writes_disabled", code: "writes_disabled" }, headers);
    if (!limited(request, "developer-keys-" + method, method === "POST" ? 4 : 20, method === "POST" ? 3_600_000 : 60_000)) {
      return json(429, { error: "Too many API-key operations. Please wait and retry." }, headers);
    }
    if (method === "POST") {
      let body: Json;
      try { body = await request.json() as Json; } catch { return json(400, { error: "Invalid JSON body." }, headers); }
      const rawLabel = typeof body.label === "string" ? body.label : "Developer key";
      if (rawLabel.length > 80) return json(400, { error: "Key labels must be 80 characters or fewer." }, headers);
      const label = rawLabel.trim() || "Developer key";
      const ip = request.headers.get("CF-Connecting-IP") || "";
      if (!ip || ip.length > 64) return json(503, { error: "Trusted client IP is unavailable." }, headers);
      const secret = "ks_live_" + [...crypto.getRandomValues(new Uint8Array(32))].map(v => v.toString(16).padStart(2, "0")).join("");
      const metadata = await rpc(env, "kingshot_developer_account_create_key", {
        p_session_hash: session.hash, p_ip_hash: await sha(ip), p_key_hash: await sha(secret),
        p_key_prefix: secret.slice(0, 16), p_label: label,
      });
      return json(201, { key: secret, metadata }, headers);
    }
    const id = url.searchParams.get("id") || "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Invalid key ID." }, headers);
    if (method === "PATCH") {
      let body: Json;
      try { body = await request.json() as Json; } catch { return json(400, { error: "Invalid JSON body." }, headers); }
      const allowed = new Set(["players:read", "alliances:read", "redemptions:write", "redemptions:read", "webhooks:manage", "usage:read"]);
      const scopes = Array.isArray(body.scopes) ? body.scopes.map(String) : [];
      if (!scopes.length || scopes.length > 6 || scopes.some(scope => !allowed.has(scope))) return json(400, { error: "Choose at least one valid API scope." }, headers);
      let expiry: string | null = null;
      try { expiry = typeof body.expires_at === "string" && body.expires_at ? new Date(body.expires_at).toISOString() : null; }
      catch { return json(400, { error: "Invalid expiry date." }, headers); }
      const ok = await rpc(env, "kingshot_developer_account_update_key_settings", {
        p_session_hash: session.hash, p_key_id: id, p_scopes: scopes, p_expires_at: expiry,
      });
      return json(ok ? 200 : 404, { ok: !!ok }, headers);
    }
    const ok = await rpc(env, "kingshot_developer_account_revoke_key", { p_session_hash: session.hash, p_key_id: id });
    return json(ok ? 200 : 404, { ok: !!ok }, headers);
  } catch (error) {
    return json(errorStatus(error), { error: errorStatus(error) === 503 ? "Could not complete the API-key operation." : String((error as Error)?.message || "Account request failed.") }, headers);
  }
}
