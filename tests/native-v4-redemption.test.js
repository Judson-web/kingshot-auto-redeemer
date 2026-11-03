import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("native V4 redemption is routed through Bearer authorization and the write-scoped adapter", async () => {
  const adapter = await readFile(new URL("../cloudflare/developer-v4.ts", import.meta.url), "utf8");
  const redemption = await readFile(new URL("../cloudflare/redemption.ts", import.meta.url), "utf8");
  assert.ok(adapter.includes('url.pathname === "/api/v4/redemptions"'));
  assert.ok(adapter.includes("redemptions:write"));
  assert.ok(adapter.includes("handleV4Redemption(request, env, auth, requestId, h)"));
  assert.ok(adapter.includes("handleNativeRedemption(request, env, { v4: true })"));
  assert.ok(redemption.includes("SUPABASE_WRITE_MODE"));
  assert.ok(redemption.includes("NEON_RECOVERY_DATABASE_URL"));
  assert.ok(redemption.includes("journalStart(env,pid,code)"));
  assert.ok(redemption.includes("journalResult(env,pid,code,result)"));
  assert.ok(redemption.includes("journalUncertain(env,pid,code"));
  assert.ok(redemption.includes("retryAfterSeconds:result.retryAfterSeconds??null"));
});

test("native V4 idempotency hashes namespaced keys and canonical request bodies", async () => {
  const adapter = await readFile(new URL("../cloudflare/developer-v4.ts", import.meta.url), "utf8");
  assert.ok(adapter.includes('sha256("v4_" + await sha256(idempotencyKey))'));
  assert.ok(adapter.includes("sha256(JSON.stringify(normalizedRequest))"));
  assert.ok(adapter.includes("kingshot_developer_v4_begin_redemption"));
  assert.ok(adapter.includes("kingshot_developer_v4_finish_redemption"));
  assert.ok(adapter.includes("kingshot_developer_v4_release_redemption"));
  assert.ok(adapter.includes('h.set("Idempotency-Replayed", "true")'));
  assert.ok(adapter.includes('"idempotency_key_reused"'));
  assert.ok(adapter.includes('"idempotency_in_progress"'));
});

test("V4 only releases an idempotency claim for known pre-submission failures", async () => {
  const adapter = await readFile(new URL("../cloudflare/developer-v4.ts", import.meta.url), "utf8");
  assert.ok(adapter.includes('safeToRelease = ["writes_disabled", "redemption_unavailable", "upstream_cooldown", "rate_limit_exceeded"]'));
  assert.ok(adapter.includes('"redemption_outcome_needs_review"'));
  assert.ok(adapter.includes("p_outcome_unknown: outcomeUnknown"));
  assert.ok(adapter.includes('retryHint: hasIdempotencyKey ? "same_idempotency_key" : "do_not_retry"'));
});

test("native V4 supports the documented code length without weakening the manual endpoint", async () => {
  const redemption = await readFile(new URL("../cloudflare/redemption.ts", import.meta.url), "utf8");
  assert.ok(redemption.includes("options.v4?/^[A-Za-z0-9_-]{1,64}$/"));
  assert.ok(redemption.includes("/^[A-Za-z0-9_-]{6,32}$/"));
  assert.ok(redemption.includes("!options.v4&&limited(req)"));
});

test("V4 idempotency SQL never expires or reopens unknown outcomes", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261103120000_v4_native_redemption_idempotency.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("kingshot_developer_v4_redemption_idempotency"));
  assert.ok(sql.includes("state = 'unknown'"));
  assert.ok(sql.includes("return jsonb_build_object('state', 'unknown'"));
  assert.ok(sql.includes("kingshot_developer_v4_release_redemption"));
  assert.doesNotMatch(sql, /expires_at\s+timestamptz/);
  assert.doesNotMatch(sql, /set state = 'processing'/);
});

test("write-disabled preview rejects V4 redemption before authorization or idempotency RPCs", async () => {
  const adapter = await readFile(new URL("../cloudflare/developer-v4.ts", import.meta.url), "utf8");
  const guard = adapter.indexOf('if ((route === "redemptions" || (route === "webhooks" && method === "POST") || route === "webhook-item") && String(env.SUPABASE_WRITE_MODE || "").toLowerCase() !== "enabled")');
  const authorization = adapter.indexOf("const auth = await authorize(request, env, requestId, h)");
  assert.ok(guard >= 0 && authorization > guard, "the preview write gate must run before quota authorization");
  assert.match(adapter.slice(guard, authorization), /writes_disabled/);
});
