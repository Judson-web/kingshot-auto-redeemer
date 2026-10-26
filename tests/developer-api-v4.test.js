import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createV4Error,
  normalizeV4Response,
  namespaceV4IdempotencyKey,
  readV4IdempotencyKey
} from "../lib/api-v4/contract.js";

const DEV = {
  name: "Judson",
  discord: "@judson00713",
  url: "https://discord.com/users/871756466900598815"
};

test("V4 success envelopes use the current request ID and timestamp, preserving business metadata", () => {
  const response = normalizeV4Response({
    data: { playerId: "43180889", name: "Sharkyo" },
    meta: {
      apiVersion: "3",
      requestId: "stored-request-id",
      timestamp: "2026-01-01T00:00:00.000Z",
      source: "mightpulse",
      rateLimit: { perMinuteLimit: 60, perMinuteRemaining: 59 },
      stale: false
    }
  }, 200, "current-request-id", "2026-10-26T10:00:00.000Z");
  assert.equal(response.success, true);
  assert.deepEqual(response.data, { playerId: "43180889", name: "Sharkyo" });
  assert.equal(response.error, null);
  assert.deepEqual(response.meta, {
    source: "mightpulse",
    rateLimit: { perMinuteLimit: 60, perMinuteRemaining: 59 },
    stale: false,
    apiVersion: "4",
    requestId: "current-request-id",
    timestamp: "2026-10-26T10:00:00.000Z"
  });
  assert.deepEqual(response.dev, DEV);
});

test("V4 HTTP-successful redemption responses can contain a rejected in-game result", () => {
  const response = normalizeV4Response({
    data: { ok: false, status: "ERROR", message: "Code already used", errorCategory: "ALREADY_REDEEMED" },
    meta: { requestId: "redeem-id", timestamp: "2026-10-26T10:00:00.000Z" }
  }, 200, "current-redeem-request", "2026-10-26T10:00:01.000Z", { route: "redemptions" });
  assert.equal(response.success, true, "success indicates the API request was processed, not that rewards were granted");
  assert.equal(response.data.ok, false);
  assert.equal(response.error, null);
  assert.equal(response.meta.requestId, "current-redeem-request");
  assert.equal(response.meta.timestamp, "2026-10-26T10:00:01.000Z");
});

test("V4 error envelopes always set data to null and carry a stable, actionable error", () => {
  const response = normalizeV4Response({
    error: { code: "player_not_found", message: "No player was found." },
    meta: { apiVersion: "3", requestId: "old-id", timestamp: "2026-01-01T00:00:00.000Z", rateLimit: { perDayRemaining: 999 } }
  }, 404, "current-error-request", "2026-10-26T10:00:00.000Z", { route: "player" });
  assert.equal(response.success, false);
  assert.equal(response.data, null);
  assert.deepEqual(response.error, {
    code: "player_not_found",
    message: "No player was found.",
    retryable: false,
    retryHint: "do_not_retry"
  });
  assert.equal(response.meta.apiVersion, "4");
  assert.equal(response.meta.requestId, "current-error-request");
  assert.equal(response.meta.timestamp, "2026-10-26T10:00:00.000Z");
  assert.deepEqual(response.meta.rateLimit, { perDayRemaining: 999 });
  assert.deepEqual(response.dev, DEV);
});

test("V4 error envelopes provide safe fallbacks for malformed upstream error bodies", () => {
  const response = normalizeV4Response(null, 502, "request-fallback", "2026-10-26T10:00:00.000Z", { route: "player" });
  assert.equal(response.success, false);
  assert.equal(response.data, null);
  assert.deepEqual(response.error, {
    code: "request_failed",
    message: "The request could not be completed.",
    retryable: true,
    retryHint: "bounded_backoff"
  });
  assert.equal(response.meta.requestId, "request-fallback");
  assert.equal(response.meta.timestamp, "2026-10-26T10:00:00.000Z");
});

test("V4 retry guidance distinguishes rate limits, ambiguous redemptions, and permanent errors", () => {
  const limited = createV4Error("rate_limit_exceeded", "Slow down.", 429, "redemptions", {
    resetAt: "2026-10-26T10:00:15.000Z"
  }, "2026-10-26T10:00:00.000Z", "15");
  assert.deepEqual(limited, {
    code: "rate_limit_exceeded",
    message: "Slow down.",
    retryable: true,
    retryHint: "honor_retry_after",
    retryAfterSeconds: 15
  });

  const ambiguous = normalizeV4Response({
    error: { code: "upstream_timeout", message: "Timed out." },
    meta: { resetAt: "2026-10-26T10:00:15.000Z" }
  }, 504, "request-504", "2026-10-26T10:00:00.000Z", { route: "redemptions", idempotencyKeyPresent: true });
  assert.equal(ambiguous.error.retryable, true);
  assert.equal(ambiguous.error.retryHint, "same_idempotency_key");

  const unkeyedAmbiguous = normalizeV4Response({
    error: { code: "upstream_timeout", message: "Timed out." },
    meta: {}
  }, 504, "request-504-unkeyed", "2026-10-26T10:00:00.000Z", { route: "redemptions", idempotencyKeyPresent: false });
  assert.equal(unkeyedAmbiguous.error.retryable, false);
  assert.equal(unkeyedAmbiguous.error.retryHint, "do_not_retry");

  const inProgress = createV4Error("idempotency_in_progress", "Still processing.", 409, "redemptions");
  assert.equal(inProgress.retryable, true);
  assert.equal(inProgress.retryHint, "same_idempotency_key");

  const permanent = createV4Error("idempotency_key_reused", "Different body.", 409, "redemptions");
  assert.equal(permanent.retryable, false);
  assert.equal(permanent.retryHint, "do_not_retry");
});

test("V4 idempotency header parsing rejects duplicates and malformed values", () => {
  assert.deepEqual(readV4IdempotencyKey({ headers: {} }), { present: false, valid: true, key: "" });
  assert.deepEqual(readV4IdempotencyKey({ headers: { "idempotency-key": "redeem-request-123" } }), {
    present: true, valid: true, key: "redeem-request-123"
  });
  assert.equal(readV4IdempotencyKey({ headers: { "IDEMPOTENCY-KEY": "redeem-request-123" } }).valid, true);
  assert.equal(readV4IdempotencyKey({ headers: { "idempotency-key": ["redeem-request-123", "redeem-request-456"] } }).valid, false);
  assert.equal(readV4IdempotencyKey({ headers: { "idempotency-key": "redeem-request-123", "Idempotency-Key": "redeem-request-456" } }).valid, false);
  assert.equal(readV4IdempotencyKey({ headers: { "idempotency-key": "redeem-request-123, redeem-request-456" } }).valid, false);
  assert.equal(readV4IdempotencyKey({ headers: { "idempotency-key": "short" } }).valid, false);
  assert.equal(readV4IdempotencyKey({ headers: { "idempotency-key": "has spaces" } }).valid, false);
  assert.equal(readV4IdempotencyKey({ headers: { "idempotency-key": "x".repeat(129) } }).valid, false);
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

test("V4 routes reject ambiguous idempotency headers before dispatching to the V3 adapter", async () => {
  const adapter = await readFile(new URL("../lib/developer-api-v4.ts", import.meta.url), "utf8");
  assert.match(adapter, /readV4IdempotencyKey\(req\)/);
  assert.match(adapter, /invalid_idempotency_key/);
  assert.match(adapter, /filter\(\(\[name\]\) => name\.toLowerCase\(\) !== "idempotency-key"\)/);
});

test("V4 OpenAPI schemas, examples, and reference docs stay aligned", async () => {
  const spec = JSON.parse(await readFile(new URL("../public/openapi.json", import.meta.url), "utf8"));
  assert.equal(spec.info.version, "4.0.0");
  assert.ok(spec.paths["/api/v4/players/{playerId}"]?.get);
  assert.ok(spec.paths["/api/v4/redemptions"]?.post);
  assert.equal(spec.paths["/api/v4/redemptions"].post.requestBody.content["application/json"].schema.$ref, "#/components/schemas/ApiV4RedemptionRequest");
  assert.equal(spec.components.schemas.ApiV4Meta.properties.apiVersion.const, "4");
  assert.deepEqual(spec.components.schemas.ApiV4ErrorResponse.required, ["success", "data", "error", "meta", "dev"]);
  assert.deepEqual(spec.components.schemas.ApiV4Error.required, ["code", "message", "retryable", "retryHint"]);
  assert.deepEqual(spec.components.schemas.ApiV4Error.properties.retryHint.enum, ["do_not_retry", "honor_retry_after", "bounded_backoff", "same_idempotency_key"]);
  assert.ok(spec.paths["/api/v4/players/{playerId}"].get.responses["200"].headers["X-Request-Id"]);
  assert.ok(spec.paths["/api/v4/players/{playerId}"].get.responses["200"].headers["X-API-Version"]);
  assert.ok(spec.paths["/api/v4/redemptions"].post.responses["200"].headers["Idempotency-Replayed"]);

  const guide = await readFile(new URL("../public/developer-v4.md", import.meta.url), "utf8");
  const crawlerDocs = await readFile(new URL("../public/developer.md", import.meta.url), "utf8");
  const interactive = await readFile(new URL("../src/DeveloperApp.tsx", import.meta.url), "utf8");
  assert.match(guide, /retryHint/);
  assert.match(guide, /same key and body/i);
  assert.match(guide, /Node\.js client pattern/);
  assert.match(crawlerDocs, /retryHint/);
  assert.match(interactive, /Example V4 redemption response/);
  assert.match(interactive, /retryHint/);
});
