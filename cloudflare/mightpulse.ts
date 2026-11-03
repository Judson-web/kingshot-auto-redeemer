export interface MightPulseEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  MIGHTPULSE_API_KEY?: string;
  MIGHTPULSE_API_KEY_2?: string;
  MIGHTPULSE_API_KEY_3?: string;
  MIGHTPULSE_API_KEY_4?: string;
  MIGHTPULSE_API_KEY_5?: string;
  MIGHTPULSE_API_KEY_6?: string;
}

type ProviderError = Error & { status?: number; retryAfterMs?: number };
export type MightPulseRequestOptions = { totalTimeoutMs?: number; maxAttempts?: number };
export function resolveMightPulseRequestBudget(timeoutMs = 7000, options: MightPulseRequestOptions = {}, keyCount = 1) {
  const perAttemptMs = Math.max(250, Math.min(30_000, Number(timeoutMs) || 7000));
  const requestedTotal = Number(options.totalTimeoutMs);
  const totalTimeoutMs = Math.max(perAttemptMs, Math.min(60_000, Number.isFinite(requestedTotal) && requestedTotal > 0 ? requestedTotal : Math.max(12_000, perAttemptMs * Math.min(Math.max(1, keyCount), 3))));
  const requestedAttempts = Number(options.maxAttempts);
  const maxAttempts = Number.isInteger(requestedAttempts) && requestedAttempts > 0 ? Math.min(Math.max(1, keyCount), requestedAttempts) : Math.max(1, keyCount);
  return { perAttemptMs, totalTimeoutMs, maxAttempts };
}
const blockedUntil = new Map<string, number>();
const blockedReason = new Map<string, string>();
let keyCursor = 0;
let circuitRpcUnavailableUntil = 0;
let circuitRpcWarningLogged = false;

function keys(env: MightPulseEnv): Array<{ id: string; value: string }> {
  const configured = [
    ["key6", env.MIGHTPULSE_API_KEY_6], ["key5", env.MIGHTPULSE_API_KEY_5],
    ["key4", env.MIGHTPULSE_API_KEY_4], ["key3", env.MIGHTPULSE_API_KEY_3],
    ["key2", env.MIGHTPULSE_API_KEY_2], ["legacy", env.MIGHTPULSE_API_KEY],
  ] as const;
  const seen = new Set<string>();
  return configured.flatMap(([id, raw]) => {
    const value = String(raw || "").trim();
    if (!value || seen.has(value)) return [];
    seen.add(value);
    return [{ id, value }];
  });
}

async function quotaRpc(env: MightPulseEnv, name: string, body: Record<string, unknown>, timeoutMs = 1800): Promise<any> {
  const base = String(env.SUPABASE_URL || "").replace(/\/$/, "");
  const secret = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!base || !secret) throw new Error("Shared MightPulse quota storage is not configured.");
  const response = await fetch(base + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { apikey: secret, authorization: "Bearer " + secret, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error("Shared MightPulse quota reservation failed (HTTP " + response.status + ").");
  return response.json().catch(() => ({}));
}

const usageState = new Map<string, { nextCheckAt: number; inFlight: Promise<void> | null }>();
const USAGE_REFRESH_MS = 30_000;

async function refreshUsage(env: MightPulseEnv, key: { id: string; value: string }, timeoutMs = 5000): Promise<void> {
  const budget = Math.max(250, Math.min(5000, Number(timeoutMs) || 5000));
  const prior = usageState.get(key.id);
  if (prior && (prior.inFlight || prior.nextCheckAt > Date.now())) {
    if (prior.inFlight) await prior.inFlight;
    return;
  }
  const state = prior || { nextCheckAt: 0, inFlight: null };
  state.inFlight = (async () => {
    try {
      const observedAt = new Date(Date.now() - 10_000).toISOString();
      const response = await fetch("https://api.mightpulse.com/v1/usage", {
        headers: { Authorization: "Bearer " + key.value, Accept: "application/json" },
        signal: AbortSignal.timeout(budget),
      });
      if (!response.ok) throw new Error("usage endpoint returned HTTP " + response.status);
      const data: any = await response.json();
      const minuteRemaining = Number(data?.minute?.remaining);
      const dayRemaining = Number(data?.daily?.remaining);
      const minuteResetAt = Date.parse(String(data?.minute?.resets_at || ""));
      const dayResetAt = Date.parse(String(data?.daily?.resets_at || ""));
      if (!Number.isFinite(minuteRemaining) || minuteRemaining < 0 ||
          !Number.isFinite(dayRemaining) || dayRemaining < 0 ||
          !Number.isFinite(minuteResetAt) || !Number.isFinite(dayResetAt)) {
        throw new Error("usage endpoint returned an invalid allowance snapshot");
      }
      await quotaRpc(env, "record_mightpulse_api_key_usage", {
        p_key_id: key.id,
        p_observed_at: observedAt,
        p_minute_remaining: Math.floor(minuteRemaining),
        p_minute_resets_at: new Date(minuteResetAt).toISOString(),
        p_day_remaining: Math.floor(dayRemaining),
        p_day_resets_at: new Date(dayResetAt).toISOString(),
      }, budget);
    } catch {
      // Atomic SQL reservation remains the enforcement boundary if preflight is unavailable.
    } finally {
      state.nextCheckAt = Date.now() + USAGE_REFRESH_MS;
      state.inFlight = null;
      usageState.set(key.id, state);
    }
  })();
  usageState.set(key.id, state);
  await state.inFlight;
}

async function checkProviderCircuit(env: MightPulseEnv, timeoutMs: number): Promise<any> {
  if (Date.now() < circuitRpcUnavailableUntil) return null;
  try {
    const state = await quotaRpc(env, "check_mightpulse_provider_circuit_breaker", {}, timeoutMs);
    circuitRpcUnavailableUntil = 0;
    circuitRpcWarningLogged = false;
    return state;
  } catch (error) {
    circuitRpcUnavailableUntil = Date.now() + 30_000;
    if (!circuitRpcWarningLogged) circuitRpcWarningLogged = true;
    return null;
  }
}

async function updateProviderCircuit(env: MightPulseEnv, name: string): Promise<void> {
  if (Date.now() < circuitRpcUnavailableUntil) return;
  try {
    await quotaRpc(env, name, {}, 1200);
    circuitRpcUnavailableUntil = 0;
    circuitRpcWarningLogged = false;
  } catch {
    circuitRpcUnavailableUntil = Date.now() + 30_000;
    if (!circuitRpcWarningLogged) circuitRpcWarningLogged = true;
  }
}

/** Worker-native port of the existing shared key reservation and cooldown path.
 * Keys are never persisted; each request is atomically reserved in Supabase.
 */
export async function fetchMightPulseNative(env: MightPulseEnv, url: string, timeoutMs = 7000, options: MightPulseRequestOptions = {}): Promise<Response> {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.hostname !== "api.mightpulse.com" || target.port || target.username || target.password) {
    throw new Error("MightPulse client only permits HTTPS requests to api.mightpulse.com.");
  }
  const configured = keys(env);
  if (!configured.length) throw new Error("MightPulse API key is not configured on the server.");
  const budget = resolveMightPulseRequestBudget(timeoutMs, options, configured.length);
  const deadline = Date.now() + budget.totalTimeoutMs;
  const remaining = () => deadline - Date.now();
  const offset = keyCursor++ % configured.length;
  const ordered = configured.slice(offset).concat(configured.slice(0, offset)).slice(0, budget.maxAttempts);
  const firstUsable = ordered.find(key => (blockedUntil.get(key.id) || 0) <= Date.now());
  let circuitFailureCount = 0;
  const [circuitResult] = await Promise.all([
    checkProviderCircuit(env, Math.max(250, Math.min(1200, remaining()))),
    firstUsable && remaining() > 250 ? refreshUsage(env, firstUsable, Math.max(250, Math.min(5000, remaining()))) : Promise.resolve(),
  ]);
  circuitFailureCount = Number(circuitResult?.failureCount) || 0;
  if (circuitResult?.open === true) {
    const error = new Error("MightPulse requests are temporarily paused after repeated provider-wide blocks.") as ProviderError;
    error.status = 503;
    error.retryAfterMs = Math.max(1000, Number(circuitResult.retryAfterMs) || 60_000);
    throw error;
  }
  const failures: ProviderError[] = [];
  const unavailable: Array<{ reason: string; waitMs: number }> = [];
  const providerBlocked = new Set<string>();

  for (const key of ordered) {
    if (remaining() <= 250) break;
    const localWait = (blockedUntil.get(key.id) || 0) - Date.now();
    if (localWait > 0) {
      const reason = blockedReason.get(key.id) || "COOLDOWN";
      unavailable.push({ reason, waitMs: localWait });
      if (reason === "UPSTREAM_RATE_LIMIT" || reason === "CREDENTIAL_REJECTED") providerBlocked.add(key.id);
      continue;
    }
    blockedUntil.delete(key.id);
    blockedReason.delete(key.id);
    if (key !== firstUsable) await refreshUsage(env, key, Math.max(250, Math.min(2500, remaining())));
    if (remaining() <= 250) break;
    let reservation: any;
    try {
      reservation = await quotaRpc(env, "claim_mightpulse_api_key_request", {
        p_key_id: key.id, p_mark_cooldown_seconds: 0,
      }, Math.max(250, Math.min(1800, remaining())));
    } catch (error) {
      // Fail closed: never call the provider if shared atomic quota reservation is unavailable.
      throw Object.assign(new Error("MightPulse shared quota protection is unavailable; request was not sent."), {
        status: 503, cause: error,
      });
    }
    if (!reservation?.claimed) {
      const reason = String(reservation?.reason || "NO_REQUEST_HEADROOM");
      const waitMs = Math.max(1000, Number(reservation?.retry_after_ms) || 60_000);
      const boundedWait = /DAY_BUDGET_EXHAUSTED/.test(reason) ? Math.min(86_400_000, waitMs) : Math.min(90_000, waitMs);
      blockedUntil.set(key.id, Date.now() + boundedWait);
      blockedReason.set(key.id, reason);
      unavailable.push({ reason, waitMs: boundedWait });
      if (/UPSTREAM_RATE_LIMIT|RATE_LIMIT_COOLDOWN|CREDENTIAL_REJECTED/.test(reason)) providerBlocked.add(key.id);
      continue;
    }
    try {
      const response = await fetch(target, {
        headers: { Accept: "application/json", Authorization: "Bearer " + key.value },
        signal: AbortSignal.timeout(Math.max(250, Math.min(budget.perAttemptMs, remaining()))),
      });
      if (response.status === 429 || response.status === 401 || response.status === 403) {
        const credentialFailure = response.status === 401 || response.status === 403;
        const retryAfter = Number(response.headers.get("retry-after") || 0);
        const cooldownMs = credentialFailure ? 300_000
          : Math.min(90_000, Math.max(15_000, retryAfter > 0 ? retryAfter * 1000 : 60_000));
        blockedUntil.set(key.id, Date.now() + cooldownMs);
        blockedReason.set(key.id, credentialFailure ? "CREDENTIAL_REJECTED" : "UPSTREAM_RATE_LIMIT");
        if (!credentialFailure) {
          await quotaRpc(env, "claim_mightpulse_api_key_request", {
            p_key_id: key.id, p_mark_cooldown_seconds: Math.min(90, Math.ceil(cooldownMs / 1000)),
          }).catch(() => undefined);
        }
        const error = new Error("MightPulse key " + key.id + " was rejected or rate limited (HTTP " + response.status + ").") as ProviderError;
        error.status = response.status;
        error.retryAfterMs = cooldownMs;
        failures.push(error);
        unavailable.push({ reason: credentialFailure ? "CREDENTIAL_REJECTED" : "UPSTREAM_RATE_LIMIT", waitMs: cooldownMs });
        providerBlocked.add(key.id);
        continue;
      }
      if (circuitFailureCount > 0) await updateProviderCircuit(env, "reset_mightpulse_provider_circuit_breaker");
      return response;
    } catch (error) {
      failures.push(error instanceof Error ? error as ProviderError : new Error(String(error)));
    }
  }

  if (remaining() <= 250) {
    const error = new Error("MightPulse lookup exceeded its overall time budget.") as ProviderError;
    error.status = 504;
    error.retryAfterMs = 1000;
    throw error;
  }
  if (providerBlocked.size === ordered.length && ordered.length) {
    await updateProviderCircuit(env, "record_mightpulse_provider_block_sweep");
  }
  const earliest = unavailable.reduce((min, item) => Math.min(min, item.waitMs), Infinity);
  if (failures.length) {
    const allLimited = failures.every(error => error.status === 429);
    const allRejected = failures.every(error => error.status === 401 || error.status === 403);
    const error = new Error(allRejected ? "MightPulse rejected all configured credentials."
      : allLimited ? "All configured MightPulse keys are rate limited or exhausted."
      : failures[failures.length - 1].message) as ProviderError;
    error.status = allRejected ? 503 : allLimited ? 429 : failures[failures.length - 1].status || 503;
    error.retryAfterMs = Number.isFinite(earliest) ? earliest : 60_000;
    throw error;
  }
  const allDaily = unavailable.length > 0 && unavailable.every(item => /DAY_BUDGET_EXHAUSTED/.test(item.reason));
  const error = new Error(allDaily ? "MightPulse daily request budget is exhausted." : "All configured MightPulse keys are cooling down or have no request headroom.") as ProviderError;
  error.status = 429;
  error.retryAfterMs = Number.isFinite(earliest) ? earliest : 60_000;
  throw error;
}

export function mightPulsePlayerErrorStatus(error: unknown): number {
  const status = Number((error as { status?: unknown })?.status);
  return [404, 429, 503, 504].includes(status) ? status : 502;
}
