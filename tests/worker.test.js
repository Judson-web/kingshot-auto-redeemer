import { resolveMightPulseRequestBudget } from "../cloudflare/mightpulse.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workerSource = await readFile(new URL("../internal/kingshot/worker.ts", import.meta.url), "utf8");
const workerBatchSource = await readFile(new URL("../internal/kingshot/worker-shard-batch.js", import.meta.url), "utf8");
const healthSource = await readFile(new URL("../lib/health.js", import.meta.url), "utf8");
const scraperSource = await readFile(new URL("../internal/kingshot/scraper.ts", import.meta.url), "utf8");
const autoSource = await readFile(new URL("../api/kingshot-auto.js", import.meta.url), "utf8");
const validationSource = await readFile(new URL("../internal/kingshot/kingdom-validation.ts", import.meta.url), "utf8");
const mightPulseKeyPool = await readFile(new URL("../lib/mightpulse-key-pool.js", import.meta.url), "utf8");
const mightPulsePerKeyMigration = await readFile(new URL("../supabase/migrations/20261018150000_mightpulse_per_key_budget.sql", import.meta.url), "utf8");
const workerMigration = await readFile(new URL("../supabase/migrations/20261018121000_add_fourth_kingshot_worker_slot.sql", import.meta.url), "utf8");
const mightPulseBudgetMigration = await readFile(new URL("../supabase/migrations/20261018130000_global_mightpulse_rate_budget.sql", import.meta.url), "utf8");
const mightPulseUsageMigration = await readFile(new URL("../supabase/migrations/20261018140000_mightpulse_usage_headroom.sql", import.meta.url), "utf8");
const mainWorkerSource = await readFile(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");
const shardWorkerSource = await readFile(new URL("../cloudflare/shard-worker.ts", import.meta.url), "utf8");
const legacyAdapterSource = await readFile(new URL("../cloudflare/legacy-api-adapter.ts", import.meta.url), "utf8");
const mainWrangler = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const shardWrangler = await readFile(new URL("../workers/shard/wrangler.jsonc", import.meta.url), "utf8");

test("auto-redemption shards use a private Cloudflare service binding instead of public self-fetch", () => {
  assert.match(autoSource, /req\.workerEnv\?\.SHARD_WORKER/);
  assert.doesNotMatch(autoSource, /workerUrlBase/);
  assert.match(mainWorkerSource, /SHARD_WORKER\?:/);
  assert.match(mainWorkerSource, /env\.SHARD_WORKER\.fetch/);
  assert.match(legacyAdapterSource, /workerEnv: context\.env/);
  assert.match(shardWorkerSource, /mode.*worker/);
  assert.match(shardWorkerSource, /Unauthorized/);
  assert.match(mainWrangler, /"service": "kingshot-autoredeemer-shard"/);
  assert.match(shardWrangler, /"workers_dev": false/);
});

test("worker assignment uses deterministic player bucketing", () => {
  assert.match(workerBatchSource, /function workerBucket/);
  assert.match(workerSource, /workerBucket/);
  assert.match(workerBatchSource, /selectWorkerShardBatch/);
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



test("Cloudflare redemption shards process at most two players sequentially behind shared quota reservations", () => {
  assert.ok(autoSource.includes("const MAX_PLAYERS_PER_SHARD=2;"));
  assert.ok(autoSource.includes("const PLAYER_CONCURRENCY=1;"));
  assert.ok(workerSource.includes("const safeConcurrency = Math.min(2"));
  assert.ok(workerSource.includes("safeConcurrency, { deadline }"));
  assert.ok(autoSource.includes("reserveNeonRedemptionRequest"));
  assert.ok(autoSource.includes("kingshot_set_source_cooldown"));
});

test("Cloudflare MightPulse request budgets bound retries and allow explicit fast-path limits", () => {
  assert.deepEqual(resolveMightPulseRequestBudget(7000, {}, 6), { perAttemptMs: 7000, totalTimeoutMs: 21000, maxAttempts: 6 });
  assert.deepEqual(resolveMightPulseRequestBudget(9000, { totalTimeoutMs: 15000, maxAttempts: 2 }, 6), { perAttemptMs: 9000, totalTimeoutMs: 15000, maxAttempts: 2 });
  assert.deepEqual(resolveMightPulseRequestBudget(9000, { totalTimeoutMs: 1000, maxAttempts: 99 }, 3), { perAttemptMs: 9000, totalTimeoutMs: 9000, maxAttempts: 3 });
});

test("Cloudflare MightPulse adapter caches circuit-breaker RPC outages and preserves bounded fast paths", async () => {
  const adapter = await readFile(new URL("../cloudflare/mightpulse.ts", import.meta.url), "utf8");
  const router = await readFile(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");
  assert.match(adapter, /circuitRpcUnavailableUntil = Date\.now\(\) \+ 30_000/);
  assert.match(adapter, /if \(Date\.now\(\) < circuitRpcUnavailableUntil\) return null/);
  assert.ok(router.includes("fast?{totalTimeoutMs:18_000,maxAttempts:2,fastPath:true}:{}"));
});

test("detailed profile enrichment handles nested provider payloads and legacy alliance aliases", async () => {
  const router = await readFile(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");
  assert.match(router, /player\.alliance_abbr/);
  assert.match(router, /allianceObject\.abbreviation/);
  assert.match(router, /function normalizeNativePlayer/);
  assert.match(router, /alliance: \{ \.\.\.existing/);
  assert.match(router, /nested\?\.player/);
  assert.match(router, /Array\.isArray\(alliance\.members\)/);
  assert.match(router, /detailSource\.heroes/);
  assert.match(router, /allianceRoster=\{name:/);
});


test("Cloudflare Worker routes V4 paths to the native adapter without a legacy host", async () => {
  const router = await readFile(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");
  const adapter = await readFile(new URL("../cloudflare/developer-v4.ts", import.meta.url), "utf8");
  assert.match(router, /import \{ handleNativeV4 \} from "\.\/developer-v4\.js"/);
  assert.match(router, /incoming\.pathname\.startsWith\("\/api\/v4\/"\)/);
  assert.match(adapter, /kingshot_developer_authorize_key/);
  assert.match(adapter, /fetchMightPulseNative/);
  assert.match(adapter, /players:read/);
  assert.match(adapter, /route_not_migrated/);
  assert.match(adapter, /apiVersion: "4"/);
});


test("Cloudflare V4 read-only extended endpoints enforce their documented scopes", async () => {
  const adapter = await readFile(new URL("../cloudflare/developer-v4.ts", import.meta.url), "utf8");
  for (const route of ["alliances", "redemption-history", "usage", "webhooks"]) {
    assert.ok(adapter.includes('"/api/v4/' + route + '"'));
  }
  assert.match(adapter, /alliances:read/);
  assert.match(adapter, /redemptions:read/);
  assert.match(adapter, /usage:read/);
  assert.match(adapter, /webhooks:manage/);
  assert.match(adapter, /kingshot_developer_get_usage/);
  assert.match(adapter, /kingshot_developer_webhooks/);
  assert.match(adapter, /kingshot_redemptions/);
  assert.match(adapter, /fetchMightPulseNative/);
});

test("Cloudflare V4 webhook mutations require write mode while unsupported routes remain fail-closed", async () => {
  const adapter = await readFile(new URL("../cloudflare/developer-v4.ts", import.meta.url), "utf8");
  assert.match(adapter, /route === "redemptions" \? \["POST"\] : route === "webhooks" \? \["GET", "POST"\] : route === "webhook-item" \? \["DELETE"\]/);
  assert.match(adapter, /SUPABASE_WRITE_MODE/);
  assert.match(adapter, /route_not_migrated/);
});


test("Cloudflare Worker exposes the native V4 redemption route", async () => {
  const router = await readFile(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");
  const adapter = await readFile(new URL("../cloudflare/developer-v4.ts", import.meta.url), "utf8");
  const redemption = await readFile(new URL("../cloudflare/redemption.ts", import.meta.url), "utf8");
  assert.match(router, /incoming\.pathname\.startsWith\("\/api\/v4\/"\)/);
  assert.match(adapter, /url\.pathname === "\/api\/v4\/redemptions"/);
  assert.match(adapter, /redemptions:write/);
  assert.match(adapter, /kingshot_developer_v4_begin_redemption/);
  assert.match(adapter, /kingshot_developer_v4_finish_redemption/);
  assert.match(adapter, /kingshot_developer_v4_release_redemption/);
  assert.match(adapter, /handleNativeRedemption\(request, env, \{ v4: true \}\)/);
  assert.match(redemption, /options\.v4\?/);
  assert.match(redemption, /!options\.v4&&limited\(req\)/);
});

test("redemption pacing and provider cooldown are coordinated through Neon, not Supabase RPCs", async () => {
  assert.match(autoSource, /async function reserveNeonRedemptionRequest/);
  assert.match(autoSource, /redemption_source_state/);
  assert.match(autoSource, /async function setNeonRedemptionCooldown/);
  assert.match(autoSource, /reserveNeonRedemptionRequest/);
  assert.match(autoSource, /setNeonRedemptionCooldown/);
  assert.doesNotMatch(autoSource, /rpcClient\("kingshot_reserve_redemption_request"/);
  assert.doesNotMatch(autoSource, /rpcClient\("kingshot_set_source_cooldown"/);
});
