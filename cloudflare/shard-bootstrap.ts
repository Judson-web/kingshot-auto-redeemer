/**
 * Temporary deployment entrypoint used only to create the private shard Worker
 * before production secrets are synchronized. The deployment workflow replaces
 * this entrypoint with shard-worker.ts before completing.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "kingshot-autoredeemer-shard", phase: "bootstrap" }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    return Response.json({ error: "Shard is being initialized." }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "30" },
    });
  },
};
