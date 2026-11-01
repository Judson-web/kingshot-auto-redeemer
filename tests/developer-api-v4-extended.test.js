import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("V4 extended endpoints enforce scopes and bounded history/roster requests",async()=>{const s=await readFile(new URL("../lib/api-v4/extended.ts",import.meta.url),"utf8");assert.match(s,/insufficient_scope/);assert.match(s,/Math\.min\(100/);assert.match(s,/redemption-history/);});
test("Webhook delivery is signed, bounded, retryable, and blocks private targets",async()=>{const s=await readFile(new URL("../lib/api-v4/webhooks.ts",import.meta.url),"utf8");assert.match(s,/createHmac\("sha256"/);assert.match(s,/assertPublicWebhookUrl/);assert.match(s,/attempt>=8/);assert.match(s,/redirect:"manual"/);assert.match(s,/expectedSecrets\.some\(secret=>equal\(supplied,secret\)\)/);});
test("V4 migration protects webhook records and supports scopes and expiry",async()=>{const s=await readFile(new URL("../supabase/migrations/20261030100000_v4_integration_features.sql",import.meta.url),"utf8");assert.match(s,/enable row level security/i);assert.match(s,/expires_at/);assert.match(s,/scopes text\[\]/);assert.match(s,/public\.kingshot_developer_webhook_deliveries/);});
test("Developer panel keeps usage inline and exposes key controls",async()=>{const s=await readFile(new URL("../src/DeveloperAccountPanel.tsx",import.meta.url),"utf8");assert.match(s,/saveSettings/);assert.match(s,/type="date"/);assert.match(s,/developer\.lastUsed/);});

test("Developer panel exposes session-managed webhook subscription controls",async()=>{const panel=await readFile(new URL("../src/DeveloperAccountPanel.tsx",import.meta.url),"utf8");assert.match(panel,/developer-webhooks-title/);assert.match(panel,/createWebhook/);assert.match(panel,/disableWebhook/);assert.match(panel,/webhookSecret/);});
test("Session webhook management verifies owned active keys and webhook scope",async()=>{const s=await readFile(new URL("../lib/developer-account.ts",import.meta.url),"utf8");assert.match(s,/action==="webhooks"/);assert.match(s,/kingshot_developer_account_list_keys/);assert.match(s,/webhooks:manage/);assert.match(s,/assertPublicWebhookUrl/);assert.match(s,/createCipheriv\("aes-256-gcm"/);});

test("V4 webhook scheduler retries the secondary secret only after an authentication rejection",async()=>{
 const workflow=await readFile(new URL("../.github/workflows/developer-v4-webhook-delivery.yml",import.meta.url),"utf8");
 assert.match(workflow,/WORKER_SECRET_PRIMARY: \$\{\{ secrets\.V4_WEBHOOK_WORKER_SECRET \}\}/);
 assert.match(workflow,/WORKER_SECRET_FALLBACK: \$\{\{ secrets\.CRON_SECRET \}\}/);
 assert.match(workflow,/if \[ "\$http_code" != "401" \]/);
 assert.match(workflow,/Neither configured GitHub Actions secret was accepted/);
});
