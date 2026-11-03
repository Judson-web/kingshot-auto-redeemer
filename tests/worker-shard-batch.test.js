import test from "node:test";
import assert from "node:assert/strict";
import { selectWorkerShardBatch, workerBucket } from "../internal/kingshot/worker-shard-batch.js";

test("worker shard batches rotate without starving assigned players", () => {
  const players = Array.from({ length: 120 }, (_, index) => ({ player_id: String(index + 1) }));
  const slot = 0;
  const assigned = players.filter(player => workerBucket(player.player_id, 4) === slot);
  const batchCount = Math.ceil(assigned.length / 2);
  const seen = new Set();

  for (let cycle = 0; cycle < batchCount; cycle++) {
    const batch = selectWorkerShardBatch(players, slot, 4, cycle, 2);
    assert.ok(batch.players.length <= 2);
    for (const player of batch.players) {
      assert.equal(workerBucket(player.player_id, 4), slot);
      assert.equal(seen.has(player.player_id), false);
      seen.add(player.player_id);
    }
  }

  assert.equal(seen.size, assigned.length);
});

test("worker shard batch remains deterministic for a given cycle bucket", () => {
  const players = Array.from({ length: 40 }, (_, index) => ({ player_id: String(index + 1) }));
  const first = selectWorkerShardBatch(players, 2, 4, 12345, 2);
  const second = selectWorkerShardBatch(players, 2, 4, 12345, 2);
  assert.deepEqual(first, second);
  assert.ok(first.players.length <= 2);
  assert.equal(first.deferredPlayers, players.filter(p => workerBucket(p.player_id, 4) === 2).length - first.players.length);
});
