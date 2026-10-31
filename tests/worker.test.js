import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workerSource = await readFile(new URL("../internal/kingshot/worker.ts", import.meta.url), "utf8");
const healthSource = await readFile(new URL("../lib/health.js", import.meta.url), "utf8");
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
  assert.match(validationSource, /MightPulse shared key-pool cooldown active/);
  assert.match(validationSource, /mightPulseCooldownUntil/);
  assert.match(validationSource, /timeoutMs: 10_000/);
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
  assert.ok(mightPulsePerKeyMigration.includes("grant execute on function public.claim_mightpulse_api_key_request(text, integer) to service_role"));
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

test("transient Supabase failures retry idempotent reads but never replay redemption writes", () => {
  assert.match(autoSource, /const RETRYABLE_READ_RPCS=new Set/);
  assert.match(autoSource, /"list_kingshot_admin_gift_codes"/);
  assert.match(autoSource, /"list_kingshot_autoredeem_players"/);
  assert.ok(autoSource.includes("const maxAttempts=RETRYABLE_READ_RPCS.has(name)?2:1"));
  assert.ok(autoSource.includes("if(attempt<maxAttempts&&(r.status===429||r.status>=500))"));
  assert.match(autoSource, /"claim_kingshot_redemption"/);
});

test("zero-attempt cycles explain when verified codes are already handled or unavailable", () => {
  assert.match(autoSource, /ALL_ELIGIBLE_CODES_ALREADY_HANDLED/);
  assert.match(autoSource, /NO_ELIGIBLE_VERIFIED_UNSUPPRESSED_UNEXPIRED_CODES/);
  assert.match(autoSource, /noWorkReason/);
  assert.match(healthSource, /noWorkReason/);
  assert.match(healthSource, /coordinatorRows/);
});


test("redemption concurrency is capped at one request per shard while upstream throttling is investigated", () => {
  assert.match(workerSource, /safeConcurrency = Math\\.min\\(1/);
  assert.match(workerSource, /runWithConcurrency\\(assigned, player => redeemForPlayer\\(player, codes\\), safeConcurrency/);
});
