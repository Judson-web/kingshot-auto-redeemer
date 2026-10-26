import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeV4Response, namespaceV4IdempotencyKey } from "../lib/api-v4/contract.js";

const DEV = {
  name: "Judson",
  discord: "@judson00713",
  url: "https://discord.com/users/871756466900598815"
};

test("V4 success envelopes always expose success, data, error, and canonical metadata", () => {
  const response = normalizeV4Response({
    data: { playerId: "43180889", name: "Sharkyo" },
    meta: {
      apiVersion: "3",
      requestId: "request-123",
      timestamp: "2026-10-26T10:00:00.000Z",
      source: "mightpulse",
      rateLimit: { perMinuteLimit: 60, perMinuteRemaining: 59 },
      stale: false
    }
  }, 200, "fallback-id", "fixed-now");
  assert.equal(response.success, true);
  assert.deepEqual(response.data, { playerId: "43180889", name: "Sharkyo" });
  assert.equal(response.error, null);
  assert.deepEqual(response.meta, {
    source: "mightpulse",
    rateLimit: { perMinuteLimit: 60, perMinuteRemaining: 59 },
    stale: false,
    apiVersion: "4",
    requestId: "request-123",
    timestamp: "2026-10-26T10:00:00.000Z"
  });
  assert.deepEqual(response.dev, DEV);
});

test("V4 HTTP-successful redemption responses can contain a rejected in-game result", () => {
  const response = normalizeV4Response({
    data: { ok: false, status: "ERROR", message: "Code already used", errorCategory: "ALREADY_REDEEMED" },
    meta: { requestId: "redeem-id", timestamp: "2026-10-26T10:00:00.000Z" }
  }, 200, "fallback-id", "fixed-now");
  assert.equal(response.success, true, "success indicates the API request was processed, not that rewards were granted");
  assert.equal(response.data.ok, false);
  assert.equal(response.error, null);
});

test("V4 error envelopes always set data to null and carry a stable error object", () => {
  const response = normalizeV4Response({
    error: { code: "player_not_found", message: "No player was found." },
    meta: { apiVersion: "3", requestId: "not-found-id", timestamp: "2026-10-26T10:00:00.000Z", rateLimit: { perDayRemaining: 999 } }
  }, 404, "fallback-id", "fixed-now");
  assert.equal(response.success, false);
  assert.equal(response.data, null);
  assert.deepEqual(response.error, { code: "player_not_found", message: "No player was found." });
  assert.equal(response.meta.apiVersion, "4");
  assert.equal(response.meta.requestId, "not-found-id");
  assert.deepEqual(response.meta.rateLimit, { perDayRemaining: 999 });
  assert.deepEqual(response.dev, DEV);
});

test("V4 error envelopes provide safe fallbacks for malformed upstream error bodies", () => {
  const response = normalizeV4Response(null, 502, "request-fallback", "fixed-now");
  assert.equal(response.success, false);
  assert.equal(response.data, null);
  assert.deepEqual(response.error, {
    code: "request_failed",
    message: "The request could not be completed."
  });
  assert.equal(response.meta.requestId, "request-fallback");
  assert.equal(response.meta.timestamp, "fixed-now");
});

test("V4 idempotency keys are deterministic, safe, and separated from V3 key space", () => {
  const v3Key = "redeem-request-123";
  const v4Key = namespaceV4IdempotencyKey(v3Key);
  assert.equal(v4Key, namespaceV4IdempotencyKey(v3Key));
  assert.notEqual(v4Key, v3Key);
  assert.match(v4Key, /^v4_[a-f0-9]{64}$/);
  assert.ok(v4Key.length <= 128);
});

test("V4 routes are wired through the existing player serverless function without changing V3 routes", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(config.rewrites.some(route => route.source === "/api/v4/players/:playerId" && route.destination.includes("developer=v4-player")));
  assert.ok(config.rewrites.some(route => route.source === "/api/v4/redemptions" && route.destination.includes("developer=v4-redemptions")));
  assert.ok(config.rewrites.some(route => route.source === "/api/v3/players/:playerId" && route.destination.includes("developer=v3-player")));
  assert.ok(config.rewrites.some(route => route.source === "/api/v3/redemptions" && route.destination.includes("developer=v3-redemptions")));
  const router = await readFile(new URL("../api/kingshot-player.ts", import.meta.url), "utf8");
  assert.match(router, /developerPath\.startsWith\("v4-"\)/);
  assert.match(router, /developerApiV4\(req, res, developerPath\.slice\(3\)\)/);
});
