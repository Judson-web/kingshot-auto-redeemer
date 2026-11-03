interface Env {
  ASSETS: Fetcher;
  LEGACY_API_ORIGIN: string;
}

const API_PREFIX = "/api";

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

    // Cloudflare-native equivalent of the existing lightweight visitor locale
    // lookup. Keep POST telemetry on the legacy handler until its trusted
    // client-IP and geographic-header semantics are migrated deliberately.
    if (incoming.pathname === "/api/ops-tools/visitor" && request.method === "GET") {
      return handleEdgeLocale(request);
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
