import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Cloudflare Worker routes Discord developer sessions and API keys natively", async () => {
  const router = await readFile(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");
  const adapter = await readFile(new URL("../cloudflare/developer-account.ts", import.meta.url), "utf8");
  assert.match(router, /handleNativeDeveloperAccount/);
  assert.match(router, /developerPath === "account-auth"/);
  assert.match(router, /developerPath === "account-keys"/);
  assert.match(adapter, /kingshot_developer_account_session_get/);
  assert.match(adapter, /kingshot_developer_account_session_create/);
  assert.match(adapter, /kingshot_developer_account_create_key/);
  assert.match(adapter, /kingshot_developer_account_update_key_settings/);
  assert.match(adapter, /kingshot_developer_account_revoke_key/);
});

test("native developer sessions verify Discord with Supabase and use host-only secure cookies", async () => {
  const adapter = await readFile(new URL("../cloudflare/developer-account.ts", import.meta.url), "utf8");
  assert.match(adapter, /auth\/v1\/user/);
  assert.match(adapter, /provider === "discord"/);
  assert.match(adapter, /__Host-ks_developer_session/);
  assert.match(adapter, /__Host-ks_profile_session/);
  assert.match(adapter, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(adapter, /60 \* 60 \* 24 \* 60/);
});

test("preview account mutations fail closed before Supabase RPC writes", async () => {
  const adapter = await readFile(new URL("../cloudflare/developer-account.ts", import.meta.url), "utf8");
  assert.match(adapter, /if \(!allowedWrite\(env\)\) return json\(503/);
  assert.match(adapter, /writes_disabled/);
  const oauthGate = adapter.indexOf('if (!allowedWrite(env)) return json(503');
  const oauthCreate = adapter.indexOf('kingshot_developer_account_session_create');
  assert.ok(oauthGate >= 0 && oauthCreate > oauthGate);
  const keysGate = adapter.indexOf('if (!allowedWrite(env)) return json(503', oauthGate + 1);
  const keyCreate = adapter.indexOf('kingshot_developer_account_create_key');
  assert.ok(keysGate >= 0 && keyCreate > keysGate);
});

test("native account adapter trusts only Cloudflare's connecting IP for key issuance", async () => {
  const adapter = await readFile(new URL("../cloudflare/developer-account.ts", import.meta.url), "utf8");
  assert.match(adapter, /request\.headers\.get\("CF-Connecting-IP"\)/);
  assert.doesNotMatch(adapter, /x-vercel-forwarded-for|x-forwarded-for/i);
});

test("webhook management remains explicitly unavailable until its SSRF-safe native port is ready", async () => {
  const adapter = await readFile(new URL("../cloudflare/developer-account.ts", import.meta.url), "utf8");
  assert.match(adapter, /webhook_management_not_migrated/);
});

test("native logout reports server-side revocation failures after clearing browser cookies", async () => {
  const adapter = await readFile(new URL("../cloudflare/developer-account.ts", import.meta.url), "utf8");
  assert.match(adapter, /Promise\.allSettled\(hashes\.map/);
  assert.match(adapter, /serverSessionRevoked = results\.every/);
  assert.match(adapter, /status: 503|json\(503/);
  assert.match(adapter, /localSessionCleared: true, serverSessionRevoked: false/);
});
