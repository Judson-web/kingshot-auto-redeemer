import test from "node:test";
import assert from "node:assert/strict";
import { runWithConcurrency, workerBucket } from "../internal/kingshot/worker.ts";

test("worker assignment is deterministic and stays within shard bounds", () => {
  for (const id of ["100001", "100002", "player-abc", 12345]) {
    const first = workerBucket(id, 3);
    assert.equal(first, workerBucket(id, 3));
    assert.ok(Number.isInteger(first));
    assert.ok(first >= 0 && first < 3);
  }
});

test("expired shard deadline defers queued players without invoking the handler", async () => {
  let calls = 0;
  const results = await runWithConcurrency(
    [{ player_id: "1" }, { player_id: "2" }, { player_id: "3" }],
    async () => {
      calls++;
      return { attempted: 1 };
    },
    2,
    { deadline: Date.now() - 1 }
  );

  assert.equal(calls, 0);
  assert.equal(results.length, 3);
  assert.equal(results.reduce((sum, result) => sum + (result.deadlineSkipped || 0), 0), 3);
  assert.equal(results.reduce((sum, result) => sum + (result.attempted || 0), 0), 0);
});
