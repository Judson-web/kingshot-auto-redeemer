import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("native V4 redemption is routed through Bearer authorization and the write-scoped adapter", async () => {
  const adapter = await readFile(new URL("../cloudflare/developer-v4.ts", import.meta.url), "utf8");
  const redemption = await readFile(new URL("../cloudflare/redemption.ts", import.meta.url), "utf8");
  assert.match(adapter, /url\.pathname === "\/api\/v4\/redemptions"/);
  assert.match(adapter, /redemptions:write/);
  assert.match(adapter, /handleV4Redemption\(request, env, auth, requestId, h\)/);
  assert.match(adapter, /handleNativeRedemption\(request, env, \{ v4: true \}\)/);
  assert.match(redemption, /SUPABASE_WRITE_MODE/);
  assert.match(redemption, /NEON_RECOVERY_DATABASE_URL/);
  assert.match(redemption, /journalStart\(env, pid, code\)/);
  assert.match(redemption, /journalResult\(env, pid, code, result\)/);
  assert.match(redemption, /journalUncertain\(env, pid, code/);
});

test("native V4 idempotency hashes namespaced keys and canonical request bodies", async () => {
  const adapter = await readFile(new URL("../cloudflare/developer-v4.ts", import.meta.url), "utf8");
  assert.match(adapter, /sha256\("v4_" \+ await sha256\(idempotencyKey\)\)/);
  assert.match(adapter, /sha256\(JSON\.stringify\(normalizedRequest\)\)/);
  assert.match(adapter, /kingshot_developer_v4_begin_redemption/);
  assert.match(adapter, /kingshot_developer_v4_finish_redemption/);
  assert.match(adapter, /kingshot_developer_v4_release_redemption/);
  assert.match(adapter, /Idempotency-Replayed/);
  assert.match(adapter, /idempotency_key_reused/);
  assert.match(adapter, /idempotency_in_progress/);
});

test("V4 only releases an idempotency claim for known pre-submission failures", async () => {
  const adapter = await readFile(new URL("../cloudflare/developer-v4.ts", import.meta.url), "utf8");
  assert.match(adapter, /safeToRelease = \["writes_disabled", "redemption_unavailable", "upstream_cooldown", "rate_limit_exceeded"\]/);
  assert.match(adapter, /redemption_outcome_needs_review/);
  assert.match(adapter, /p_outcome_unknown: outcomeUnknown/);
  assert.match(adapter, /retryHint: hasIdempotencyKey \? "same_idempotency_key" : "do_not_retry"/);
});

test("native V4 supports the documented code length without weakening the manual endpoint", async () => {
  const redemption = await readFile(new URL("../cloudflare/redemption.ts", import.meta.url), "utf8");
  assert.match(redemption, /options\.v4\?\/\^\[A-Za-z0-9_-\]\{1,64\}\$\//);
  assert.match(redemption, /\^\[A-Za-z0-9_-\]\{6,32\}\$/);
  assert.match(redemption, /!options\.v4&&limited\(req\)/);
});

test("V4 idempotency SQL never expires or reopens unknown outcomes", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261103120000_v4_native_redemption_idempotency.sql", import.meta.url), "utf8");
  assert.match(sql, /kingshot_developer_v4_redemption_idempotency/);
  assert.match(sql, /state = 'unknown'/);
  assert.match(sql, /return jsonb_build_object\('state', 'unknown'/);
  assert.match(sql, /kingshot_developer_v4_release_redemption/);
  assert.doesNotMatch(sql, /expires_at\\s+timestamptz/);
  assert.doesNotMatch(sql, /set state = 'processing'/);
});
