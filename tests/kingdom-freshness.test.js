import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateMightPulseSnapshot,
  getKingdomRetryAfterAtMs,
  getResetCycle,
  needsKingdomResetCheck
} from "../internal/kingshot/kingdom-freshness.js";

const player = { kid: "1125", fid: "123456789" };
const validSnapshot = (overrides = {}) => ({
  fresh: true,
  cached_at: "2026-10-19T00:00:00.000Z",
  age_seconds: 60,
  player,
  ...overrides
});

test("reset cycle uses the inclusive 05:30 Asia/Kolkata boundary", () => {
  const before = getResetCycle(Date.parse("2026-10-18T23:59:59.999Z"));
  const at = getResetCycle(Date.parse("2026-10-19T00:00:00.000Z"));
  const after = getResetCycle(Date.parse("2026-10-19T00:00:00.001Z"));

  assert.equal(before.afterReset, false);
  assert.equal(at.afterReset, true);
  assert.equal(after.afterReset, true);
  assert.equal(at.resetBoundaryMs, Date.parse("2026-10-19T00:00:00.000Z"));
  assert.equal(at.dateKey, "2026-10-19");
});

test("reset-check eligibility waits until after reset when last check was previous cycle", () => {
  assert.equal(needsKingdomResetCheck("2026-10-18T23:00:00.000Z", Date.parse("2026-10-19T00:29:59.000Z")), false);
  assert.equal(needsKingdomResetCheck("2026-10-18T23:00:00.000Z", Date.parse("2026-10-19T00:30:00.000Z")), true);
  assert.equal(needsKingdomResetCheck("not-a-date", Date.parse("2026-10-19T00:30:00.000Z")), true);
});

test("fresh snapshot is accepted only with consistent metadata after today's reset", () => {
  const result = evaluateMightPulseSnapshot(validSnapshot(), Date.parse("2026-10-19T00:01:00.000Z"));
  assert.equal(result.valid, true);
  assert.equal(result.player, player);
  assert.equal(result.cachedAtMs, Date.parse("2026-10-19T00:00:00.000Z"));
  assert.equal(result.ageSeconds, 60);
});

test("snapshot must explicitly report fresh true", () => {
  for (const fresh of [false, null, undefined, 1, "true"]) {
    assert.equal(evaluateMightPulseSnapshot(validSnapshot({ fresh }), Date.parse("2026-10-19T00:01:00.000Z")).valid, false);
  }
});

test("snapshot rejects missing, malformed, future, or pre-reset cached_at values", () => {
  const now = Date.parse("2026-10-19T00:01:00.000Z");
  for (const cached_at of [undefined, null, "", "not-a-date", "2026-10-19T01:00:00.000Z", "2026-10-18T23:59:59.000Z"]) {
    assert.equal(evaluateMightPulseSnapshot(validSnapshot({ cached_at }), now).valid, false, String(cached_at));
  }
});

test("snapshot rejects missing, negative, non-finite, inconsistent, and overly aged age_seconds", () => {
  const now = Date.parse("2026-10-19T00:01:00.000Z");
  for (const age_seconds of [undefined, null, -1, Infinity, NaN, "60", 400, 3691]) {
    assert.equal(evaluateMightPulseSnapshot(validSnapshot({ age_seconds }), now).valid, false, String(age_seconds));
  }
  assert.equal(evaluateMightPulseSnapshot(validSnapshot({ age_seconds: 360 }), now).valid, true);
});

test("snapshot must contain a player object with a kingdom identifier", () => {
  const now = Date.parse("2026-10-19T00:01:00.000Z");
  for (const snapshotPlayer of [undefined, null, "bad", {}, { kid: "" }]) {
    assert.equal(evaluateMightPulseSnapshot(validSnapshot({ player: snapshotPlayer }), now).valid, false);
  }
});

test("cache just before the provider refresh threshold retries after cached_at plus 60 minutes and 95 seconds", () => {
  const now = Date.parse("2026-10-19T00:59:59.000Z");
  const cachedAt = Date.parse("2026-10-19T00:00:00.000Z");
  const retryAt = getKingdomRetryAfterAtMs({
    reason: "STALE_CACHE",
    snapshot: { cached_at: new Date(cachedAt).toISOString(), age_seconds: 3599 },
    nowMs: now
  });
  assert.equal(retryAt, cachedAt + 3_695_000);
});

test("cache at or past the provider refresh threshold retries after five minutes", () => {
  const now = Date.parse("2026-10-19T01:00:00.000Z");
  assert.equal(getKingdomRetryAfterAtMs({
    reason: "STALE_CACHE",
    snapshot: { cached_at: "2026-10-19T00:00:00.000Z", age_seconds: 3600 },
    nowMs: now
  }), now + 300_000);
});

test("missing metadata retries after ten minutes and one 404 after six hours", () => {
  const now = Date.parse("2026-10-19T01:00:00.000Z");
  assert.equal(getKingdomRetryAfterAtMs({ reason: "MISSING_METADATA", nowMs: now }), now + 600_000);
  assert.equal(getKingdomRetryAfterAtMs({ reason: "NOT_FOUND", status: 404, nowMs: now }), now + 21_600_000);
});

test("429 honors bounded Retry-After and timeout or server errors retry after five minutes", () => {
  const now = Date.parse("2026-10-19T01:00:00.000Z");
  assert.equal(getKingdomRetryAfterAtMs({ reason: "RATE_LIMITED", status: 429, retryAfterMs: 45_000, nowMs: now }), now + 45_000);
  assert.equal(getKingdomRetryAfterAtMs({ reason: "RATE_LIMITED", status: 429, retryAfterMs: 999 * 60 * 60 * 1000, nowMs: now }), now + 86_400_000);
  assert.equal(getKingdomRetryAfterAtMs({ reason: "TIMEOUT", nowMs: now }), now + 300_000);
  assert.equal(getKingdomRetryAfterAtMs({ reason: "UPSTREAM_5XX", status: 503, nowMs: now }), now + 300_000);
  assert.equal(getKingdomRetryAfterAtMs({ reason: "UNKNOWN", nowMs: now }), now + 600_000);
});
