interface Env {
  ASSETS: Fetcher;
  LEGACY_API_ORIGIN: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
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
