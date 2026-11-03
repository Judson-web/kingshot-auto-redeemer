import { dispatchLegacyApi } from "./legacy-api-adapter.js";

interface Env {
  CRON_SECRET?: string;
  [key: string]: unknown;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "kingshot-autoredeemer-shard" }, {
        headers: { "Cache-Control": "no-store" }
      });
    }

    if (url.pathname !== "/api/kingshot-auto" || url.searchParams.get("mode") !== "worker") {
      return Response.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    const secret = String(env.CRON_SECRET || "");
    if (!secret || request.headers.get("authorization") !== "Bearer " + secret) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }

    const adapted = await dispatchLegacyApi(request, {
      waitUntil: promise => ctx.waitUntil(promise),
      env
    });
    return adapted || Response.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
};
