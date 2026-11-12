import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Cloudflare Worker routes Discord PKCE profile auth and API keys through the native account adapter", async () => {
  const router = await readFile(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");
  const legacyApi = await readFile(new URL("../api/kingshot-player.ts", import.meta.url), "utf8");
  const adapter = await readFile(new URL("../cloudflare/developer-account.ts", import.meta.url), "utf8");
  assert.match(router, /handleNativeDeveloperAccount/);
  assert.match(router, /developerPath === "account-auth"\) return handleNativeDeveloperAccount\(request, env, "auth"\)/);
  assert.match(router, /developerPath === "account-keys"/);
  assert.match(router, /dispatchLegacyApi\(request/);
  assert.match(legacyApi, /developerPath === "account-auth"\) return developerAuth\(req, res\)/);
  assert.match(legacyApi, /developerPath === "account-keys"\) return developerAccount\(req, res\)/);
  assert.match(adapter, /kingshot_developer_account_session_get/);
  assert.match(adapter, /kingshot_developer_account_session_create/);
  assert.match(adapter, /kingshot_developer_account_create_key/);
  assert.match(adapter, /kingshot_developer_account_update_key_settings/);
  assert.match(adapter, /kingshot_developer_account_revoke_key/);
});

test("native Cloudflare auth supports the app's Discord PKCE login and account checks", async () => {
  const adapter = await readFile(new URL("../cloudflare/developer-account.ts", import.meta.url), "utf8");
  assert.match(adapter, /profile-discord-url/);
  assert.match(adapter, /android-discord-url/);
  assert.match(adapter, /profile-oauth-exchange/);
  assert.match(adapter, /dev-discord-oauth-url/);
  assert.match(adapter, /dev-oauth-exchange/);
  assert.match(adapter, /auth\/v1\/token\?grant_type=pkce/);
  assert.match(adapter, /code_challenge_method", "s256"/);
  assert.match(adapter, /action === "profile-check"/);
  assert.match(adapter, /action === "dev-check"/);
  const startAction = adapter.indexOf('if (startActions.has(action))');
  const writeGate = adapter.indexOf('if (!allowedWrite(env)) return json(503');
  assert.ok(startAction >= 0 && writeGate > startAction,
    "OAuth URL creation and session checks must remain available before the database-write gate");
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

test("native Discord account webhook management validates API-key ownership and supports list/create/disable", async () => {
  const adapter = await readFile(new URL("../cloudflare/developer-account.ts", import.meta.url), "utf8");
  assert.match(adapter, /const webhookAction = url\.searchParams\.get\("action"\) === "webhooks"/);
  assert.match(adapter, /Choose an active API key owned by this Discord account/);
  assert.match(adapter, /kingshot_developer_webhooks/);
  assert.match(adapter, /method === "POST"/);
  assert.match(adapter, /method === "GET"/);
  assert.match(adapter, /method === "DELETE"/);
  assert.doesNotMatch(adapter, /webhook_management_not_migrated/);
});

test("account webhook mutations are write-gated and secrets are encrypted with Web Crypto", async () => {
  const adapter = await readFile(new URL("../cloudflare/developer-account.ts", import.meta.url), "utf8");
  assert.match(adapter, /webhookAction && method !== "GET" && !allowedWrite\(env\)/);
  assert.match(adapter, /crypto\.subtle\.importKey\("raw", bytes, \{ name: "AES-GCM" \}/);
  assert.match(adapter, /crypto\.subtle\.encrypt\(\{ name: "AES-GCM", iv \}/);
  assert.match(adapter, /deliveryStatus: "paused_pending_secure_egress"/);
});

test("native logout reports server-side revocation failures after clearing browser cookies", async () => {
  const adapter = await readFile(new URL("../cloudflare/developer-account.ts", import.meta.url), "utf8");
  assert.match(adapter, /Promise\.allSettled\(hashes\.map/);
  assert.match(adapter, /serverSessionRevoked = results\.every/);
  assert.match(adapter, /status: 503|json\(503/);
  assert.match(adapter, /localSessionCleared: true, serverSessionRevoked: false/);
});

test("Android Discord sign-in uses the dedicated native OAuth action and pins the native callback", async () => {
  const repository = await readFile(new URL("../android/app/src/main/java/com/judson/kingshot/autoredeemer/data/RedeemerRepository.kt", import.meta.url), "utf8");
  const profile = await readFile(new URL("../src/ProfileApp.tsx", import.meta.url), "utf8");
  assert.match(repository, /addProperty\("action", "android-discord-url"\)/);
  assert.match(repository, /redirect\.host == "app\.ks-redeemer\.workers\.dev"/);
  assert.match(repository, /redirect\.getQueryParameter\("native"\) == "1"/);
  assert.match(repository, /redirect\.getQueryParameter\("provider"\) == "discord"/);
  assert.match(profile, /nativeCallback && callbackError/);
  assert.match(profile, /ksredeemer:\/\/discord-callback\?error=/);
  assert.match(profile, /ksredeemer:\/\/discord-callback\?code=/);
  assert.doesNotMatch(repository, /addProperty\("action", "profile-discord-url"\)/);
});

test("Android account UI handles OAuth callback failures and avoids exposing the legacy developer-only warning", async () => {
  const activity = await readFile(new URL("../android/app/src/main/java/com/judson/kingshot/autoredeemer/MainActivity.kt", import.meta.url), "utf8");
  assert.match(activity, /authCallbackError/);
  assert.match(activity, /LaunchedEffect\(authCode, authError\)/);
  assert.match(activity, /LaunchedEffect\(Unit\)/);
  assert.match(activity, /if \(authCode\.isNullOrBlank\(\) && authError\.isNullOrBlank\(\)\) return@LaunchedEffect/);
  assert.match(activity, /Checking account session/);
  assert.match(activity, /Retry account check/);
  assert.match(activity, /Administration/);
});
