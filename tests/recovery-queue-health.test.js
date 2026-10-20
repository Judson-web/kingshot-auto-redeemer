import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  findStalledRecoveryQueue,
  RECOVERY_QUEUE_LIMITS
} from "../lib/recovery-queue-health.js";

const emptyQueue = {
  pendingRecord: { count: 0, oldestUpdatedAt: null, oldestAgeSeconds: null },
  inFlight: { count: 0, oldestUpdatedAt: null, oldestAgeSeconds: null },
  needsReview: { count: 0, oldestUpdatedAt: null, oldestAgeSeconds: null },
  unresolved: 0
};

test("empty recovery queues do not fail the watchdog", () => {
  assert.deepEqual(findStalledRecoveryQueue(emptyQueue), []);
});

test("pending result records older than 15 minutes are reported", () => {
  const queue = {
    ...emptyQueue,
    pendingRecord: { count: 2, oldestUpdatedAt: "2026-10-20T00:00:00Z", oldestAgeSeconds: RECOVERY_QUEUE_LIMITS.pendingRecordSeconds + 1 }
  };
  assert.match(findStalledRecoveryQueue(queue).join("\n"), /pending_record recovery backlog/);
});

test("in-flight claims older than 10 minutes are reported", () => {
  const queue = {
    ...emptyQueue,
    inFlight: { count: 1, oldestUpdatedAt: "2026-10-20T00:00:00Z", oldestAgeSeconds: RECOVERY_QUEUE_LIMITS.inFlightSeconds + 1 }
  };
  assert.match(findStalledRecoveryQueue(queue).join("\n"), /in_flight recovery backlog/);
});

test("queue entries inside their grace windows do not trigger alerts", () => {
  const queue = {
    ...emptyQueue,
    pendingRecord: { count: 3, oldestUpdatedAt: "2026-10-20T00:00:00Z", oldestAgeSeconds: RECOVERY_QUEUE_LIMITS.pendingRecordSeconds - 1 },
    inFlight: { count: 2, oldestUpdatedAt: "2026-10-20T00:00:00Z", oldestAgeSeconds: RECOVERY_QUEUE_LIMITS.inFlightSeconds - 1 }
  };
  assert.deepEqual(findStalledRecoveryQueue(queue), []);
});

test("needs_review rows are visible but do not trigger automatic replay alerts", () => {
  const queue = {
    ...emptyQueue,
    needsReview: { count: 4, oldestUpdatedAt: "2026-10-01T00:00:00Z", oldestAgeSeconds: 99 * 24 * 60 * 60 }
  };
  assert.deepEqual(findStalledRecoveryQueue(queue), []);
});

test("missing or invalid ages on non-empty queues fail closed", () => {
  const missingAge = { ...emptyQueue, pendingRecord: { count: 1, oldestUpdatedAt: null, oldestAgeSeconds: null } };
  const invalidAge = { ...emptyQueue, inFlight: { count: 1, oldestUpdatedAt: null, oldestAgeSeconds: -1 } };
  assert.match(findStalledRecoveryQueue(missingAge).join("\n"), /age is unavailable/);
  assert.match(findStalledRecoveryQueue(invalidAge).join("\n"), /age is invalid/);
  assert.match(findStalledRecoveryQueue(null).join("\n"), /metrics are missing/);
});

test("diagnostics query only recovery timestamps and do not return player or code identifiers", async () => {
  const health = await readFile(new URL("../lib/health.js", import.meta.url), "utf8");
  const watchdog = await readFile(new URL("../scripts/worker-watchdog.mjs", import.meta.url), "utf8");
  const recoveryQuery = health.slice(
    health.indexOf("async function recoveryQueueState"),
    health.indexOf("async function count(table)")
  );

  assert.match(recoveryQuery, /select:"updated_at"/);
  assert.doesNotMatch(recoveryQuery, /player_id|gift_code|status|message/i);
  assert.match(health, /recoveryQueueState\("pending_record"\)/);
  assert.match(health, /recoveryQueueState\("in_flight"\)/);
  assert.match(health, /recoveryQueueState\("needs_review"\)/);
  assert.match(health, /recoveryQueue/);
  assert.match(watchdog, /findStalledRecoveryQueue/);
  assert.match(watchdog, /searchParams\.set\("logs","1"\)/);
});
