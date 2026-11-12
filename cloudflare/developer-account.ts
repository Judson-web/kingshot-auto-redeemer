interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_WRITE_MODE?: string;
  V4_WEBHOOK_ENCRYPTION_KEY?: string;
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

async function rest(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!base || !key) throw new Error("Developer account service is not configured.");
  const response = await fetch(base + path, {
    ...init,
    headers: { apikey: key, authorization: "Bearer " + key, "content-type": "application/json", ...(init.headers || {}) },
    signal: init.signal || AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error("Webhook storage is unavailable."), { status: response.status });
  return data;
}
function webhookUrl(value: string): URL | null {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
        ipv4 || host.includes(":") || host === "localhost" || host.endsWith(".localhost") ||
        host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".") || host.length > 253) return null;
    return url;
  } catch { return null; }
}
function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sealWebhookSecret(env: Env, secret: string): Promise<string> {
  const hex = String(env.V4_WEBHOOK_ENCRYPTION_KEY || "");
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("webhook_encryption_unconfigured");
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map(pair => parseInt(pair, 16)));
  const key = await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const combined = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret)));
  return b64url(iv) + "." + b64url(combined.slice(-16)) + "." + b64url(combined.slice(0, -16));
}
async function newWebhookSecret(): Promise<string> {
  return "whsec_" + b64url(crypto.getRandomValues(new Uint8Array(32)));
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

async function exchangePkceCode(env: Env, authCode: string, codeVerifier: string): Promise<string> {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || "");
  if (!base || !key) throw Object.assign(new Error("Discord sign-in is not configured on this Worker."), { status: 503 });
  if (!authCode || authCode.length > 4096 || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
    throw Object.assign(new Error("This Discord sign-in attempt is invalid or expired. Please try again."), { status: 400 });
  }
  const response = await fetch(base + "/auth/v1/token?grant_type=pkce", {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ auth_code: authCode, code_verifier: codeVerifier }),
    signal: AbortSignal.timeout(10000),
  });
  const data: any = await response.json().catch(() => null);
  if (!response.ok || typeof data?.access_token !== "string") {
    throw Object.assign(new Error(response.status === 429
      ? "Too many sign-in attempts. Please wait and try again."
      : "Discord sign-in could not be completed. The authorization code may have expired; please try again."),
    { status: response.status === 429 ? 429 : 400 });
  }
  return data.access_token;
}
function discordIdentityId(user: any): string {
  const identity = (Array.isArray(user?.identities) ? user.identities : []).find((item: any) => item?.provider === "discord");
  return String(identity?.identity_data?.provider_id || identity?.identity_data?.sub ||
    identity?.identity_data?.id || identity?.identity_data?.user_id || identity?.id || "");
}
function profileFor(user: any, role: string, activeKeyCount = 0): Json {
  const metadata = user?.user_metadata || {};
  const displayName = String(metadata.global_name || metadata.full_name || metadata.name ||
    metadata.user_name || metadata.preferred_username || user?.email || "Discord user");
  return {
    email: user?.email || null,
    username: displayName,
    display_name: displayName,
    discord_username: metadata.user_name || metadata.preferred_username || null,
    global_name: metadata.global_name || metadata.full_name || null,
    avatar_url: metadata.avatar_url || null,
    discord_id: discordIdentityId(user) || null,
    provider: "discord",
    providers: ["discord"],
    providerIds: ["discord"],
    role,
    kind: role,
    activeKeyCount,
  };
}
async function activeKeyCountFor(env: Env, sessionHash: string): Promise<number> {
  try {
    const keys = await rpc(env, "kingshot_developer_account_list_keys", { p_session_hash: sessionHash });
    return Array.isArray(keys) ? keys.filter((key: any) => key && !key.revoked_at &&
      (!key.expires_at || Date.parse(key.expires_at) > Date.now())).length : 0;
  } catch { return 0; }
}
function discordAuthorizeUrl(env: Env, action: string, challenge: string): string | null {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || "");
  if (!base || !key || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return null;
  const destination = action === "android-discord-url"
    ? "https://app.ks-redeemer.workers.dev/profile?provider=discord&native=1"
    : action === "dev-oauth-url" || action === "dev-discord-oauth-url"
    ? "https://app.ks-redeemer.workers.dev/dev?provider=discord"
    : action === "oauth-url" || action === "discord-oauth-url"
      ? "https://app.ks-redeemer.workers.dev/developer?provider=discord"
      : "https://app.ks-redeemer.workers.dev/profile?provider=discord";
  const authorize = new URL(base + "/auth/v1/authorize");
  authorize.searchParams.set("provider", "discord");
  authorize.searchParams.set("redirect_to", destination);
  authorize.searchParams.set("apikey", key);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "s256");
  return authorize.toString();
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
  if (error?.status === 400 || error?.status === 422) return 400;
  if (error?.status === 429 || /lifetime limit|limit of three active/i.test(String(error?.message || ""))) return 429;
  if (error?.status === 401 || error?.status === 403 || /unauthorized/i.test(String(error?.message || ""))) return 401;
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
      let serverSessionRevoked = tokens.length === 0;
      if (allowedWrite(env)) {
        const hashes = await Promise.all(tokens.map(token => sha(token)));
        const results = await Promise.allSettled(hashes.map(p_token_hash =>
          rpc(env, "kingshot_developer_account_session_delete", { p_token_hash })));
        serverSessionRevoked = results.every(result => result.status === "fulfilled");
      }
      headers.append("Set-Cookie", cookieHeader(DEVELOPER_COOKIE, "", 0));
      headers.append("Set-Cookie", cookieHeader(PROFILE_COOKIE, "", 0));
      if (allowedWrite(env) && !serverSessionRevoked) {
        return json(503, { ok: false, localSessionCleared: true, serverSessionRevoked: false,
          error: "Browser cookies were cleared, but server-side session revocation could not be confirmed. Retry sign-out." }, headers);
      }
      return json(200, { ok: true, localSessionCleared: true, serverSessionRevoked }, headers);
    }
    if (method !== "POST") return json(405, { error: "Method not allowed." }, { ...Object.fromEntries(headers), Allow: "GET, POST, DELETE" });
    if (!limited(request, "developer-auth", 8, 900_000)) return json(429, { error: "Too many attempts. Try again in 15 minutes." }, headers);
    let body: Json;
    try { body = await request.json() as Json; } catch { return json(400, { error: "Invalid JSON body." }, headers); }
    const action = String(body.action || "");
    try {
      const startActions = new Set(["profile-discord-url", "site-discord-oauth-url", "android-discord-url", "dev-oauth-url",
        "dev-discord-oauth-url", "oauth-url", "discord-oauth-url"]);
      if (startActions.has(action)) {
        const authorizeUrl = discordAuthorizeUrl(env, action, String(body.code_challenge || ""));
        if (!authorizeUrl) return json(400, { error: "A valid secure sign-in challenge is required, and Discord sign-in must be configured." }, headers);
        return json(200, { url: authorizeUrl, provider: "discord" }, headers);
      }

      if (action === "profile-check" || action === "dev-check") {
        const token = action === "dev-check"
          ? cookie(request, DEVELOPER_COOKIE)
          : cookie(request, PROFILE_COOKIE) || cookie(request, DEVELOPER_COOKIE);
        if (!token) return json(200, { authenticated: false, role: action === "dev-check" ? "guest" : "user", kind: "user" }, headers);
        const session = await sessionUser(env, token);
        if (!session || (action === "dev-check" && !isOwner(session.user))) {
          return json(200, { authenticated: false, role: action === "dev-check" ? "guest" : "user", kind: "user" }, headers);
        }
        const activeKeyCount = await activeKeyCountFor(env, session.hash);
        const role = isOwner(session.user) ? "admin" : activeKeyCount > 0 ? "developer" : "user";
        const user = profileFor(session.user, role, activeKeyCount);
        return json(200, action === "dev-check"
          ? { authenticated: true, user: { email: user.email, user_name: user.username, username: user.username } }
          : { authenticated: true, role, kind: role, activeKeyCount, user }, headers);
      }

      if (action === "profile-logout") {
        const token = cookie(request, PROFILE_COOKIE) || cookie(request, DEVELOPER_COOKIE);
        if (token) await rpc(env, "kingshot_developer_account_session_delete", { p_token_hash: await sha(token) });
        headers.append("Set-Cookie", PROFILE_COOKIE + "=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict");
        return json(200, { ok: true }, headers);
      }

      const pkceActions = new Set(["profile-oauth-exchange", "dev-oauth-exchange"]);
      const tokenActions = new Set(["oauth", "profile-oauth", "dev-verify"]);
      if (!pkceActions.has(action) && !tokenActions.has(action) && action !== "developer-enroll") {
        return json(400, { error: "Unsupported Discord authentication action." }, headers);
      }
      if (!allowedWrite(env)) return json(503, { error: "writes_disabled", code: "writes_disabled" }, headers);

      let user: any;
      if (action === "developer-enroll") {
        const profileToken = cookie(request, PROFILE_COOKIE);
        const existing = await sessionUser(env, profileToken);
        if (!existing) return json(401, { error: "Sign in to your profile with Discord before enabling developer access." }, headers);
        user = existing.user;
      } else {
        const accessToken = pkceActions.has(action)
          ? await exchangePkceCode(env, String(body.code || ""), String(body.code_verifier || ""))
          : String(body.access_token || "");
        if (!accessToken || accessToken.length > 8192) return json(400, { error: "Missing or invalid Discord session token." }, headers);
        user = await verifiedOAuthUser(env, accessToken);
      }

      const developerOnly = action === "dev-oauth-exchange" || action === "dev-verify";
      if (developerOnly && !isOwner(user)) return json(403, { error: "This developer hub is restricted to its owner." }, headers);
      const token = randomToken();
      const created = await rpc(env, "kingshot_developer_account_session_create", {
        p_token_hash: await sha(token), p_user_id: user.id,
      });
      if (created !== true) return json(403, { error: "Could not establish a verified Discord session." }, headers);

      const profileOnly = action === "profile-oauth" || action === "profile-oauth-exchange";
      headers.append("Set-Cookie", cookieHeader(profileOnly ? PROFILE_COOKIE : DEVELOPER_COOKIE, token, SESSION_AGE));
      const sessionHash = await sha(token);
      const activeKeyCount = profileOnly ? await activeKeyCountFor(env, sessionHash) : 0;
      const role = isOwner(user) ? "admin" : profileOnly && activeKeyCount > 0 ? "developer" : "user";
      if (profileOnly) {
        const profile = profileFor(user, role, activeKeyCount);
        return json(200, { ok: true, role, kind: role, activeKeyCount, user: profile }, headers);
      }
      return json(200, { ok: true, role: isOwner(user) ? "admin" : "developer", kind: isOwner(user) ? "admin" : "developer",
        provider: "discord", user: { email: user.email || null, user_name: user.user_metadata?.user_name ||
          user.user_metadata?.preferred_username || user.email || "Discord user" } }, headers);
    } catch (error) { return json(errorStatus(error), { error: String((error as Error)?.message || "Discord sign-in failed.") }, headers); }
  }

  if (!["GET", "POST", "PATCH", "DELETE"].includes(method)) return json(405, { error: "Method not allowed." }, { ...Object.fromEntries(headers), Allow: "GET, POST, PATCH, DELETE" });
  const webhookAction = url.searchParams.get("action") === "webhooks";
  if (webhookAction && !["GET", "POST", "DELETE"].includes(method)) return json(405, { error: "Method not allowed." }, { ...Object.fromEntries(headers), Allow: "GET, POST, DELETE" });
  if (webhookAction && method !== "GET" && !allowedWrite(env)) return json(503, { error: "writes_disabled", code: "writes_disabled" }, headers);
  const tokens = [...new Set([cookie(request, PROFILE_COOKIE), cookie(request, DEVELOPER_COOKIE)].filter(Boolean))];
  if (!tokens.length) return json(401, { error: "Sign in with Discord to manage your API keys." }, headers);
  try {
    let session: { hash: string; user: any } | null = null;
    for (const token of tokens) { session = await sessionUser(env, token); if (session) break; }
    if (!session) return json(401, { error: "Your session is invalid. Sign in again." }, headers);
    const keys = await rpc(env, "kingshot_developer_account_list_keys", { p_session_hash: session.hash });
    if (webhookAction) {
      let body: Json = {};
      if (method !== "GET") {
        try { body = await request.json() as Json; }
        catch { return json(400, { error: "Invalid JSON body." }, headers); }
      }
      const keyId = String(method === "GET" ? url.searchParams.get("key_id") || "" : body.key_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(keyId)) return json(400, { error: "Choose a valid API key." }, headers);
      const ownedKey = Array.isArray(keys) ? keys.find((key: any) => key && key.id === keyId) : null;
      if (!ownedKey || ownedKey.revoked_at || (ownedKey.expires_at && Date.parse(ownedKey.expires_at) <= Date.now())) {
        return json(403, { error: "Choose an active API key owned by this Discord account." }, headers);
      }
      if (method === "GET") {
        const items = await rest(env, "/rest/v1/kingshot_developer_webhooks?select=id,url,events,created_at,updated_at,disabled_at&key_id=eq." + encodeURIComponent(keyId) + "&order=created_at.desc");
        return json(200, { items: Array.isArray(items) ? items : [] }, headers);
      }
      if (!limited(request, "developer-webhooks-" + method, method === "POST" ? 4 : 20, method === "POST" ? 3_600_000 : 60_000)) {
        return json(429, { error: "Too many webhook operations. Please wait and retry." }, headers);
      }
      if (method === "POST") {
        const target = typeof body.url === "string" ? webhookUrl(body.url.trim()) : null;
        if (!target) return json(400, { error: "Provide an HTTPS endpoint without credentials, an IP literal, local hostname, or non-standard port." }, headers);
        const allowedEvents = new Set(["redemption.completed", "redemption.unknown"]);
        const events = Array.isArray(body.events) ? [...new Set(body.events.map(String))] : [];
        if (!events.length || events.length > 2 || events.some(event => !allowedEvents.has(event))) {
          return json(400, { error: "Choose redemption.completed and/or redemption.unknown." }, headers);
        }
        if (!/^[0-9a-f]{64}$/i.test(String(env.V4_WEBHOOK_ENCRYPTION_KEY || ""))) {
          return json(503, { error: "Webhook secret encryption is not configured on this runtime." }, headers);
        }
        const existing = await rest(env, "/rest/v1/kingshot_developer_webhooks?select=id&key_id=eq." + encodeURIComponent(keyId) + "&disabled_at=is.null");
        if (Array.isArray(existing) && existing.length >= 5) return json(409, { error: "Each API key can have at most five active webhook subscriptions." }, headers);
        const secret = await newWebhookSecret();
        const ciphertext = await sealWebhookSecret(env, secret);
        const created = await rest(env, "/rest/v1/kingshot_developer_webhooks?select=id,url,events,created_at", {
          method: "POST", headers: { Prefer: "return=representation" },
          body: JSON.stringify({ key_id: keyId, url: target.href, events, secret_hash: await sha(secret), secret_ciphertext: ciphertext }),
        });
        const item = Array.isArray(created) ? created[0] : created;
        if (!item?.id) return json(503, { error: "Webhook creation could not be confirmed. Check the subscription list before retrying." }, headers);
        return json(201, { id: item.id, url: item.url, events: item.events, secret,
          warning: "Store this signing secret now. It will not be shown again.",
          deliveryStatus: "paused_pending_secure_egress" }, headers);
      }
      const webhookId = String(body.id || "");
      if (!/^[0-9a-f-]{36}$/i.test(webhookId)) return json(400, { error: "Invalid webhook ID." }, headers);
      const disabled = await rest(env, "/rest/v1/kingshot_developer_webhooks?id=eq." + encodeURIComponent(webhookId) + "&key_id=eq." + encodeURIComponent(keyId), {
        method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ disabled_at: new Date().toISOString() }),
      });
      return json(200, { revoked: Array.isArray(disabled) && disabled.length > 0 }, headers);
    }
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
