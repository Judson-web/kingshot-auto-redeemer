import { resolveMightPulseRequestBudget } from "../cloudflare/mightpulse.ts";
import { summarizeCodeBreakdown } from "../internal/kingshot/code-accounting.js";
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

test("hybrid shard execution uses one coordinator eligibility snapshot", () => {
  const shardStart = autoSource.indexOf('if(mode==="worker")');
  const coordinatorStart = autoSource.indexOf('currentStage="worker-ban-snapshot"');
  const shardSource = autoSource.slice(shardStart, autoSource.indexOf('let authorized=', shardStart));
  const coordinatorSource = autoSource.slice(coordinatorStart);
  assert.ok(shardStart >= 0 && coordinatorStart > shardStart);
  assert.match(shardSource, /body\?\.verifiedCodes!==true/);
  assert.match(shardSource, /body\?\.banFilterApplied!==true/);
  assert.doesNotMatch(shardSource, /list_kingshot_admin_gift_codes/);
  assert.doesNotMatch(shardSource, /kingshot_player_bans/);
  assert.match(coordinatorSource, /kingshot_player_bans/);
  assert.match(coordinatorSource, /excludedPlayersFiltered/);
  assert.match(coordinatorSource, /verifiedCodes:true,\s*banFilterApplied:true,\s*batchSelected:true/);
  assert.match(coordinatorSource, /cycleBucket/);
});

test("coordinator sends only the bounded page to each private shard", () => {
  assert.match(autoSource, /const shardBatchesByRound=Array\.from/);
  assert.match(autoSource, /selectWorkerShardBatch\(assigned,workerIndex,WORKER_COUNT,pageIndex,MAX_PLAYERS_PER_SHARD\)/);
  assert.match(autoSource, /players:batchPlayers/);
  assert.match(autoSource, /batchSelected:true/);
  assert.match(autoSource, /allEligiblePlayers\.length>MAX_PLAYERS_PER_SHARD/);
  assert.match(autoSource, /deferredPlayers:shardBatch\.deferredPlayers/);
});

test("main and private shard Workers share the same automatic Kingdom Check switch", () => {
  assert.match(mainWrangler, /"KINGDOM_AUTO_CHECK_ENABLED": "false"/);
  assert.match(shardWrangler, /"KINGDOM_AUTO_CHECK_ENABLED": "false"/);
});

test("hybrid distribution keeps four bounded shards and does not add a polling trigger", () => {
  assert.match(autoSource, /const WORKER_COUNT=4/);
  assert.match(autoSource, /const MAX_PLAYERS_PER_SHARD=5/);
  assert.match(autoSource, /Promise\.all\(assignments\.map/);
  assert.doesNotMatch(autoSource, /setInterval\s*\(/);
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

test("global recovery queue and bounded Neon journal recovery are drained by one designated shard", () => {
  assert.match(autoSource, /if\(slot===0&&body\?\.drainRecoveryQueue!==false\)await\s+drainRedemptionRecoveryQueue\(rpc\)/);
  assert.match(autoSource, /await drainNeonRecoveryJournal\(rpcClient\)\.catch/);
  assert.doesNotMatch(autoSource, /if\s*\(Array\.isArray\(rows\)&&rows\.length\)\s*\{\s*await drainNeonRecoveryJournal/);
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
  assert.match(autoSource, /NO_ELIGIBLE_UNSUPPRESSED_UNEXPIRED_CODES/);
  assert.match(autoSource, /noWorkReason/);
  assert.match(healthSource, /noWorkReason/);
  assert.match(healthSource, /coordinatorRows/);
});



test("Cloudflare redemption shards select up to 100 players with bounded coordinator fan-out", () => {
  assert.ok(autoSource.includes("const MAX_PLAYERS_PER_SHARD=5;"));
  assert.ok(autoSource.includes("const MAX_SHARD_PAGES_PER_CYCLE=5;"));
  assert.ok(autoSource.includes("const PLAYER_CONCURRENCY=4;"));
  assert.ok(autoSource.includes("const WORKER_COUNT=4;"));
  assert.equal(4 * 5 * 5, 100, "maximum bounded player slots per cycle");
  assert.ok(autoSource.includes("const PLAYER_CONCURRENCY=4;"));
  assert.ok(autoSource.includes("shardPageStarts[workerIndex]+roundIndex"));
  assert.ok(autoSource.includes("for(let roundIndex=0;roundIndex<shardBatchesByRound.length;roundIndex++)"));
  const fanoutStart = autoSource.indexOf("  const workerRuns=[];");
  const fanoutEnd = autoSource.indexOf("// Failed pages must be counted as deferred too", fanoutStart);
  assert.ok(fanoutStart >= 0 && fanoutEnd > fanoutStart);
  assert.doesNotMatch(autoSource.slice(fanoutStart, fanoutEnd), /heartbeat_kingshot_worker_run/);
  assert.ok(workerSource.includes("const safeConcurrency = Math.min(4"));
  assert.ok(workerSource.includes("safeConcurrency, { deadline }"));
  assert.ok(autoSource.includes("reserveNeonRedemptionRequest(200)"), "global upstream pacing must remain unchanged");
  assert.ok(autoSource.includes("available_at:new Date(reservationTime).toISOString()"), "Neon reservation timestamp must travel with the queue item");
  assert.ok(!autoSource.includes("const waitMs=Math.max(0,reservationTime-Date.now())"), "the coordinator must not consume the reserved wait before handoff");
  assert.ok(autoSource.includes("Reserve one global slot only after this player's next code is confirmed outstanding"));
  assert.ok(autoSource.includes("setNeonRedemptionCooldown"));
});

test("unresolved journal pairs are filtered before code selection without weakening the journal guard", () => {
  assert.ok(autoSource.includes("select player_id,gift_code from public.redemption_journal where player_id = any($1::text[]) and state in ('in_flight','needs_review','result_recorded')"));
  assert.ok(autoSource.includes("const eligibleCodes=codes.filter(item=>!unresolved.has"));
  assert.ok(autoSource.includes("unresolvedAttempts,recoveryBlocked:unresolvedAttempts>0"));
  assert.ok(autoSource.includes("where public.redemption_journal.state in ('supabase_recorded','cancelled')"));
});

test("deferred player totals count only the final page once", () => {
  assert.ok(autoSource.includes("batch.deferredPlayers=0;"));
  assert.ok(autoSource.includes("batch.deferredPlayers=Math.max(0,assignments[slotIndex].length-selectedBySlot[slotIndex])"));
});

test("multi-page worker cycles rotate complete shard sweeps without wrapping into duplicate pages", () => {
  assert.ok(autoSource.includes("const minuteCycle=Math.floor(cycleStartedAt/60000)"));
  assert.ok(autoSource.includes("const sweepCycles=Math.max(1,Math.ceil(count/MAX_SHARD_PAGES_PER_CYCLE))"));
  assert.ok(autoSource.includes("(minuteCycle%sweepCycles)*MAX_SHARD_PAGES_PER_CYCLE"));
  assert.ok(autoSource.includes("const finalPageBySlot=shardPageRounds.map(count=>count-1)"));
  assert.ok(autoSource.includes("drainRecoveryQueue:roundIndex===0"));
  assert.ok(autoSource.includes("const selectedBySlot=assignments.map"));
});

test("gift-code discovery uses one Kingshot.net API feed with a short cache", () => {
  assert.match(scraperSource, /SOURCE_CACHE_TTL_MS = 10_000/);
  assert.ok(scraperSource.includes('url !== "https://kingshot.net/api/gift-codes"'));
  const sourceFetchBlock = autoSource.slice(autoSource.indexOf('currentStage="gift-code-source-fetch"'), autoSource.indexOf('currentStage="gift-code-merge-and-persist"'));
  assert.ok(sourceFetchBlock.includes('fetchSource(rpc,GIFT_SOURCE_URL,"api")'));
  assert.ok(!sourceFetchBlock.includes("kingshot.net/gift-codes"));
  assert.ok(!sourceFetchBlock.includes("Promise.all"));
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


test("Cloudflare adapter preserves deprecated V1 and V3 API routes", async () => {
  const adapter = await readFile(new URL("../cloudflare/legacy-api-adapter.ts", import.meta.url), "utf8");
  assert.match(adapter, /v3PlayerMatch/);
  assert.ok(adapter.includes('developerPath: "v3-player"'));
  assert.ok(adapter.includes('queryId: v3PlayerMatch[1]'));
  assert.ok(adapter.includes('developerPath: "v3-redemptions"'));
  assert.ok(adapter.includes('developerPath: "player"'));
  assert.ok(adapter.includes('developerPath: "redeem"'));
  assert.match(adapter, /if \(route\.queryId\) query\.id = route\.queryId/);
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


test("Cloudflare Worker preserves the public and authenticated admin-data rewrite on the native runtime", async () => {
  const adapter = await readFile(new URL("../cloudflare/legacy-api-adapter.ts", import.meta.url), "utf8");
  const router = await readFile(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");
  assert.match(adapter, /path === "\/api\/kingshot-admin-data"/);
  assert.match(adapter, /handler: adminToolsHandler, queryPath: \["data"\], rewritePath: "\/api\/admin-tools\/data"/);
  assert.match(router, /dispatchLegacyApi\(request/);
});


test("Cloudflare Worker serves the canonical /api/health route natively", () => {
  assert.match(mainWorkerSource, /incoming\.pathname === "\/api\/health" \|\| incoming\.pathname === "\/api\/ops-tools\/health"/);
  assert.match(mainWorkerSource, /return handlePublicHealth\(request, env\)/);
  assert.match(mainWorkerSource, /async function handlePublicHealth\(request: Request, env: Env\)/);
});

test("each redemption shard reads player history individually and fails closed", () => {
  const start = autoSource.indexOf('if(mode==="worker")');
  const end = autoSource.indexOf('let authorized=', start);
  const shard = autoSource.slice(start, end);
  assert.match(shard, /const shardRpc=rpc/);
  assert.match(shard, /redeemForPlayer\(player,codes,shardRpc/);
  assert.doesNotMatch(shard, /historiesByPlayer|list_kingshot_player_redemptions_bulk/);
  assert.match(autoSource, /const history=await rpcClient\("list_kingshot_player_redemptions"/);
});

test("per-code redemption accounting keeps queued work separate from attempts", () => {
  const breakdown = summarizeCodeBreakdown([
    {queued:1,redemptionCode:"VIP777",redemptionStatus:"QUEUED"},
    {attempted:1,success:1,redemptionCode:"VIP777",redemptionStatus:"SUCCESS"},
    {alreadyHandled:2,handledCodeCounts:{VIP777:2}},
  ]);
  assert.deepEqual(breakdown.VIP777, {
    attempts:1,successes:1,alreadyReceived:0,alreadyHandled:2,queued:1,failures:0,
    statuses:{QUEUED:1,SUCCESS:1},
  });
});


test("public Android gift-code feed reads only verified active codes through the service RPC", async () => {
  const worker = await readFile(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");
  assert.match(worker, /incoming\.pathname === "\/api\/kingshot-gift-codes"/);
  assert.match(worker, /discord_list_verified_gift_codes/);
  assert.match(worker, /validation_status|verified/);
  assert.match(worker, /bucket\.count > 30/);
  assert.match(worker, /max-age=30, s-maxage=60/);
});
