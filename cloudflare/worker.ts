interface Env {
  ASSETS: Fetcher;
  LEGACY_API_ORIGIN: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  DISCORD_BOT_TOKEN?: string;
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

async function handleVisitorTelemetry(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") return handleEdgeLocale(request);
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { Allow: "GET, POST", "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return jsonError(503, "telemetry_storage_unconfigured", "Telemetry storage is not configured.");
  }
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

    // Visitor telemetry moves natively to Workers when the Supabase service
    // credential is provisioned. Until then, POST remains on the legacy bridge.
    if (incoming.pathname === "/api/ops-tools/visitor") {
      if (request.method === "GET") return handleEdgeLocale(request);
      if (env.SUPABASE_SERVICE_ROLE_KEY) return handleVisitorTelemetry(request, env);
    }

    if (incoming.pathname === API_PREFIX || incoming.pathname.startsWith(API_PREFIX + "/")) {
      if (!env.LEGACY_API_ORIGIN) {
        return jsonError(503, "api_upstream_unconfigured", "API service is temporarily unavailable.");
      }

      let origin: URL;
      try {
        origin = new URL(env.LEGACY_API_ORIGIN);
      } catch {
        return jsonError(503, "api_upstream_invalid", "API service is temporarily unavailable.");
      }

      if (origin.protocol !== "https:" || origin.username || origin.password) {
        return jsonError(503, "api_upstream_invalid", "API service is temporarily unavailable.");
      }

      // Transitional routing: keep the existing Vercel API contract and data
      // services alive while the individual handlers are ported to Workers.
      // The browser remains same-origin on the Cloudflare host.
      const target = new URL(incoming.pathname + incoming.search, origin);
      const upstreamRequest = new Request(target, request);
      const upstream = await fetch(upstreamRequest, {
        redirect: "manual",
        cf: { cacheTtl: 0, cacheEverything: false },
      });

      const headers = new Headers(upstream.headers);

      // Keep redirects that target the legacy API origin on the current edge
      // hostname. Preserve genuinely external redirects unchanged.
      const location = headers.get("Location");
      if (location) {
        try {
          const redirectTarget = new URL(location, target);
          if (redirectTarget.origin === origin.origin) {
            headers.set(
              "Location",
              redirectTarget.pathname + redirectTarget.search + redirectTarget.hash,
            );
          }
        } catch {
          // Leave malformed or non-URL Location values untouched.
        }
      }

      headers.set("Cache-Control", "no-store");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("X-Edge-Backend", "legacy-api-bridge");
      headers.delete("server");
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

// Preview deployment refresh: bind newly configured backend secrets.
