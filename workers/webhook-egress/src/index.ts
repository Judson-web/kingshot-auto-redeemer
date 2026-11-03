export interface Env {
  EGRESS: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  RELAY_SECRET: string;
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) difference |= (a[i] || 0) ^ (b[i] || 0);
  return difference === 0;
}

async function readTextWithinLimit(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function validTarget(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
    // Do not accept IP literals. DNS names are resolved on the Gateway-routed egress path,
    // where the account's Workers VPC IPv4/IPv6 deny policies are enforced.
    if (host.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

const allowedHeaders = [
  "content-type", "user-agent", "x-kingshot-event", "x-kingshot-event-id",
  "x-kingshot-timestamp", "x-kingshot-signature"
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
    const authorization = request.headers.get("authorization") || "";
    const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!env.RELAY_SECRET || !constantTimeEqual(supplied, env.RELAY_SECRET)) return Response.json({ error: "unauthorized" }, { status: 401 });

    let input: { url?: unknown; headers?: unknown; body?: unknown };
    try {
      const raw = await readTextWithinLimit(request, 96_000);
      if (raw === null) return Response.json({ error: "payload_too_large" }, { status: 413 });
      input = JSON.parse(raw);
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return Response.json({ error: "invalid_delivery" }, { status: 400 });
    }
    if (!validTarget(input.url) || typeof input.body !== "string" ||
        new TextEncoder().encode(input.body).byteLength > 64_000 ||
        !input.headers || typeof input.headers !== "object" || Array.isArray(input.headers)) {
      return Response.json({ error: "invalid_delivery" }, { status: 400 });
    }
    const headers = new Headers();
    const incoming = new Map(Object.entries(input.headers as Record<string, unknown>).map(([name, value]) => [name.toLowerCase(), value]));
    for (const name of allowedHeaders) {
      const value = incoming.get(name);
      if (typeof value === "string" && new TextEncoder().encode(value).byteLength <= 2048 &&
          !/[\r\n]/.test(value)) headers.set(name, value);
      else if (value !== undefined) return Response.json({ error: "invalid_delivery_headers" }, { status: 400 });
    }
    if (!headers.get("content-type")?.toLowerCase().startsWith("application/json") ||
        !headers.has("x-kingshot-event-id") || !headers.has("x-kingshot-signature") ||
        !headers.has("x-kingshot-timestamp")) {
      return Response.json({ error: "missing_signed_delivery_headers" }, { status: 400 });
    }

    try {
      // This binding is essential: ordinary global fetch() bypasses the Workers VPC
      // Gateway egress route and must never be used for subscriber destinations.
      const response = await env.EGRESS.fetch(input.url, {
        method: "POST",
        headers,
        body: input.body,
        redirect: "manual"
      });
      const status = response.status;
      await response.body?.cancel().catch(() => undefined);
      return Response.json({ status }, { status: 200, headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ error: "gateway_egress_failed" }, { status: 502 });
    }
  }
};
