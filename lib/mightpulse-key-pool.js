/**
 * Shared MightPulse API-key pool.
 *
 * API keys are deduplicated by value and scheduled independently. Each stable
 * key slot has its own atomic Supabase reservation row, upstream usage snapshot,
 * and rate-limit cooldown. Raw keys are never persisted or logged.
 */
const BASE_URL = "https://api.mightpulse.com";
const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
const USAGE_REFRESH_MS = 30_000;
const LOCAL_MINUTE_CAP = 45;
const LOCAL_DAY_CAP = 4_500;
const FALLBACK_COOLDOWN_MS = 60_000;
const usageState = new Map();
const localBlockedUntil = new Map();
const localBlockedReason = new Map();
let circuitRpcUnavailableUntil = 0;
let circuitRpcWarningLogged = false;
let cursor = Math.floor(Math.random() * 1000);

function configuredKeys() {
  const slots = [
    ["key6", process.env.MIGHTPULSE_API_KEY_6],
    ["key5", process.env.MIGHTPULSE_API_KEY_5],
    ["key4", process.env.MIGHTPULSE_API_KEY_4],
    ["key3", process.env.MIGHTPULSE_API_KEY_3],
    ["key2", process.env.MIGHTPULSE_API_KEY_2],
    ["legacy", process.env.MIGHTPULSE_API_KEY],
  ];
  const seen = new Set();
  return slots.flatMap(([id, raw]) => {
    const value = String(raw || "").trim();
    if (!value || seen.has(value)) return [];
    seen.add(value);
    return [{ id, value }];
  });
}

async function rpc(name, body, timeoutMs = 5000) {
  if (!SUPABASE_KEY) throw new Error("MightPulse shared quota store is not configured.");
  const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      authorization: "Bearer " + SUPABASE_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error("MightPulse shared quota RPC failed with HTTP " + response.status + ".");
  }
  return response.json().catch(() => ({}));
}

function noteCircuitBreakerRpcFailure(error) {
  circuitRpcUnavailableUntil = Date.now() + 30_000;
  if (!circuitRpcWarningLogged) {
    console.warn(
      "MightPulse shared circuit breaker RPC unavailable; preserving existing per-key safeguards:",
      String(error?.message || error).slice(0, 140)
    );
    circuitRpcWarningLogged = true;
  }
}

async function checkProviderCircuitBreaker() {
  if (!SUPABASE_KEY || Date.now() < circuitRpcUnavailableUntil) return null;
  try {
    const state = await rpc("check_mightpulse_provider_circuit_breaker", {}, 1200);
    circuitRpcUnavailableUntil = 0;
    circuitRpcWarningLogged = false;
    return state;
  } catch (error) {
    // Safe during rolling deployment: the migration may not be applied yet.
    // Existing per-key quotas and cooldowns remain active while this is unavailable.
    noteCircuitBreakerRpcFailure(error);
    return null;
  }
}

async function recordProviderBlockSweep() {
  if (!SUPABASE_KEY || Date.now() < circuitRpcUnavailableUntil) return;
  try {
    await rpc("record_mightpulse_provider_block_sweep", {}, 1200);
    circuitRpcUnavailableUntil = 0;
    circuitRpcWarningLogged = false;
  } catch (error) {
    noteCircuitBreakerRpcFailure(error);
  }
}

async function resetProviderCircuitBreaker() {
  if (!SUPABASE_KEY || Date.now() < circuitRpcUnavailableUntil) return;
  try {
    await rpc("reset_mightpulse_provider_circuit_breaker", {}, 1200);
    circuitRpcUnavailableUntil = 0;
    circuitRpcWarningLogged = false;
  } catch (error) {
    noteCircuitBreakerRpcFailure(error);
  }
}

async function refreshUsage(key) {
  const existing = usageState.get(key.id);
  if (existing && (existing.inFlight || existing.nextCheckAt > Date.now())) {
    if (existing.inFlight) await existing.inFlight;
    return;
  }
  const state = existing || { nextCheckAt: 0, inFlight: null };
  state.inFlight = (async () => {
    try {
      // Snapshot time is intentionally a little earlier to cover in-flight calls.
      const observedAt = new Date(Date.now() - 10_000).toISOString();
      const response = await fetch(BASE_URL + "/v1/usage", {
        headers: { Authorization: "Bearer " + key.value, Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("usage endpoint returned HTTP " + response.status);
      const data = await response.json();
      const minuteRemaining = Number(data?.minute?.remaining);
      const dayRemaining = Number(data?.daily?.remaining);
      const minuteResetAt = Date.parse(String(data?.minute?.resets_at || ""));
      const dayResetAt = Date.parse(String(data?.daily?.resets_at || ""));
      if (!Number.isFinite(minuteRemaining) || minuteRemaining < 0 ||
          !Number.isFinite(dayRemaining) || dayRemaining < 0 ||
          !Number.isFinite(minuteResetAt) || !Number.isFinite(dayResetAt)) {
        throw new Error("usage endpoint returned an invalid allowance snapshot");
      }
      await rpc("record_mightpulse_api_key_usage", {
        p_key_id: key.id,
        p_observed_at: observedAt,
        p_minute_remaining: Math.floor(minuteRemaining),
        p_minute_resets_at: new Date(minuteResetAt).toISOString(),
        p_day_remaining: Math.floor(dayRemaining),
        p_day_resets_at: new Date(dayResetAt).toISOString(),
      });
    } catch (error) {
      // The shared SQL reservation still enforces conservative per-key caps.
      console.warn("MightPulse key usage preflight unavailable for " + key.id + "; using shared per-key cap:", String(error?.message || error).slice(0, 140));
    } finally {
      state.nextCheckAt = Date.now() + USAGE_REFRESH_MS;
      state.inFlight = null;
      usageState.set(key.id, state);
    }
  })();
  usageState.set(key.id, state);
  await state.inFlight;
}

function setLocalCooldown(keyId, ms, reason = "COOLDOWN") {
  localBlockedUntil.set(keyId, Math.max(localBlockedUntil.get(keyId) || 0, Date.now() + ms));
  localBlockedReason.set(keyId, reason);
}

function cooldownMsFromResponse(response) {
  const retryAfter = Number(response.headers.get("retry-after") || "0");
  if (!Number.isFinite(retryAfter) || retryAfter <= 0) return FALLBACK_COOLDOWN_MS;
  return Math.min(90_000, Math.max(15_000, retryAfter * 1000));
}

async function markSharedCooldown(key, cooldownMs) {
  setLocalCooldown(key.id, cooldownMs, "UPSTREAM_RATE_LIMIT");
  await rpc("claim_mightpulse_api_key_request", {
    p_key_id: key.id,
    p_mark_cooldown_seconds: Math.min(90, Math.max(15, Math.ceil(cooldownMs / 1000))),
  }).catch(error => {
    console.error("MightPulse per-key shared cooldown update failed:", String(error?.message || error).slice(0, 140));
  });
}

function orderKeys(keys) {
  if (keys.length < 2) return keys;
  const start = cursor++ % keys.length;
  return keys.slice(start).concat(keys.slice(0, start));
}

/**
 * Perform one idempotent MightPulse GET using a key with reserved headroom.
 * On a key-specific 429/credential error, safely try another configured key.
 * Never use this helper for non-idempotent provider writes.
 */
export async function fetchMightPulse(url, init = {}, options = {}) {
  const keys = configuredKeys();
  if (!keys.length) throw new Error("MightPulse API key is not configured on the server.");
  const requestUrl = new URL(url);
  if (requestUrl.protocol !== "https:" || requestUrl.hostname !== "api.mightpulse.com" || requestUrl.port || requestUrl.username || requestUrl.password) {
    throw new Error("MightPulse client only permits HTTPS requests to api.mightpulse.com.");
  }
  if (String(init.method || "GET").toUpperCase() !== "GET") {
    throw new Error("MightPulse key pool only supports idempotent GET requests.");
  }

  // Warm the first eligible key's usage snapshot while the provider-wide
  // circuit check runs. These independent preflights used to serialize and add
  // an avoidable network round-trip to every cold serverless invocation.
  const candidates = orderKeys(keys);
  const firstUsableKey = candidates.find(key => (localBlockedUntil.get(key.id) || 0) <= Date.now());
  const [circuitState] = options.fastPath
    ? [null]
    : await Promise.all([
        checkProviderCircuitBreaker(),
        firstUsableKey ? refreshUsage(firstUsableKey) : Promise.resolve(),
      ]);
  const priorFailureCount = Number(circuitState?.failureCount) || 0;
  if (circuitState?.open === true) {
    const error = new Error("MightPulse requests are temporarily paused after repeated provider-wide credential or rate-limit blocks.");
    error.status = 503;
    error.code = "MIGHTPULSE_CIRCUIT_OPEN";
    error.retryAfterMs = Math.max(1000, Number(circuitState.retryAfterMs) || FALLBACK_COOLDOWN_MS);
    throw error;
  }

  const timeoutMs = Math.max(250, Math.min(30_000, Number(options.timeoutMs) || 15_000));
  const baseHeaders = new Headers(init.headers || {});
  baseHeaders.set("Accept", baseHeaders.get("Accept") || "application/json");
  const errors = [];
  const unavailable = [];
  const providerBlockedKeys = new Set();

  for (const key of candidates) {
    const now = Date.now();
    const blockedUntil = localBlockedUntil.get(key.id) || 0;
    if (blockedUntil > now) {
      const reason = localBlockedReason.get(key.id) || "COOLDOWN";
      unavailable.push({
        keyId: key.id,
        reason,
        waitMs: blockedUntil - now,
      });
      if (reason === "UPSTREAM_RATE_LIMIT" || reason === "CREDENTIAL_REJECTED") {
        providerBlockedKeys.add(key.id);
      }
      continue;
    }
    localBlockedUntil.delete(key.id);
    localBlockedReason.delete(key.id);

    try {
      if (!options.fastPath && key !== firstUsableKey) await refreshUsage(key);
      const reservation = await rpc("claim_mightpulse_api_key_request", {
        p_key_id: key.id,
        p_mark_cooldown_seconds: 0,
      });
      if (!reservation?.claimed) {
        const reason = String(reservation?.reason || "NO_REQUEST_HEADROOM");
        const requestedWaitMs = Math.max(1_000, Number(reservation?.retry_after_ms) || FALLBACK_COOLDOWN_MS);
        // Quota windows can last much longer than an upstream 429 cooldown.
        // Keep accurate daily-reset timing instead of reducing it to 90 seconds.
        const dailyBudget = /DAY_BUDGET_EXHAUSTED/.test(reason);
        const waitMs = dailyBudget
          ? Math.min(24 * 60 * 60_000, requestedWaitMs)
          : Math.min(90_000, requestedWaitMs);
        setLocalCooldown(key.id, waitMs, reason);
        unavailable.push({ keyId: key.id, reason, waitMs });
        if (/UPSTREAM_RATE_LIMIT|RATE_LIMIT_COOLDOWN|CREDENTIAL_REJECTED/.test(reason)) {
          providerBlockedKeys.add(key.id);
        }
        continue;
      }

      const headers = new Headers(baseHeaders);
      headers.set("Authorization", "Bearer " + key.value);
      const response = await fetch(requestUrl, {
        ...init,
        method: "GET",
        headers,
        signal: init.signal || AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 429) {
        const cooldownMs = cooldownMsFromResponse(response);
        await markSharedCooldown(key, cooldownMs);
        const error = new Error("MightPulse key " + key.id + " is rate limited (HTTP 429).");
        error.status = 429;
        error.retryAfterMs = cooldownMs;
        errors.push(error);
        unavailable.push({ keyId: key.id, reason: "UPSTREAM_RATE_LIMIT", waitMs: cooldownMs });
        providerBlockedKeys.add(key.id);
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        // Credential-specific failures should not prevent another valid key working.
        setLocalCooldown(key.id, 5 * 60_000, "CREDENTIAL_REJECTED");
        const error = new Error("MightPulse key " + key.id + " was rejected with HTTP " + response.status + ".");
        error.status = response.status;
        error.retryAfterMs = 5 * 60_000;
        errors.push(error);
        unavailable.push({ keyId: key.id, reason: "CREDENTIAL_REJECTED", waitMs: 5 * 60_000 });
        providerBlockedKeys.add(key.id);
        continue;
      }
      if (priorFailureCount > 0) await resetProviderCircuitBreaker();
      return response;
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  // Count a provider-wide failure only when every configured key is blocked or
  // rejected, not when one isolated credential has a problem.
  if (candidates.length > 0 && providerBlockedKeys.size === candidates.length) {
    await recordProviderBlockSweep();
  }

  const earliestWait = unavailable
    .map(item => Number(item.waitMs) || 0)
    .filter(wait => wait > 0)
    .reduce((earliest, wait) => Math.min(earliest, wait), Infinity);

  if (errors.length) {
    const last = errors[errors.length - 1];
    const allRateLimited = errors.every(item => Number(item.status || 0) === 429 && /rate limited/i.test(item.message));
    const allCredentialsRejected = errors.every(item => /rejected with HTTP (401|403)/i.test(item.message));
    const error = new Error(allCredentialsRejected
      ? "MightPulse rejected every configured key that could be attempted (HTTP 401/403). Check the configured credentials."
      : allRateLimited
        ? "All configured MightPulse keys are rate limited or have no reserved request headroom."
        : last.message);
    error.status = allRateLimited ? 429 : (allCredentialsRejected ? 503 : (Number(last.status) || 503));
    error.retryAfterMs = Number.isFinite(earliestWait)
      ? earliestWait
      : Math.max(1_000, Number(last.retryAfterMs) || FALLBACK_COOLDOWN_MS);
    throw error;
  }

  if (unavailable.length && unavailable.every(item => item.reason === "INVALID_KEY_SLOT")) {
    const error = new Error("MightPulse key-slot IDs are rejected by the shared quota schema; apply the KSS key-slot consistency migration.");
    error.status = 503;
    error.retryAfterMs = FALLBACK_COOLDOWN_MS;
    throw error;
  }

  const allDailyBudgetsExhausted = unavailable.length > 0 &&
    unavailable.every(item => /DAY_BUDGET_EXHAUSTED/.test(item.reason));
  const error = new Error(allDailyBudgetsExhausted
    ? "MightPulse daily request budget is exhausted for all configured keys."
    : "All configured MightPulse keys are cooling down or have no reserved request headroom.");
  error.status = 429;
  error.retryAfterMs = Number.isFinite(earliestWait) ? earliestWait : FALLBACK_COOLDOWN_MS;
  throw error;
}

export function getMightPulseKeySlotNames() {
  return configuredKeys().map(key => key.id);
}
