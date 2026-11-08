import { classifyScraperError } from "./scraper.js";
import { workerBucket, selectWorkerShardBatch } from "./worker-shard-batch.js";
export { workerBucket, selectWorkerShardBatch };

export interface WorkerResult {
  attempted?: number; success?: number; alreadyHandled?: number; alreadyReceived?: number; skipped?: number;
  stale?: number; deadlineSkipped?: number; error?: string; errorCategory?: string;
  redemptionStatus?: string; redemptionErrorCategory?: string; redemptionErrCode?: string | number | null;
  redemptionMessage?: string | null; redemptionCode?: string; redemptionTelemetry?: any; handledCodeCounts?: Record<string, number>;
}

interface Rpc { (name: string, body: Record<string, unknown>): Promise<any>; }
interface Player { player_id?: string | number; [key: string]: unknown; }
interface NotifyResult {}

export interface WorkerDependencies {
  rpc: Rpc;
  redeemForPlayer: (player: Player, codes: any[]) => Promise<WorkerResult>;
  claimSlot?: (slot: number) => Promise<any>;
  finishSlot?: (payload: Record<string, unknown>) => Promise<any>;
}

export async function runWithConcurrency<T>(
  items: T[],
  fn: (item: T) => Promise<WorkerResult>,
  limit: number,
  options: { deadline?: number } = {}
): Promise<WorkerResult[]> {
  const results = new Array<WorkerResult>(items.length);
  let next = 0;
  let deadlineSkipped = 0;
  const deadline = options.deadline ?? Infinity;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      if (Date.now() >= deadline) {
        deadlineSkipped++;
        results[index] = { attempted: 0, success: 0, alreadyHandled: 0, skipped: 1, deadlineSkipped: 1 };
        continue;
      }
      try {
        results[index] = await fn(items[index]);
      } catch (error) {
        results[index] = {
          error: error instanceof Error ? error.message : "Player processing failed",
          errorCategory: classifyScraperError(error)
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (deadlineSkipped) console.warn("Kingshot worker shard deadline reached; deferred players:", deadlineSkipped);
  return results;
}

export function summarizeWorkerResults(results: WorkerResult[]) {
  const redemptionDiagnostics: Record<string, any> = {};
  const statusCounts: Record<string, number> = {};
  const workerErrorDiagnostics: Record<string, any> = {};
  const codeTelemetry: Record<string, any> = {};
  const codeCounts: Record<string, number> = {};
  const codeBreakdown: Record<string, { attempts: number; successes: number; alreadyReceived: number; alreadyHandled: number; failures: number; statuses: Record<string, number> }> = {};

  for (const result of results) {
    if (result?.redemptionStatus) {
      const status = String(result.redemptionStatus).toUpperCase();
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      if (!["SUCCESS", "RECEIVED", "SAME TYPE EXCHANGE"].includes(status)) {
        const category = String(result.redemptionErrorCategory || "UNKNOWN");
        const errCode = result.redemptionErrCode == null ? "none" : String(result.redemptionErrCode);
        const key = category + " / " + errCode + " / " + status;
        const existing = redemptionDiagnostics[key] || { count: 0, category, errCode, status, message: result.redemptionMessage || null };
        existing.count++;
        if (!existing.message && result.redemptionMessage) existing.message = result.redemptionMessage;
        redemptionDiagnostics[key] = existing;
      }
    }

    if (result?.error) {
      const category = String(result.errorCategory || classifyScraperError(result.error));
      const message = String(result.error).replace(/\s+/g, " ").trim().slice(0, 240) || "Player processing failed.";
      const key = category + " / " + message;
      const existing = workerErrorDiagnostics[key] || { count: 0, category, message };
      existing.count++;
      workerErrorDiagnostics[key] = existing;
    }

    const telemetry = result?.redemptionTelemetry;
    if (telemetry?.code) {
      const code = String(telemetry.code);
      const existing = codeTelemetry[code] || { attempts: 0, successes: 0, firstResultAt: null, firstSuccessAt: null, firstResultLatencyMs: null, totalRedemptionLatencyMs: 0 };
      existing.attempts++;
      if (telemetry.status === "SUCCESS") {
        existing.successes++;
        if (!existing.firstSuccessAt || telemetry.resultAt < existing.firstSuccessAt) existing.firstSuccessAt = telemetry.resultAt;
      }
      if (!existing.firstResultAt || telemetry.resultAt < existing.firstResultAt) {
        existing.firstResultAt = telemetry.resultAt;
        existing.firstResultLatencyMs = Number.isFinite(telemetry.discoveryToResultMs) ? telemetry.discoveryToResultMs : null;
      }
      existing.totalRedemptionLatencyMs += Number(telemetry.redemptionLatencyMs || 0);
      codeTelemetry[code] = existing;
    }

    for (const [code, count] of Object.entries(result?.handledCodeCounts || {})) {
      codeCounts[code] = (codeCounts[code] || 0) + Number(count || 0);
      const breakdown = codeBreakdown[code] || (codeBreakdown[code] = { attempts: 0, successes: 0, alreadyReceived: 0, alreadyHandled: 0, failures: 0, statuses: {} });
      breakdown.alreadyHandled += Number(count || 0);
    }
    if (result?.redemptionCode) {
      const code = String(result.redemptionCode);
      const status = String(result.redemptionStatus || "UNKNOWN").toUpperCase();
      codeCounts[code] = codeCounts[code] || 0;
      codeCounts[code + "_status_" + status] = (codeCounts[code + "_status_" + status] || 0) + 1;
      const breakdown = codeBreakdown[code] || (codeBreakdown[code] = { attempts: 0, successes: 0, alreadyReceived: 0, alreadyHandled: 0, failures: 0, statuses: {} });
      breakdown.attempts++;
      breakdown.statuses[status] = (breakdown.statuses[status] || 0) + 1;
      if (status === "SUCCESS") breakdown.successes++;
      else if (status === "RECEIVED" || status === "SAME TYPE EXCHANGE") breakdown.alreadyReceived++;
      else breakdown.failures++;
    }
  }

  for (const value of Object.values(codeTelemetry)) {
    value.avgRedemptionLatencyMs = value.attempts ? Math.round(value.totalRedemptionLatencyMs / value.attempts) : null;
    delete value.totalRedemptionLatencyMs;
  }

  return {
    attempted: results.reduce((n, r) => n + (r?.attempted || 0), 0),
    success: results.reduce((n, r) => n + (r?.success || 0), 0),
    alreadyHandled: results.reduce((n, r) => n + (r?.alreadyHandled || 0), 0),
    alreadyReceived: results.reduce((n, r) => n + (r?.alreadyReceived || 0), 0),
    skipped: results.reduce((n, r) => n + (r?.skipped || 0), 0),
    errors: results.reduce((n, r) => n + (r?.error ? 1 : 0), 0),
    stale: results.reduce((n, r) => n + (r?.stale ? 1 : 0), 0),
    redemptionStatuses: statusCounts,
    codeCounts,
    codeBreakdown,
    codeTelemetry,
    redemptionFailures: Object.values(redemptionDiagnostics).sort((x, y) => y.count - x.count).slice(0, 8),
    workerErrors: Object.values(workerErrorDiagnostics).sort((a, b) => b.count - a.count).slice(0, 8)
  };
}

export interface WorkerSummary {
  slot: number;
  players: number;
  attempted: number;
  success: number;
  alreadyHandled: number;
  alreadyReceived: number;
  skipped: number;
  errors: number;
  stale: number;
  redemptionStatuses: Record<string, number>;
  codeCounts: Record<string, number>;
  codeBreakdown: Record<string, { attempts: number; successes: number; alreadyReceived: number; alreadyHandled: number; failures: number; statuses: Record<string, number> }>;
  codeTelemetry: Record<string, any>;
  redemptionFailures: any[];
  workerErrors: any[];
  deadlineSkipped: number;
}

export async function runWorkerShard(
  slot: number,
  codes: any[],
  players: Player[],
  dependencies: WorkerDependencies,
  options: { workerCount: number; concurrency: number; maxRuntimeMs: number }
): Promise<{ claimed: false; skipped: true; reason: string; slot: number } | ({ claimed: true } & WorkerSummary)> {
  const { rpc, redeemForPlayer } = dependencies;
  const claim = dependencies.claimSlot ? await dependencies.claimSlot(slot) : await rpc("claim_kingshot_worker_slot", { p_slot: slot });
  const finishSlot = (payload: Record<string, unknown>) => dependencies.finishSlot ? dependencies.finishSlot(payload) : rpc("finish_kingshot_worker_slot", payload);
  if (!claim?.claimed) return { slot, claimed: false, skipped: true, reason: claim?.reason || "SLOT_ALREADY_RUNNING" };

  const workerToken = claim.token;
  try {
    const assigned = (Array.isArray(players) ? players : []).filter(player => workerBucket(player?.player_id, options.workerCount) === slot);
    const deadline = Date.now() + options.maxRuntimeMs;
    // Shared database reservations pace requests across all serverless shards.
    // Four shards may process up to sixteen player pipelines, while shared reservations pace upstream requests.
    const safeConcurrency = Math.min(4, Math.max(1, Math.floor(options.concurrency || 1)));
    const results = await runWithConcurrency(assigned, player => redeemForPlayer(player, codes), safeConcurrency, { deadline });
    const totals: Omit<WorkerSummary, "slot" | "players" | "deadlineSkipped"> & { deadlineSkipped: number } = {
      ...summarizeWorkerResults(results),
      deadlineSkipped: 0
    };
    totals.deadlineSkipped = results.reduce((n, r) => n + (r?.deadlineSkipped || 0), 0);
    const summary = { slot, players: assigned.length, ...totals };

    await finishSlot({
      p_slot: slot, p_token: workerToken,
      p_status: totals.errors || totals.stale ? "COMPLETED_WITH_WARNINGS" : "COMPLETED",
      p_error: null, p_summary: summary
    }).catch(error => console.error("Worker slot state update failed:", slot, error?.message || error));
    console.log("Kingshot worker shard:", summary);
    return { claimed: true, ...summary };
  } catch (error) {
    await finishSlot({
      p_slot: slot, p_token: workerToken, p_status: "FAILED",
      p_error: error instanceof Error ? error.message : "Worker shard failed.",
      p_summary: { slot, errorCategory: classifyScraperError(error) }
    }).catch(releaseError => console.error("Worker slot failure state update failed:", slot, releaseError?.message || releaseError));
    throw error;
  }
}
