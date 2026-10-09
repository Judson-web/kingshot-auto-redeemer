import { classifyScraperError } from "./scraper.ts";

export interface RedemptionTelemetry {
  code: string;
  resultAt: string;
  status: string;
  redemptionLatencyMs: number;
  discoveryToResultMs: number | null;
}

export interface WorkerResult {
  attempted?: number; success?: number; alreadyHandled?: number; alreadyReceived?: number; skipped?: number;
  stale?: number; deadlineSkipped?: number; error?: string; errorCategory?: string;
  redemptionStatus?: string; redemptionErrorCategory?: string; redemptionErrCode?: string | number | null;
  redemptionMessage?: string | null; redemptionCode?: string; redemptionTelemetry?: RedemptionTelemetry; handledCodeCounts?: Record<string, number>;
}

export interface WorkerSlotClaimResponse {
  claimed: boolean;
  reason?: string;
  slot?: number;
  token?: string;
  started_at?: string;
}

export type WorkerSlotStatus = "COMPLETED" | "COMPLETED_WITH_WARNINGS" | "FAILED";

export interface WorkerSlotFinishPayload {
  p_slot: number;
  p_token: string;
  p_status: WorkerSlotStatus;
  p_error: string | null;
  p_summary: object;
}

interface Rpc {
  (name: "claim_kingshot_worker_slot", body: { p_slot: number }): Promise<WorkerSlotClaimResponse>;
  (name: "finish_kingshot_worker_slot", body: WorkerSlotFinishPayload): Promise<boolean>;
}
interface Player { player_id?: string | number; [key: string]: unknown; }

export interface WorkerGiftCode {
  code: string;
  discoveredAt?: number;
  expiresAt?: number | null;
  createdAt?: number | null;
  source?: string;
  sources?: string[];
  confidence?: number;
  confidenceTier?: string;
  adminAdded?: boolean;
}

export interface WorkerDependencies {
  rpc: Rpc;
  redeemForPlayer: (player: Player, codes: WorkerGiftCode[]) => Promise<WorkerResult>;
}

export async function runWithConcurrency<T, R = WorkerResult>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number,
  options: { deadline?: number } = {}
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let deadlineSkipped = 0;
  const deadline = options.deadline ?? Infinity;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      if (Date.now() >= deadline) {
        deadlineSkipped++;
        results[index] = { attempted: 0, success: 0, alreadyHandled: 0, skipped: 1, deadlineSkipped: 1 } as R;
        continue;
      }
      try {
        results[index] = await fn(items[index]);
      } catch (error) {
        results[index] = {
          error: error instanceof Error ? error.message : "Player processing failed",
          errorCategory: classifyScraperError(error)
        } as R;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (deadlineSkipped) console.warn("Kingshot worker shard deadline reached; deferred players:", deadlineSkipped);
  return results;
}

export function workerBucket(value: unknown, workerCount: number): number {
  const input = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % workerCount;
}

export interface RedemptionFailureDiagnostic {
  count: number;
  category: string;
  errCode: string;
  status: string;
  message: string | null;
}

export interface WorkerErrorDiagnostic {
  count: number;
  category: string;
  message: string;
}

export interface CodeTelemetrySummary {
  attempts: number;
  successes: number;
  firstResultAt: string | null;
  firstSuccessAt: string | null;
  firstResultLatencyMs: number | null;
  avgRedemptionLatencyMs?: number | null;

}

export interface WorkerResultSummary {
  attempted: number;
  success: number;
  alreadyHandled: number;
  alreadyReceived: number;
  skipped: number;
  errors: number;
  stale: number;
  redemptionStatuses: Record<string, number>;
  codeCounts: Record<string, number>;
  codeTelemetry: Record<string, CodeTelemetrySummary>;
  redemptionFailures: RedemptionFailureDiagnostic[];
  workerErrors: WorkerErrorDiagnostic[];
}

interface CodeTelemetryAccumulator extends CodeTelemetrySummary {
  totalRedemptionLatencyMs: number;
}

export function summarizeWorkerResults(results: WorkerResult[]): WorkerResultSummary {
  const redemptionDiagnostics: Record<string, RedemptionFailureDiagnostic> = {};
  const statusCounts: Record<string, number> = {};
  const workerErrorDiagnostics: Record<string, WorkerErrorDiagnostic> = {};
  const codeTelemetry: Record<string, CodeTelemetryAccumulator> = {};
  const codeCounts: Record<string, number> = {};

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

    for (const [code, count] of Object.entries(result?.handledCodeCounts || {})) codeCounts[code] = (codeCounts[code] || 0) + Number(count || 0);
    if (result?.redemptionCode) {
      const code = String(result.redemptionCode);
      const status = String(result.redemptionStatus || "UNKNOWN").toUpperCase();
      codeCounts[code] = codeCounts[code] || 0;
      codeCounts[code + "_status_" + status] = (codeCounts[code + "_status_" + status] || 0) + 1;
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
  codeTelemetry: Record<string, CodeTelemetrySummary>;
  redemptionFailures: RedemptionFailureDiagnostic[];
  workerErrors: WorkerErrorDiagnostic[];
  deadlineSkipped: number;
}

export async function runWorkerShard(
  slot: number,
  codes: WorkerGiftCode[],
  players: Player[],
  dependencies: WorkerDependencies,
  options: { workerCount: number; concurrency: number; maxRuntimeMs: number }
): Promise<{ claimed: false; skipped: true; reason: string; slot: number } | ({ claimed: true } & WorkerSummary)> {
  const { rpc, redeemForPlayer } = dependencies;
  const claim = await rpc("claim_kingshot_worker_slot", { p_slot: slot });
  if (!claim?.claimed) return { slot, claimed: false, skipped: true, reason: claim?.reason || "SLOT_ALREADY_RUNNING" };

  const workerToken = claim.token;
  try {
    const assigned = (Array.isArray(players) ? players : []).filter(player => workerBucket(player?.player_id, options.workerCount) === slot);
    const deadline = Date.now() + options.maxRuntimeMs;
    const results = await runWithConcurrency(assigned, player => redeemForPlayer(player, codes), options.concurrency, { deadline });
    const totals: Omit<WorkerSummary, "slot" | "players" | "deadlineSkipped"> & { deadlineSkipped: number } = {
      ...summarizeWorkerResults(results),
      deadlineSkipped: 0
    };
    totals.deadlineSkipped = results.reduce((n, r) => n + (r?.deadlineSkipped || 0), 0);
    const summary = { slot, players: assigned.length, ...totals };

    await rpc("finish_kingshot_worker_slot", {
      p_slot: slot, p_token: workerToken,
      p_status: totals.errors || totals.stale ? "COMPLETED_WITH_WARNINGS" : "COMPLETED",
      p_error: null, p_summary: summary
    }).catch(error => console.error("Worker slot state update failed:", slot, error?.message || error));
    console.log("Kingshot worker shard:", summary);
    return { claimed: true, ...summary };
  } catch (error) {
    await rpc("finish_kingshot_worker_slot", {
      p_slot: slot, p_token: workerToken, p_status: "FAILED",
      p_error: error instanceof Error ? error.message : "Worker shard failed.",
      p_summary: { slot, errorCategory: classifyScraperError(error) }
    }).catch(releaseError => console.error("Worker slot failure state update failed:", slot, releaseError?.message || releaseError));
    throw error;
  }
}
