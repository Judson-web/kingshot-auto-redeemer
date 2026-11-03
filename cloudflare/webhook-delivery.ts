interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_WRITE_MODE?: string;
  V4_WEBHOOK_ENCRYPTION_KEY?: string;
  V4_WEBHOOK_WORKER_SECRET?: string;
  CRON_SECRET?: string;
  WEBHOOK_BLOCKED_ZONE?: string;
}

type Delivery = {
  id: string;
  webhook_id: string;
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempt_count: number;
  lease_token: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_ATTEMPTS = 8;
const MAX_BODY_BYTES = 32 * 1024;

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  } });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function database(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!base || !key) throw new Error("database_unconfigured");
  const response = await fetch(base + path, {
    ...init,
    headers: { apikey: key, authorization: "Bearer " + key, "content-type": "application/json", ...(init.headers || {}) },
    signal: init.signal || AbortSignal.timeout(6000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error("database_request_failed");
  return body;
}

async function decryptSecret(env: Env, value: string): Promise<string> {
  const encodedKey = String(env.V4_WEBHOOK_ENCRYPTION_KEY || "");
  if (!/^[0-9a-f]{64}$/i.test(encodedKey)) throw new Error("webhook_encryption_unconfigured");
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("webhook_secret_invalid");
  const keyBytes = new Uint8Array(encodedKey.match(/.{2}/g)!.map(pair => parseInt(pair, 16)));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const iv = fromBase64Url(parts[0]);
  const tag = fromBase64Url(parts[1]);
  const ciphertext = fromBase64Url(parts[2]);
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, combined);
  return decoder.decode(plain);
}

async function signature(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(timestamp + "." + body))));
}

function safeTarget(value: string, blockedZone: string): URL | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const zone = blockedZone.toLowerCase().replace(/^\.+|\.+$/g, "");
    const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
    const privateName = host === "localhost" || host.endsWith(".localhost") ||
      host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".");
    const ownZone = host === zone || host.endsWith("." + zone);
    if (url.protocol !== "https:" || url.username || url.password ||
        (url.port && url.port !== "443") || ipv4 || host.includes(":") ||
        privateName || ownZone || host.length > 253) return null;
    return url;
  } catch { return null; }
}

function retryDelay(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const parsed = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(parsed) && parsed > 0) return Math.min(6 * 60 * 60 * 1000, parsed);
  }
  return Math.min(6 * 60 * 60 * 1000, 30_000 * Math.pow(2, Math.min(attempt - 1, 10)));
}

async function finish(env: Env, row: Delivery, status: number): Promise<void> {
  const result = await database(env, "/rest/v1/rpc/kingshot_developer_finish_webhook_delivery", {
    method: "POST",
    body: JSON.stringify({ p_delivery_id: row.id, p_lease_token: row.lease_token, p_status: status }),
  });
  if (result !== true) throw new Error("delivery_lease_lost");
}

async function retry(env: Env, row: Delivery, status: number | null, message: string, terminal: boolean, retryAfter: string | null = null): Promise<void> {
  const attempt = Number(row.attempt_count || 1);
  const next = new Date(Date.now() + retryDelay(attempt, retryAfter)).toISOString();
  const result = await database(env, "/rest/v1/rpc/kingshot_developer_retry_webhook_delivery", {
    method: "POST",
    body: JSON.stringify({
      p_delivery_id: row.id,
      p_lease_token: row.lease_token,
      p_next_attempt_at: next,
      p_status: status,
      p_error: message.slice(0, 300),
      p_terminal: terminal || attempt >= MAX_ATTEMPTS,
    }),
  });
  if (result !== true) throw new Error("delivery_lease_lost");
}

async function deliverOne(env: Env, row: Delivery, blockedZone: string): Promise<"delivered" | "retried" | "terminal"> {
  try {
    const hooks = await database(env, "/rest/v1/kingshot_developer_webhooks?select=url,events,secret_ciphertext,disabled_at&id=eq." +
      encodeURIComponent(row.webhook_id) + "&limit=1");
    const hook = Array.isArray(hooks) ? hooks[0] : null;
    if (!hook || hook.disabled_at || !Array.isArray(hook.events) ||
        !hook.events.includes(row.event_type) || !hook.secret_ciphertext) {
      await retry(env, row, null, "subscription disabled or invalid", true);
      return "terminal";
    }

    const target = safeTarget(String(hook.url || ""), blockedZone);
    if (!target) {
      await retry(env, row, null, "destination rejected by webhook egress policy", true);
      return "terminal";
    }

    const body = JSON.stringify({
      id: row.event_id,
      type: row.event_type,
      createdAt: new Date().toISOString(),
      data: row.payload,
    });
    if (encoder.encode(body).byteLength > MAX_BODY_BYTES) {
      await retry(env, row, null, "webhook payload exceeded the delivery size limit", true);
      return "terminal";
    }

    const secret = await decryptSecret(env, String(hook.secret_ciphertext));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const digest = await signature(secret, timestamp, body);
    // Cloudflare's outbound HTTP proxy enforces public-Internet destination policy at egress.
    // Manual redirects prevent a public endpoint from redirecting the Worker to another host.
    const response = await fetch(target.toString(), {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "user-agent": "Kingshot-Auto-Redeemer-Webhooks/1.0",
        "X-Kingshot-Event": row.event_type,
        "X-Kingshot-Event-Id": row.event_id,
        "X-Kingshot-Timestamp": timestamp,
        "X-Kingshot-Signature": "sha256=" + digest,
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
    try { await response.body?.cancel(); } catch {}

    if (response.status >= 200 && response.status < 300) {
      await finish(env, row, response.status);
      return "delivered";
    }

    const redirect = response.status >= 300 && response.status < 400;
    const retryable = [408, 425, 429].includes(response.status) || response.status >= 500;
    await retry(env, row, response.status,
      redirect ? "redirects are not followed by webhook delivery" : "destination returned HTTP " + response.status,
      redirect || !retryable,
      response.headers.get("Retry-After"));
    return redirect || !retryable || Number(row.attempt_count) >= MAX_ATTEMPTS ? "terminal" : "retried";
  } catch (error) {
    const attempt = Number(row.attempt_count || 1);
    const terminal = attempt >= MAX_ATTEMPTS;
    await retry(env, row, null, terminal ? "delivery retry limit reached" : "network or delivery processing error", terminal);
    return terminal ? "terminal" : "retried";
  }
}

export async function handleNativeWebhookDelivery(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  const supplied = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const expected = [env.V4_WEBHOOK_WORKER_SECRET, env.CRON_SECRET].filter((value): value is string => Boolean(value));
  if (!expected.some(secret => constantTimeEqual(supplied, secret))) {
    return json(401, { ok: false, error: "unauthorized" });
  }
  if (String(env.SUPABASE_WRITE_MODE || "").toLowerCase() !== "enabled") {
    return json(503, { ok: false, error: "writes_disabled" });
  }
  const encryption = String(env.V4_WEBHOOK_ENCRYPTION_KEY || "");
  if (!/^[0-9a-f]{64}$/i.test(encryption)) return json(503, { ok: false, error: "webhook_encryption_unconfigured" });
  const blockedZone = String(env.WEBHOOK_BLOCKED_ZONE || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(blockedZone)) {
    return json(503, { ok: false, error: "webhook_egress_zone_unconfigured" });
  }

  try {
    const claimed = await database(env, "/rest/v1/rpc/kingshot_developer_claim_webhook_deliveries", {
      method: "POST",
      body: JSON.stringify({ p_limit: 20, p_lease_seconds: 90 }),
    });
    const rows: Delivery[] = Array.isArray(claimed) ? claimed : [];
    let delivered = 0, retried = 0, terminal = 0;
    for (const row of rows) {
      const outcome = await deliverOne(env, row, blockedZone);
      if (outcome === "delivered") delivered++;
      else if (outcome === "retried") retried++;
      else terminal++;
    }
    return json(200, { ok: true, processed: rows.length, delivered, retryScheduled: retried, terminal });
  } catch {
    return json(503, { ok: false, error: "webhook_delivery_unavailable" });
  }
}
