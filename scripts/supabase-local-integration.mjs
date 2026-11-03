import assert from "node:assert/strict";

function envValue(name) {
  return String(process.env[name] || "").trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
}

const apiUrl = envValue("API_URL").replace(/\/$/, "");
const serviceKey = envValue("SERVICE_ROLE_KEY");
const anonKey = envValue("ANON_KEY");

assert.ok(apiUrl, "Supabase local API_URL is required");
assert.ok(serviceKey, "Supabase local SERVICE_ROLE_KEY is required");
assert.ok(anonKey, "Supabase local ANON_KEY is required");

async function request(path, { key = serviceKey, method = "GET", body, headers = {} } = {}) {
  return fetch(apiUrl + path, {
    method,
    headers: {
      apikey: key,
      authorization: "Bearer " + key,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function rpc(name, body, key = serviceKey) {
  const response = await request("/rest/v1/rpc/" + name, { method: "POST", body, key });
  const raw = await response.text();
  let parsed = raw;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  return { response, body: parsed };
}

const authHealth = await request("/auth/v1/health", { key: anonKey });
assert.equal(authHealth.status, 200, "local Supabase Auth health endpoint should be ready");

const keyId = "11111111-1111-4111-8111-111111111111";
const keyHash = "e".repeat(64);
const requestHash = "f".repeat(64);
let result = await rpc("kingshot_developer_v4_begin_redemption", {
  p_key_id: keyId,
  p_key_hash: keyHash,
  p_request_hash: requestHash,
});
assert.equal(result.response.status, 200, JSON.stringify(result.body));
assert.equal(result.body.state, "started");

result = await rpc("kingshot_developer_v4_finish_redemption", {
  p_key_id: keyId,
  p_key_hash: keyHash,
  p_response_status: 200,
  p_response_body: { success: true, source: "local-supabase-stack" },
  p_outcome_unknown: false,
});
assert.equal(result.response.status, 200, JSON.stringify(result.body));
assert.equal(result.body, true);

result = await rpc("kingshot_developer_v4_begin_redemption", {
  p_key_id: keyId,
  p_key_hash: keyHash,
  p_request_hash: requestHash,
});
assert.equal(result.body.state, "replay");

result = await rpc("kingshot_developer_v4_begin_redemption", {
  p_key_id: keyId,
  p_key_hash: keyHash,
  p_request_hash: "a".repeat(64),
});
assert.equal(result.body.state, "conflict");

const anonymousAttempt = await rpc("kingshot_developer_v4_begin_redemption", {
  p_key_id: keyId,
  p_key_hash: "b".repeat(64),
  p_request_hash: requestHash,
}, anonKey);
assert.ok(!anonymousAttempt.response.ok, "anon must not execute the privileged idempotency RPC");

const deliveryInsert = await request("/rest/v1/kingshot_developer_webhook_deliveries", {
  method: "POST",
  body: {
    webhook_id: "22222222-2222-4222-8222-222222222222",
    event_id: "33333333-3333-4333-8333-333333333333",
    event_type: "redemption.completed",
    payload: { test: true },
  },
  headers: { Prefer: "return=representation" },
});
const deliveryInsertRaw = await deliveryInsert.text();
assert.equal(deliveryInsert.status, 201, deliveryInsertRaw);
const inserted = JSON.parse(deliveryInsertRaw);
assert.equal(inserted.length, 1);

result = await rpc("kingshot_developer_webhook_claim_deliveries", {
  p_limit: 1,
  p_lease_seconds: 90,
});
assert.equal(result.response.status, 200, JSON.stringify(result.body));
assert.equal(result.body.length, 1);
const delivery = result.body[0];
assert.equal(delivery.id, inserted[0].id);
assert.ok(delivery.lease_token);

result = await rpc("kingshot_developer_webhook_finish_delivery", {
  p_delivery_id: delivery.id,
  p_lease_token: "44444444-4444-4444-8444-444444444444",
  p_delivered: true,
  p_terminal: false,
  p_status: 204,
  p_error: null,
  p_retry_at: null,
});
assert.equal(result.body, false, "wrong lease token must be rejected");

result = await rpc("kingshot_developer_webhook_finish_delivery", {
  p_delivery_id: delivery.id,
  p_lease_token: delivery.lease_token,
  p_delivered: true,
  p_terminal: false,
  p_status: 204,
  p_error: null,
  p_retry_at: null,
});
assert.equal(result.body, true, "matching lease token should complete the delivery");

const anonymousDeliveryInsert = await request("/rest/v1/kingshot_developer_webhook_deliveries", {
  method: "POST",
  key: anonKey,
  body: {
    webhook_id: "55555555-5555-4555-8555-555555555555",
    event_id: "66666666-6666-4666-8666-666666666666",
    event_type: "redemption.unknown",
    payload: { shouldBeDenied: true },
  },
});
assert.ok(!anonymousDeliveryInsert.ok, "anon must not insert into the private delivery queue");

console.log("Supabase local Auth + PostgREST + V4 RPC integration passed");
