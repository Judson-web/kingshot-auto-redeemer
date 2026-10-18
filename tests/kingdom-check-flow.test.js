import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  normalizeKingdomCheckBatchOptions,
  selectKingdomCheckBatch,
  summarizeKingdomCheckResults
} from "../internal/kingshot/kingdom-check-flow.js";

test("kingdom-check batches sort numeric player IDs and cap batch size", () => {
  const batch = selectKingdomCheckBatch([
    { player_id: "100" },
    { player_id: "9" },
    { player_id: "20" },
    { player_id: "1" }
  ], { batchSize: 2 });

  assert.deepEqual(batch.players.map(player => player.player_id), ["1", "9"]);
  assert.equal(batch.batchSize, 2);
  assert.equal(batch.hasMore, true);
  assert.equal(batch.nextCursor, "9");
  assert.equal(normalizeKingdomCheckBatchOptions({ batchSize: 1000 }).batchSize, 40);
  assert.equal(normalizeKingdomCheckBatchOptions({ batchSize: 0 }).batchSize, 20);
});

test("keyset cursor does not skip players when earlier stale players disappear", () => {
  const firstPage = selectKingdomCheckBatch([
    { player_id: "10" },
    { player_id: "20" },
    { player_id: "30" },
    { player_id: "40" }
  ], { batchSize: 2 });

  const nextPage = selectKingdomCheckBatch([
    { player_id: "30" },
    { player_id: "40" }
  ], { batchSize: 2, after: firstPage.nextCursor });

  assert.deepEqual(firstPage.players.map(player => player.player_id), ["10", "20"]);
  assert.deepEqual(nextPage.players.map(player => player.player_id), ["30", "40"]);
  assert.equal(nextPage.hasMore, false);
});

test("kingdom-check summary distinguishes cooldown deferrals from errors and stale records", () => {
  const summary = summarizeKingdomCheckResults([
    { player: { player_id: "1", kingdom_id: "1125" }, revalidated: true },
    { deferred: true },
    { stale: true },
    { revalidationError: 1 },
    { player: { player_id: "5", kingdom_id: "1143" }, revalidated: true, kingdomChanged: true }
  ]);

  assert.deepEqual(summary, {
    checked: 2,
    changed: 1,
    stale: 1,
    errors: 1,
    deferred: 1,
    validated: 2
  });
});

test("manual kingdom-check endpoint uses bounded keyset batches and counts deferrals", async () => {
  const apiSource = await readFile(new URL("../api/kingshot-auto.js", import.meta.url), "utf8");
  const validationSource = await readFile(new URL("../internal/kingshot/kingdom-validation.ts", import.meta.url), "utf8");
  const workflowSource = await readFile(new URL("../.github/workflows/manual-kingdom-check.yml", import.meta.url), "utf8");

  assert.match(apiSource, /selectKingdomCheckBatch/);
  assert.match(apiSource, /summarizeKingdomCheckResults/);
  assert.match(apiSource, /MANUAL_KINGDOM_VALIDATION_CONCURRENCY=2/);
  assert.match(apiSource, /result\?\.deadlineSkipped\|\|result\?\.deferred/);
  assert.match(apiSource, /kingdomSummary\.deferred/);
  assert.match(validationSource, /return \{ deferred: true \}/);
  assert.match(workflowSource, /BATCH_SIZE=20/);
  assert.match(workflowSource, /Waiting 90 seconds, then retrying this same batch once/);
  assert.match(workflowSource, /Batch cursor did not advance/);
});
