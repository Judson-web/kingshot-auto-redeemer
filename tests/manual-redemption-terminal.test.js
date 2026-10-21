import test from "node:test";
import assert from "node:assert/strict";
import { normalizeKingshotStatus, redeemKingshot } from "../internal/kingshot/redeem.ts";

test("normalizes invalid gift-code response variants into one terminal status", () => {
  assert.equal(normalizeKingshotStatus("CDK NOT FOUND", 40014), "CDK_NOT_FOUND");
  assert.equal(normalizeKingshotStatus("cdk_not_found", null), "CDK_NOT_FOUND");
  assert.equal(normalizeKingshotStatus("CODE NOT FOUND", "40014"), "CDK_NOT_FOUND");
  assert.equal(normalizeKingshotStatus("INVALID GIFT CODE", undefined), "CDK_NOT_FOUND");
});

test("rejects malformed manual code input before making an upstream request", async () => {
  const oldFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    throw new Error("Upstream must not be called for malformed input");
  };
  try {
    const result = await redeemKingshot({ playerId: "43180889", code: "BAD!", kid: "1125" });
    assert.equal(result.httpStatus, 400);
    assert.equal(result.status, "INVALID_INPUT");
    assert.equal(result.errorCategory, "INVALID_INPUT");
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("a well-formed but unknown manual code is submitted exactly once and returns a terminal result", async () => {
  const oldFetch = globalThis.fetch;
  const oldSecret = process.env.KINGSHOT_API_SECRET;
  let requests = 0;
  process.env.KINGSHOT_API_SECRET = "test-only-secret";
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({ msg: "CDK NOT FOUND", err_code: "40014" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const result = await redeemKingshot({ playerId: "43180889", code: "FAKECODE999", kid: "1125" });
    assert.equal(requests, 1, "non-idempotent redemptions must never be automatically retried");
    assert.equal(result.httpStatus, 400);
    assert.equal(result.ok, false);
    assert.equal(result.status, "CDK_NOT_FOUND");
    assert.equal(result.errorCategory, "INVALID_CODE");
    assert.equal(result.statusLabel, "Code not found.");
  } finally {
    globalThis.fetch = oldFetch;
    if (oldSecret === undefined) delete process.env.KINGSHOT_API_SECRET;
    else process.env.KINGSHOT_API_SECRET = oldSecret;
  }
});

test("treats numeric string error codes the same as numeric codes", () => {
  assert.equal(normalizeKingshotStatus("Unknown Error", "40014"), "CDK_NOT_FOUND");
  assert.equal(normalizeKingshotStatus("Time Error", "40007"), "TIME_ERROR");
});
