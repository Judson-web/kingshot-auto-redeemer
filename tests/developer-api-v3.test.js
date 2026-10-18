import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeV3PlayerId, validateV3RedemptionBody } from "../lib/developer-api-v3-validation.js";
import { normalizeV3PlayerData, normalizeV3ProviderMetadata } from "../lib/api-v3/contracts.js";
import { shouldRetryProviderRead, withBoundedProviderReadRetry } from "../lib/api-v3/retry.js";
import { readIdempotencyKey } from "../lib/api-v3/idempotency.js";
test("V3 player IDs accept numeric strings from 5 to 20 digits", () => {
  assert.equal(normalizeV3PlayerId("43180889"), "43180889");
  assert.equal(normalizeV3PlayerId(" 43180889 "), "43180889");
  for (const input of ["1234", "123456789012345678901", "12abc34", 43180889, null, undefined, ""]) assert.equal(normalizeV3PlayerId(input), null);
});
test("V3 redemption validation accepts and normalizes valid string inputs", () => {
  assert.deepEqual(validateV3RedemptionBody({ playerId: "43180889", code: "EXAMPLE_CODE-1", kid: "1125" }), {
    valid: true, value: { playerId: "43180889", code: "EXAMPLE_CODE-1", kid: "1125" }
  });
});
test("V3 redemption validation rejects extra fields, wrong types and malformed values", () => {
  assert.equal(validateV3RedemptionBody({ playerId: "43180889", code: "OK", kid: "1125", admin: true }).code, "unknown_fields");
  assert.equal(validateV3RedemptionBody({ playerId: 43180889, code: "OK", kid: "1125" }).code, "invalid_player_id");
  assert.equal(validateV3RedemptionBody({ playerId: "43180889", code: "bad code", kid: "1125" }).code, "invalid_gift_code");
  assert.equal(validateV3RedemptionBody({ playerId: "43180889", code: "OK", kid: "1a25" }).code, "invalid_kingdom_id");
  assert.equal(validateV3RedemptionBody([]).code, "invalid_request_body");
});
test("V3 player contract normalizes values and rejects provider ID mismatches", () => {
  assert.deepEqual(normalizeV3PlayerData({
    player_id: "43180889", nick_name: "  Sharkyo\n", kid: 280, power: "411851257",
    town_center_level: "69", avatar_url: "https://example.com/avatar.png",
    alliance: { name: "The Wind", abbr: "WIND" }
  }, "43180889"), {
    playerId: "43180889", name: "Sharkyo", kingdomId: "280", power: 411851257,
    townCenterLevel: 69, avatarUrl: "https://example.com/avatar.png",
    allianceName: "The Wind", allianceTag: "WIND"
  });
  assert.equal(normalizeV3PlayerData({ player_id: "43180889", avatar_url: "http://example.com/a.png" }, "43180889").avatarUrl, null);
  assert.throws(() => normalizeV3PlayerData({ player_id: "99999999" }, "43180889"), { code: "provider_player_mismatch" });
  assert.throws(() => normalizeV3PlayerData(null, "43180889"), { code: "invalid_provider_payload" });
});
test("V3 provider metadata avoids invalid and negative ages", () => {
  assert.deepEqual(normalizeV3ProviderMetadata({ cached_at: "not-a-date", fresh: null, age_seconds: -2 }), {
    fetchedAt: null, providerFresh: null, providerAgeSeconds: null, stale: null
  });
  assert.deepEqual(normalizeV3ProviderMetadata({ cached_at: "2026-10-17T12:21:00.000Z", fresh: true, age_seconds: 15.9 }), {
    fetchedAt: "2026-10-17T12:21:00.000Z", providerFresh: true, providerAgeSeconds: 15, stale: false
  });
});
test("bounded provider read retry succeeds after a transient failure", async () => {
  let calls = 0;
  const value = await withBoundedProviderReadRetry(async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("fetch failed");
    return { playerId: "43180889" };
  }, { delayMs: 0 });
  assert.equal(calls, 2);
  assert.deepEqual(value, { playerId: "43180889" });
});
test("provider read retry does not repeat permanent or throttled errors", async () => {
  assert.equal(shouldRetryProviderRead({ status: 404 }), false);
  assert.equal(shouldRetryProviderRead({ status: 429 }), false);
  assert.equal(shouldRetryProviderRead({ status: 503 }), true);
  assert.equal(shouldRetryProviderRead(new Error("API key is not configured")), false);
  let calls = 0;
  await assert.rejects(withBoundedProviderReadRetry(async () => {
    calls += 1;
    const error = new Error("Player not found");
    error.status = 404;
    throw error;
  }, { delayMs: 0 }));
  assert.equal(calls, 1);
});
test("bounded provider read retry stops after two attempts", async () => {
  let calls = 0;
  await assert.rejects(withBoundedProviderReadRetry(async () => {
    calls += 1;
    throw new TypeError("fetch failed");
  }, { delayMs: 0 }));
  assert.equal(calls, 2);
});
test("V3 routes stay wired through the existing serverless handler", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(config.rewrites.some(r => r.source === "/api/v3/players/:playerId" && r.destination.includes("developer=v3-player")));
  assert.ok(config.rewrites.some(r => r.source === "/api/v3/redemptions" && r.destination.includes("developer=v3-redemptions")));
  const router = await readFile(new URL("../api/kingshot-player.ts", import.meta.url), "utf8");
  assert.match(router, /developerPath\.startsWith\("v3-"\)/);
  assert.match(router, /developerApiV3\(req, res, developerPath\.slice\(3\)\)/);
});

test("V3 idempotency key validation",()=>{assert.deepEqual(readIdempotencyKey({headers:{}}),{present:false,valid:true,key:""});assert.equal(readIdempotencyKey({headers:{"idempotency-key":"redeem-1234"}}).valid,true);assert.equal(readIdempotencyKey({headers:{"idempotency-key":"short"}}).valid,false);assert.equal(readIdempotencyKey({headers:{"idempotency-key":"has spaces"}}).valid,false);assert.equal(readIdempotencyKey({headers:{"idempotency-key":"x".repeat(129)}}).valid,false)});
