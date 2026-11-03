import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { handleNativeV4 } from "../cloudflare/developer-v4.ts";

const KEY = "ks_live_" + "a".repeat(64);
const KEY_ID = "11111111-1111-4111-8111-111111111111";
const BASE = "https://supabase.example.test";

function request(body, idempotencyKey) {
  const headers = {
    Authorization: "Bearer " + KEY,
    "CF-Connecting-IP": "203.0.113.10",
    "Content-Type": "application/json",
  };
  if (idempotencyKey !== undefined) headers["Idempotency-Key"] = idempotencyKey;
  return new Request("https://edge.example.test/api/v4/redemptions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function env() {
  return {
    SUPABASE_URL: BASE,
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-only",
    SUPABASE_WRITE_MODE: "disabled",
  };
}

function mockSupabase(t, handlers) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const name = url.split("/").pop().split("?")[0];
    calls.push({ name, body: init.body ? JSON.parse(String(init.body)) : null });
    if (name === "kingshot_developer_authorize_key") {
      return Response.json({
        allowed: true,
        key_id: KEY_ID,
        scopes: ["redemptions:write"],
        limit: 60,
        remaining: 59,
        daily_remaining: 999,
      });
    }
    if (handlers[name]) return handlers[name](init);
    throw new Error("Unexpected network request: " + url);
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

test("native V4 redemption is scope-authorized and remains write-disabled in preview", async t => {
  const calls = mockSupabase(t, {});
  const response = await handleNativeV4(request({ playerId: "43180889", code: "A", kid: "1125" }), env());
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.success, false);
  assert.equal(body.error.code, "writes_disabled");
  assert.deepEqual(calls.map(call => call.name), ["kingshot_developer_authorize_key"]);
  assert.equal(calls.some(call => /gift_code|redemption_journal/.test(call.name)), false);
});

test("native V4 redemption releases an idempotency claim when writes are disabled before submission", async t => {
  const calls = mockSupabase(t, {
    kingshot_developer_v4_begin_redemption: () => Response.json({ state: "started" }),
    kingshot_developer_v4_release_redemption: () => Response.json(true),
  });

  const response = await handleNativeV4(
    request({ playerId: "43180889", code: "A", kid: "1125" }, "redeem-request-001"),
    env(),
  );
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error.code, "writes_disabled");
  assert.deepEqual(calls.map(call => call.name), [
    "kingshot_developer_authorize_key",
    "kingshot_developer_v4_begin_redemption",
    "kingshot_developer_v4_release_redemption",
  ]);
  assert.match(calls[1].body.p_key_hash, /^[0-9a-f]{64}$/);
  assert.match(calls[1].body.p_request_hash, /^[0-9a-f]{64}$/);
});

test("native V4 replays the stored outcome with a fresh request ID and never resubmits", async t => {
  const calls = mockSupabase(t, {
    kingshot_developer_v4_begin_redemption: () => Response.json({
      state: "replay",
      response_status: 200,
      response_body: {
        success: true,
        data: { ok: true, status: "SUCCESS", message: "Redeemed." },
        error: null,
        meta: { apiVersion: "4", requestId: "old-request", timestamp: "2026-01-01T00:00:00.000Z" },
      },
    }),
  });

  const response = await handleNativeV4(
    request({ playerId: "43180889", code: "A", kid: "1125" }, "redeem-request-001"),
    env(),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Idempotency-Replayed"), "true");
  assert.equal(body.success, true);
  assert.equal(body.data.status, "SUCCESS");
  assert.notEqual(body.meta.requestId, "old-request");
  assert.deepEqual(calls.map(call => call.name), [
    "kingshot_developer_authorize_key",
    "kingshot_developer_v4_begin_redemption",
  ]);
});

test("native V4 rejects a reused idempotency key with a different request body", async t => {
  const calls = mockSupabase(t, {
    kingshot_developer_v4_begin_redemption: () => Response.json({ state: "conflict" }),
  });
  const response = await handleNativeV4(
    request({ playerId: "43180889", code: "OTHER", kid: "1125" }, "redeem-request-001"),
    env(),
  );
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, "idempotency_key_reused");
  assert.equal(calls.length, 2);
});

test("native V4 rejects malformed idempotency headers before starting a redemption", async t => {
  const calls = mockSupabase(t, {});
  const response = await handleNativeV4(
    request({ playerId: "43180889", code: "EXAMPLE", kid: "1125" }, "bad key"),
    env(),
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error.code, "invalid_idempotency_key");
  assert.deepEqual(calls.map(call => call.name), ["kingshot_developer_authorize_key"]);
});

test("V4 redemption idempotency SQL never expires or reopens unknown outcomes", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20261103120000_v4_native_redemption_idempotency.sql", import.meta.url), "utf8");
  assert.match(sql, /kingshot_developer_v4_redemption_idempotency/);
  assert.match(sql, /state = 'unknown'/);
  assert.match(sql, /return jsonb_build_object\('state', 'unknown'/);
  assert.match(sql, /kingshot_developer_v4_release_redemption/);
  assert.doesNotMatch(sql, /expires_at/);
  assert.doesNotMatch(sql, /set state = 'processing'/);
});
