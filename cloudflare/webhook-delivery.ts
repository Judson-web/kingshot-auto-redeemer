interface Env {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_WRITE_MODE?: string;
  V4_WEBHOOK_ENCRYPTION_KEY?: string;
  V4_WEBHOOK_WORKER_SECRET?: string;
  EGRESS?: Fetcher;
}

interface Delivery {
  id: string;
  webhook_id: string;
  event_id: string;
  event_type: "redemption.completed" | "redemption.unknown";
  payload: Record<string, unknown>;
  attempt_count: number;
  lease_token: string;
  created_at?: string;
}

interface Subscription {
  url: string;
  events: string[];
  secret_ciphertext: string | null;
  disabled_at: string | null;
}

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function equalSecret(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_webhook_ciphertext");
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function decryptWebhookSecret(env: Env, value: string): Promise<string> {
  const hex = String(env.V4_WEBHOOK_ENCRYPTION_KEY || "");
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("webhook_encryption_unconfigured");
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("invalid_webhook_ciphertext");
  const keyBytes = new Uint8Array(hex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const iv = decodeBase64Url(parts[0]);
  const tag = decodeBase64Url(parts[1]);
  const ciphertext = decodeBase64Url(parts[2]);
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > 65536) throw new Error("invalid_webhook_ciphertext");
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, combined);
  return new TextDecoder().decode(plain);
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {
    name: "HMAC", hash: "SHA-256",
  }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function database(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const service = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!base || !service) throw new Error("database_unconfigured");
  const result = await fetch(base + path, {
    ...init,
    headers: {
      apikey: service,
      authorization: "Bearer " + service,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
    signal: init.signal || AbortSignal.timeout(8000),
  });
  const body = await result.json().catch(() => null);
  if (!result.ok) throw new Error("database_request_failed_" + result.status);
  return body;
}

function validDeliveryUrl(value: string): URL | null {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
    const ipv6 = host.includes(":");
    if (url.protocol !== "https:" || url.username || url.password ||
        (url.port && url.port !== "443") || ipv4 || ipv6 ||
        host === "localhost" || host.endsWith(".localhost") ||
        host.endsWith(".local") || host.endsWith(".internal") ||
        !host.includes(".") || host.length > 253) return null;
    return url;
  } catch {
    return null;
  }
}

function retryDelaySeconds(attempt: number): number {
  return Math.min(21600, 30 * Math.pow(2, Math.min(attempt, 10)));
}

async function finishDelivery(
  env: Env,
  delivery: Delivery,
  options: { delivered: boolean; terminal: boolean; status: number | null; error: string | null; retryAt: string | null },
): Promise<void> {
  const result = await database(env, "/rest/v1/rpc/kingshot_developer_webhook_finish_delivery", {
    method: "POST",
    body: JSON.stringify({
      p_delivery_id: delivery.id,
      p_lease_token: delivery.lease_token,
      p_delivered: options.delivered,
      p_terminal: options.terminal,
      p_status: options.status,
      p_error: options.error?.slice(0, 300) || null,
      p_retry_at: options.retryAt,
    }),
  });
  if (result !== true) throw new Error("delivery_lease_lost");
}

async function deliverOne(env: Env, delivery: Delivery): Promise<"delivered" | "retry" | "terminal"> {
  const rows = await database(env,
    "/rest/v1/kingshot_developer_webhooks?select=url,events,secret_ciphertext,disabled_at&id=eq." +
    encodeURIComponent(delivery.webhook_id) + "&limit=1");
  const subscription = Array.isArray(rows) ? rows[0] as Subscription | undefined : undefined;
  if (!subscription || subscription.disabled_at ||
      !Array.isArray(subscription.events) || !subscription.events.includes(delivery.event_type) ||
      !subscription.secret_ciphertext) {
    await finishDelivery(env, delivery, {
      delivered: false, terminal: true, status: null, error: "subscription disabled or invalid", retryAt: null,
    });
    return "terminal";
  }

  const target = validDeliveryUrl(String(subscription.url || ""));
  if (!target) {
    await finishDelivery(env, delivery, {
      delivered: false, terminal: true, status: null, error: "subscription URL failed delivery validation", retryAt: null,
    });
    return "terminal";
  }

  const secret = await decryptWebhookSecret(env, subscription.secret_ciphertext);
  const createdAt = new Date().toISOString();
  const body = JSON.stringify({
    id: delivery.event_id,
    type: delivery.event_type,
    createdAt: delivery.created_at || createdAt,
    data: delivery.payload,
  });
  if (body.length > 65536) {
    await finishDelivery(env, delivery, {
      delivered: false, terminal: true, status: null, error: "event payload exceeds 64 KiB", retryAt: null,
    });
    return "terminal";
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await hmac(secret, timestamp + "." + body);
  let response: Response;
  try {
    // This is intentionally the only destination fetch path. There is no global-fetch fallback.
    // The EGRESS binding routes DNS and the connection through Cloudflare Gateway policies.
    response = await env.EGRESS!.fetch(target.toString(), {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "user-agent": "Kingshot-Auto-Redeemer-Webhooks/1.0",
        "X-Kingshot-Event": delivery.event_type,
        "X-Kingshot-Event-Id": delivery.event_id,
        "X-Kingshot-Timestamp": timestamp,
        "X-Kingshot-Signature": "sha256=" + signature,
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    const attempt = Number(delivery.attempt_count || 1);
    const terminal = attempt >= 8;
    const message = String((error as Error)?.message || "destination request failed").slice(0, 300);
    await finishDelivery(env, delivery, {
      delivered: false,
      terminal,
      status: null,
      error: terminal ? "retry limit reached: " + message : message,
      retryAt: terminal ? null : new Date(Date.now() + retryDelaySeconds(attempt) * 1000).toISOString(),
    });
    return terminal ? "terminal" : "retry";
  }

  try { await response.body?.cancel(); } catch {}
  if (response.status >= 200 && response.status < 300) {
    await finishDelivery(env, delivery, {
      delivered: true, terminal: false, status: response.status, error: null, retryAt: null,
    });
    return "delivered";
  }

  const attempt = Number(delivery.attempt_count || 1);
  const retryable = response.status === 408 || response.status === 425 ||
    response.status === 429 || response.status >= 500;
  const terminal = !retryable || attempt >= 8;
  const message = "destination returned HTTP " + response.status;
  await finishDelivery(env, delivery, {
    delivered: false,
    terminal,
    status: response.status,
    error: terminal && retryable ? "retry limit reached: " + message : message,
    retryAt: terminal ? null : new Date(Date.now() + retryDelaySeconds(attempt) * 1000).toISOString(),
  });
  return terminal ? "terminal" : "retry";
}

export async function handleWebhookDeliveryDispatch(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  if (String(env.SUPABASE_WRITE_MODE || "").toLowerCase() !== "enabled") {
    return json(503, { ok: false, error: "writes_disabled" });
  }
  if (!env.EGRESS || typeof env.EGRESS.fetch !== "function") {
    return json(503, { ok: false, error: "secure_egress_unconfigured" });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.V4_WEBHOOK_ENCRYPTION_KEY) {
    return json(503, { ok: false, error: "delivery_secrets_unconfigured" });
  }
  const expected = String(env.V4_WEBHOOK_WORKER_SECRET || env.CRON_SECRET || "");
  const authorization = request.headers.get("Authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!expected || !equalSecret(supplied, expected)) return json(401, { ok: false, error: "unauthorized" });

  try {
    const rows = await database(env, "/rest/v1/rpc/kingshot_developer_webhook_claim_deliveries", {
      method: "POST",
      body: JSON.stringify({ p_limit: 10, p_lease_seconds: 90 }),
    });
    const due = Array.isArray(rows) ? rows as Delivery[] : [];
    let delivered = 0;
    let retried = 0;
    let terminal = 0;
    for (const delivery of due) {
      try {
        const outcome = await deliverOne(env, delivery);
        if (outcome === "delivered") delivered++;
        else if (outcome === "retry") retried++;
        else terminal++;
      } catch (error) {
        // A failed DB write leaves the lease to expire; another dispatcher can safely reclaim it.
        console.error("[v4-webhook-delivery]", String((error as Error)?.message || "delivery failed"));
        return json(503, { ok: false, error: "delivery_state_unavailable", processed: delivered + retried + terminal });
      }
    }
    return json(200, { ok: true, processed: due.length, delivered, retryScheduled: retried, terminal });
  } catch (error) {
    console.error("[v4-webhook-dispatch]", String((error as Error)?.message || "dispatch failed"));
    return json(503, { ok: false, error: "dispatcher_unavailable" });
  }
}
