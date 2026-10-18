import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workerSource = await readFile(new URL("../internal/kingshot/worker.ts", import.meta.url), "utf8");
const scraperSource = await readFile(new URL("../internal/kingshot/scraper.ts", import.meta.url), "utf8");
const autoSource = await readFile(new URL("../api/kingshot-auto.js", import.meta.url), "utf8");
const validationSource = await readFile(new URL("../internal/kingshot/kingdom-validation.ts", import.meta.url), "utf8");
const mightPulseKeyPool = await readFile(new URL("../lib/mightpulse-key-pool.js", import.meta.url), "utf8");
const mightPulsePerKeyMigration = await readFile(new URL("../supabase/migrations/20261018150000_mightpulse_per_key_budget.sql", import.meta.url), "utf8");
const workerMigration = await readFile(new URL("../supabase/migrations/20261018121000_add_fourth_kingshot_worker_slot.sql", import.meta.url), "utf8");
const mightPulseBudgetMigration = await readFile(new URL("../supabase/migrations/20261018130000_global_mightpulse_rate_budget.sql", import.meta.url), "utf8");
const mightPulseUsageMigration = await readFile(new URL("../supabase/migrations/20261018140000_mightpulse_usage_headroom.sql", import.meta.url), "utf8");

test("worker assignment uses deterministic player bucketing", () => {
  assert.match(workerSource, /function workerBucket|const workerBucket/);
  assert.match(workerSource, /workerBucket\(/);
});

test("worker checks its runtime deadline before starting queued work", () => {
  assert.match(workerSource, /deadlineSkipped/);
  assert.match(workerSource, /deadline/);
});

test("worker keeps its extension-mapped scraper dependency", () => {
  assert.match(workerSource, /from ["']\.\/scraper\.js["']/);
  assert.ok(scraperSource.length > 0);
});

test("fourth worker shard is consistent across application and durable slot migration", () => {
  assert.match(autoSource, /const WORKER_COUNT=4;/);
  assert.match(autoSource, /Array.from\(\{length:WORKER_COUNT\}/);
  assert.match(workerMigration, /slot >= 0 and slot < 4/i);
  assert.match(workerMigration, /p_slot >= 4/);
  assert.match(workerMigration, /values \(3\)/i);
});

test("kingdom rate limits defer to the next cycle instead of sleeping the worker pool", () => {
  assert.match(validationSource, /MightPulse rate-limit cooldown active/);
  assert.match(validationSource, /mightPulseCooldownUntil/);
  assert.match(validationSource, /AbortSignal\.timeout\(10000\)/);
  assert.doesNotMatch(validationSource, /RATE_LIMIT_BACKOFF_MS/);
});

test("MightPulse key pool uses atomic per-key reservations and bounded per-key cooldowns", () => {
  assert.match(validationSource, /fetchMightPulse/);
  assert.match(mightPulseKeyPool, /claim_mightpulse_api_key_request/);
  assert.match(mightPulseKeyPool, /record_mightpulse_api_key_usage/);
  assert.match(mightPulseKeyPool, /setLocalCooldown/);
  assert.match(mightPulsePerKeyMigration, /for update/i);
  assert.match(mightPulsePerKeyMigration, /interval '60 seconds'/i);
  assert.match(mightPulsePerKeyMigration, /4500/);
  assert.match(mightPulsePerKeyMigration, /security definer/i);
  assert.match(mightPulsePerKeyMigration, /grant execute on function public\\.claim_mightpulse_api_key_request\\(text, integer\\) to service_role/i);
  assert.match(mightPulsePerKeyMigration, /enable row level security/i);
});

test("MightPulse usage preflight tracks each key separately and respects actual usage", () => {
  assert.ok(mightPulseKeyPool.includes("/v1/usage"));
  assert.ok(mightPulseKeyPool.includes("record_mightpulse_api_key_usage"));
  assert.ok(mightPulsePerKeyMigration.includes("usage_minute_resets_at"));
  assert.ok(mightPulsePerKeyMigration.includes("usage_day_resets_at"));
  assert.ok(mightPulsePerKeyMigration.includes("UPSTREAM_DAY_BUDGET_EXHAUSTED"));
  assert.ok(mightPulsePerKeyMigration.toLowerCase().includes("for update"));
  assert.ok(mightPulsePerKeyMigration.includes("record_mightpulse_api_key_usage"));
  assert.ok(mightPulseUsageMigration.includes("record_mightpulse_api_usage"));
});

test("global recovery queue is drained by one designated shard, not all four", () => {
  assert.match(autoSource, /if\s*\(slot\s*===\s*0\)\s*await\s+drainRedemptionRecoveryQueue\(rpc\)/);
});
