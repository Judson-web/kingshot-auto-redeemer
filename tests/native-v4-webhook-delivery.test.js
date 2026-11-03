import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("native webhook delivery uses only the Cloudflare Gateway egress binding", async () => {
  const source = await readFile(new URL("../cloudflare/webhook-delivery.ts", import.meta.url), "utf8");
  assert.match(source, /env\.EGRESS!\.fetch/);
  assert.doesNotMatch(source, /(?<!\.)\bfetch\(target/);
  assert.match(source, /redirect: "manual"/);
  assert.match(source, /secure_egress_unconfigured/);
  assert.match(source, /SUPABASE_WRITE_MODE/);
});

test("native webhook delivery signs payloads with HMAC SHA-256 and decrypts legacy AES-GCM secrets", async () => {
  const source = await readFile(new URL("../cloudflare/webhook-delivery.ts", import.meta.url), "utf8");
  assert.match(source, /name: "AES-GCM"/);
  assert.match(source, /tagLength: 128/);
  assert.match(source, /name: "HMAC", hash: "SHA-256"/);
  assert.match(source, /toString\(16\)\.padStart\(2, "0"\)/);
  assert.match(source, /X-Kingshot-Signature/);
  assert.match(source, /timestamp \+ "\." \+ body/);
});

test("webhook delivery rejects unsafe URL forms and bounds retries and payload size", async () => {
  const source = await readFile(new URL("../cloudflare/webhook-delivery.ts", import.meta.url), "utf8");
  assert.match(source, /url\.protocol !== "https:"/);
  assert.match(source, /host\.endsWith\("\.internal"\)/);
  assert.match(source, /new TextEncoder\(\)\.encode\(body\)\.byteLength > 65536/);
  assert.match(source, /attempt >= 8/);
  assert.match(source, /response\.status >= 500/);
});

test("webhook delivery claims rows atomically and finalizes only matching leases", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20261103150000_v4_secure_webhook_delivery.sql", import.meta.url), "utf8");
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /attempt_count = d\.attempt_count \+ 1/);
  assert.match(migration, /lease_token = gen_random_uuid\(\)/);
  assert.match(migration, /where d\.id = p_delivery_id/);
  assert.match(migration, /and d\.lease_token = p_lease_token/);
  assert.match(migration, /p_limit > 25/);
});

test("native Worker exposes an internal, write-gated webhook dispatcher", async () => {
  const source = await readFile(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");
  assert.match(source, /handleWebhookDeliveryDispatch/);
  assert.match(source, /\/api\/internal\/v4\/webhooks\/dispatch/);
});
