import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  normalizeKingdomCheckBatchOptions,
  selectKingdomCheckBatch,
  summarizeKingdomCheckResults
} from "../internal/kingshot/kingdom-check-flow.js";

const keyPoolSource = await readFile(new URL("../lib/mightpulse-key-pool.js", import.meta.url), "utf8");
const keySlotMigration = await readFile(new URL("../supabase/migrations/20261018170000_mightpulse_key_slot_consistency.sql", import.meta.url), "utf8");

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
    validated: 2,
    retryAfterMs: 0
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
  assert.match(validationSource, /return \{ deferred: true, retryAfterMs:/);
  assert.match(workflowSource, /BATCH_SIZE=20/);
  assert.match(workflowSource, /RETRY_AFTER_MS/);
  assert.match(workflowSource, /then retrying this same batch once/);
  assert.match(workflowSource, /Batch cursor did not advance/);
});

test("shared key-pool failures distinguish schema mismatches from genuine cooldowns", () => {
  assert.match(keySlotMigration, /'kss1'/);
  assert.match(keySlotMigration, /'kss10'/);
  assert.match(keySlotMigration, /'kss'/);
  assert.match(keyPoolSource, /INVALID_KEY_SLOT/);
  assert.match(keyPoolSource, /key-slot IDs are rejected by the shared quota schema/);
  assert.match(keyPoolSource, /UPSTREAM_RATE_LIMIT/);
  assert.match(keyPoolSource, /MightPulse rejected every configured key that could be attempted/);
  assert.match(keyPoolSource, /const allRateLimited =/);
});

test("manual retry timing follows upstream quota-reset metadata", () => {
  const summary = summarizeKingdomCheckResults([
    { deferred: true, retryAfterMs: 45_000 },
    { deferred: true, retryAfterMs: 12_000 }
  ]);
  assert.equal(summary.deferred, 2);
  assert.equal(summary.retryAfterMs, 45_000);
});


test("MightPulse quota exhaustion and cooldown variants defer kingdom validation", async () => {
  const { isKingdomValidationDeferred, getKingdomValidationRetryAfterMs } =
    await import("../internal/kingshot/kingdom-validation-errors.js");
  const cases = [
    { message: "All configured MightPulse keys are cooling down or have no reserved request headroom.", retryAfterMs: 45000 },
    { message: "All configured MightPulse keys are rate limited or have no reserved request headroom.", status: 429, retryAfterMs: 30000 },
    { message: "MightPulse daily request budget is exhausted for all configured keys.", retryAfterMs: 3600000 },
    { message: "MightPulse shared key-pool cooldown active; validation deferred to the next cycle." },
    { message: "no reserved request headroom" },
    { message: "too many requests", status: 429 }
  ];
  for (const error of cases) {
    assert.equal(isKingdomValidationDeferred(error), true, error.message);
  }
  assert.equal(getKingdomValidationRetryAfterMs(cases[0]), 45000);
  assert.equal(getKingdomValidationRetryAfterMs({ retryAfterMs: -4 }), 0);
  assert.equal(getKingdomValidationRetryAfterMs({ retryAfterMs: "not-a-number" }), 0);
});

test("kingdom validation does not mask credential and schema failures as quota deferrals", async () => {
  const { isKingdomValidationDeferred } =
    await import("../internal/kingshot/kingdom-validation-errors.js");
  assert.equal(isKingdomValidationDeferred(new Error("MightPulse key kss6 was rejected with HTTP 403.")), false);
  assert.equal(isKingdomValidationDeferred(new Error("MightPulse key-slot IDs are rejected by the shared quota schema; apply the KSS key-slot consistency migration.")), false);
  assert.equal(isKingdomValidationDeferred(new Error("MightPulse returned no kingdom for this player.")), false);
});

test("kingdom check response and logging guardrails stay in place", async () => {
  const apiSource = await readFile(new URL("../api/kingshot-auto.js", import.meta.url), "utf8");
  const validationSource = await readFile(new URL("../internal/kingshot/kingdom-validation.ts", import.meta.url), "utf8");
  assert.match(apiSource, /const restrictedPlayersSkipped=assignedPlayers\.length-eligiblePlayers\.length;/);
  assert.match(apiSource, /bannedPlayersSkipped:restrictedPlayersSkipped/);
  assert.doesNotMatch(apiSource, /bannedPlayersSkipped\s*[,}]/);
  assert.match(validationSource, /isKingdomValidationDeferred\(error\)/);
  assert.match(validationSource, /reason: message\.slice\(0, 200\)/);
  assert.doesNotMatch(validationSource, /console\.error\("Kingshot player validation failed:", player\?\.player_id/);
});


test("coordinator keeps stored-kingdom players eligible when revalidation is deferred", async () => {
  const apiSource = await readFile(new URL("../api/kingshot-auto.js", import.meta.url), "utf8");
  assert.match(apiSource, /if\(result\?\.deadlineSkipped\)\{a\.deferred\+\+;return a;\}/);
  assert.match(apiSource, /if\(result\?\.deferred\)\{\s*a\.deferred\+\+;[\s\S]*?if\(result\?\.player\?\.kingdom_id\)validPlayers\.push\(result\.player\);\s*return a;/);
  assert.match(apiSource, /if\(!kingdomState\.player\?\.kingdom_id\)return \{attempted:0,success:0,alreadyHandled:0,skipped:1,revalidationError:1,kingdomCheck,kingdomChanged\}/);
});
