import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("native V4 webhook routes support listing, creation, and scoped revocation", async () => {
  const source = await readFile(new URL("../cloudflare/developer-v4.ts", import.meta.url), "utf8");
  assert.match(source, /webhookMatch =/);
  assert.match(source, /route === "webhook-item"/);
  assert.match(source, /route === "webhooks" \? \["GET", "POST"\]/);
  assert.match(source, /route === "webhook-item" \? \["DELETE"\]/);
  assert.match(source, /key_id=eq\." \+ encodeURIComponent\(auth\.keyId\)/);
  assert.match(source, /disabled_at: new Date\(\)\.toISOString\(\)/);
});

test("native webhook mutations fail closed before authorization or database writes", async () => {
  const source = await readFile(new URL("../cloudflare/developer-v4.ts", import.meta.url), "utf8");
  const guard = source.indexOf('if ((route === "redemptions" || (route === "webhooks" && method === "POST") || route === "webhook-item")');
  const authorization = source.indexOf("const auth = await authorize", guard);
  assert.ok(guard >= 0 && authorization > guard);
  assert.match(source, /SUPABASE_WRITE_MODE/);
});

test("webhook signing secrets use Workers Web Crypto and legacy-compatible AES-GCM storage", async () => {
  const source = await readFile(new URL("../cloudflare/developer-v4.ts", import.meta.url), "utf8");
  assert.match(source, /crypto\.subtle\.importKey\("raw", keyBytes, \{ name: "AES-GCM" \}/);
  assert.match(source, /crypto\.subtle\.encrypt\(\{ name: "AES-GCM", iv \}/);
  assert.match(source, /return base64Url\(iv\) \+ "\." \+ base64Url\(tag\) \+ "\." \+ base64Url\(ciphertext\)/);
  assert.match(source, /secret_hash: await sha256\(secret\)/);
  assert.match(source, /secret_ciphertext: ciphertext/);
});

test("webhook registration rejects unsafe URL forms and delivery uses guarded manual egress", async () => {
  const source = await readFile(new URL("../cloudflare/developer-v4.ts", import.meta.url), "utf8");
  assert.match(source, /url\.protocol !== "https:"/);
  assert.match(source, /url\.username \|\| url\.password/);
  assert.match(source, /isIpv4 \|\| isIpv6/);
  assert.match(source, /host === "localhost"/);
  assert.match(source, /host\.endsWith\("\.local"\)/);
  assert.match(source, /host\.endsWith\("\.internal"\)/);
  assert.doesNotMatch(source, /fetch\(hook\.url/);
});

test("V4 webhook API documents that delivery remains paused pending secure egress", async () => {
  const docs = await readFile(new URL("../public/developer-v4.md", import.meta.url), "utf8");
  assert.match(docs, /Delivery is currently paused/);
  assert.match(docs, /connection time/);
  assert.match(docs, /V4_WEBHOOK_ENCRYPTION_KEY/);
});


test("native webhook delivery is authenticated, write-gated, and requires the app zone boundary", async () => {
  const worker = await readFile(new URL("../cloudflare/webhook-delivery.ts", import.meta.url), "utf8");
  const auth = worker.indexOf("if (!expected.some(secret => constantTimeEqual(supplied, secret)))");
  const writeGate = worker.indexOf('if (String(env.SUPABASE_WRITE_MODE || "").toLowerCase() !== "enabled")');
  const claim = worker.indexOf('kingshot_developer_claim_webhook_deliveries');
  assert.ok(auth >= 0 && writeGate > auth && claim > writeGate);
  assert.match(worker, /webhook_egress_zone_unconfigured/);
  assert.match(worker, /WEBHOOK_BLOCKED_ZONE/);
  assert.match(worker, /host === zone \\|\\| host\\.endsWith\\("\\." \\+ zone\\)/);
});

test("webhook delivery uses Cloudflare guarded fetch, manual redirects, bounded requests, and signatures", async () => {
  const worker = await readFile(new URL("../cloudflare/webhook-delivery.ts", import.meta.url), "utf8");
  assert.match(worker, /redirect: "manual"/);
  assert.match(worker, /AbortSignal\\.timeout\\(5000\\)/);
  assert.match(worker, /Cloudflare's outbound HTTP proxy/);
  assert.match(worker, /X-Kingshot-Signature/);
  assert.match(worker, /X-Kingshot-Event-Id/);
  assert.match(worker, /status >= 300 && response\\.status < 400/);
  assert.match(worker, /MAX_ATTEMPTS = 8/);
});

test("webhook delivery queue claims are atomic and completion is fenced by lease token", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261103140000_v4_webhook_delivery_leases.sql", import.meta.url), "utf8");
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /lease_token = gen_random_uuid\\(\\)/i);
  assert.match(sql, /lease_until/);
  assert.match(sql, /attempt_count = d\\.attempt_count \\+ 1/i);
  assert.match(sql, /where id = p_delivery_id\\s+and lease_token = p_lease_token/i);
  assert.match(sql, /grant execute on function public\\.kingshot_developer_claim_webhook_deliveries/);
});

test("native V4 redemption outcomes enqueue webhook events without blocking the response", async () => {
  const source = await readFile(new URL("../cloudflare/developer-v4.ts", import.meta.url), "utf8");
  assert.match(source, /enqueueNativeWebhookEvent/);
  assert.match(source, /"redemption\\.completed" : "redemption\\.unknown"/);
  assert.match(source, /delivery event could not be persisted/);
});
