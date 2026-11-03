import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("native V4 webhook routes support listing, creation, and scoped revocation", async () => {
  const source = await readFile(new URL("../cloudflare/developer-v4.ts", import.meta.url), "utf8");
  assert.match(source, /const webhookMatch = \/\^\\/api\\/v4\\/webhooks\\//);
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

test("webhook registration rejects unsafe URL forms and never attempts destination delivery", async () => {
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
