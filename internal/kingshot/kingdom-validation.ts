import type { KingshotPlayer } from "./mightpulse.js";
import { fetchMightPulse } from "../../lib/mightpulse-key-pool.js";
import { isKingdomValidationDeferred, getKingdomValidationRetryAfterMs } from "./kingdom-validation-errors.js";
import { evaluateMightPulseSnapshot, getKingdomRetryAfterAtMs, needsKingdomResetCheck } from "./kingdom-freshness.js";
export { needsKingdomResetCheck } from "./kingdom-freshness.js";

export interface KingdomValidationPlayer {
  player_id: string;
  kingdom_id?: string | number | null;
  last_kingdom_check_at?: string | null;
  [key: string]: unknown;
}

export interface KingdomValidationResult {
  player?: KingdomValidationPlayer;
  revalidated?: boolean;
  kingdomChanged?: boolean;
  stale?: boolean;
  revalidationError?: number;
  deferred?: boolean;
  retryAfterMs?: number;
}

interface FreshPlayer {
  status: number;
  snapshot?: {
    fresh?: unknown;
    cached_at?: unknown;
    age_seconds?: unknown;
    player?: unknown;
  };
  retryAfterMs?: number;
  errorMessage?: string;
}

interface KingdomRpcResult {
  claimed?: boolean;
  player?: KingdomValidationPlayer;
  kingdom_changed?: boolean;
  old_kingdom_id?: string | number | null;
  new_kingdom_id?: string | number | null;
}

interface Rpc {
  (name: string, body: Record<string, unknown>): Promise<any>;
}

interface Notify {
  (event: { title: string; description?: string; fields?: Array<{ name: string; value: string; inline?: boolean }>; color?: number }): Promise<unknown>;
}

type FetchPlayer = (playerId: string) => Promise<FreshPlayer>;

const RETRYABLE = /timeout|timed out|abort|429|rate limit|too many requests|502|503|504|temporarily unavailable/i;
type MightPulseFetchError = Error & { status?: number; retryAfterMs?: number; localBudgetDenied?: boolean };
const RATE_LIMIT_COOLDOWN_FALLBACK_MS = 60_000;
let mightPulseCooldownUntil = 0;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchCurrentPlayer(playerId: string): Promise<FreshPlayer> {
  let lastError: MightPulseFetchError | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (Date.now() < mightPulseCooldownUntil) {
      const error = Error("MightPulse shared key-pool cooldown active; validation deferred to the next cycle.") as MightPulseFetchError;
      error.retryAfterMs = mightPulseCooldownUntil - Date.now();
      throw error;
    }
    try {
      const response = await fetchMightPulse(
        "https://api.mightpulse.com/v1/players/" + encodeURIComponent(playerId) + "?include=base",
        {},
        { timeoutMs: 10_000 }
      );
      const data = await response.json().catch(() => ({})) as {
        player?: KingshotPlayer;
        fresh?: unknown;
        cached_at?: unknown;
        age_seconds?: unknown;
        message?: string;
        error?: string;
        [key: string]: unknown;
      };
      const retryAfterSeconds = Number(response.headers.get("retry-after") || "0");
      const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(24 * 60 * 60 * 1000, retryAfterSeconds * 1000)
        : undefined;
      if (response.status === 404) {
        return {
          status: 404,
          retryAfterMs,
          snapshot: {
            fresh: data.fresh,
            cached_at: data.cached_at,
            age_seconds: data.age_seconds,
            player: data.player
          },
          errorMessage: data?.message || data?.error || "MightPulse player was not found."
        };
      }
      if (!response.ok) {
        const error = Error(data?.message || data?.error || "MightPulse revalidation failed.") as MightPulseFetchError;
        error.status = response.status;
        error.retryAfterMs = retryAfterMs;
        throw error;
      }
      // Keep the provider envelope intact. A bare player payload is not enough
      // evidence for a reset-cycle state mutation.
      return {
        status: response.status,
        snapshot: {
          fresh: data.fresh,
          cached_at: data.cached_at,
          age_seconds: data.age_seconds,
          player: data.player
        }
      };
    } catch (error) {
      lastError = error as MightPulseFetchError;
      const status = Number(lastError.status || 0);
      const message = String(lastError.message || "");
      const rateLimited = status === 429 || /rate[_ -]?limited|rate limit|too many requests|no request headroom|daily request budget is exhausted/i.test(message);
      const retryable = RETRYABLE.test(message) || [429, 502, 503, 504].includes(status);
      if (rateLimited) {
        // Keep the existing shared-key quota behavior. This only protects the
        // current instance after the key pool has exhausted viable keys.
        const cooldownMs = Math.min(90_000, Math.max(15_000, Number(lastError.retryAfterMs) || RATE_LIMIT_COOLDOWN_FALLBACK_MS));
        mightPulseCooldownUntil = Math.max(mightPulseCooldownUntil, Date.now() + cooldownMs);
        throw lastError;
      }
      if (attempt < 1 && retryable) {
        await sleep(600);
        continue;
      }
      throw error;
    }
  }
  throw lastError || Error("MightPulse revalidation failed.");
}

export async function revalidatePlayer(
  player: KingdomValidationPlayer,
  dependencies: { rpc: Rpc; notify: Notify; fetchPlayer?: FetchPlayer; nowMs?: () => number },
  options: { force?: boolean } = {}
): Promise<KingdomValidationResult> {
  const { rpc, notify } = dependencies;
  const nowMs = () => typeof dependencies.nowMs === "function" ? dependencies.nowMs!() : Date.now();
  const manual = Boolean(options.force);
  const fetchPlayer = dependencies.fetchPlayer || fetchCurrentPlayer;
  let claimed = false;

  const deferClaim = async (
    reason: string,
    details: { status?: number; snapshot?: FreshPlayer["snapshot"]; retryAfterMs?: number } = {}
  ): Promise<KingdomValidationResult> => {
    const retryAtMs = getKingdomRetryAfterAtMs({
      reason,
      status: details.status,
      snapshot: details.snapshot,
      retryAfterMs: details.retryAfterMs,
      nowMs: nowMs()
    });
    try {
      await rpc("defer_kingshot_kingdom_reset_check", {
        p_player_id: player.player_id,
        p_retry_after_at: new Date(retryAtMs).toISOString()
      });
      claimed = false;
    } catch (error) {
      // Do not release a claim when persisting the retry window failed; the
      // lease expires naturally instead of allowing another immediate fetch.
      console.error("Kingdom check defer persistence failed:", {
        reason,
        error: String(error instanceof Error ? error.message : error).slice(0, 160)
      });
    }
    return {
      player,
      deferred: true,
      retryAfterMs: Math.max(0, retryAtMs - nowMs()),
      deferredReason: reason
    };
  };

  try {
    if (!manual && player.kingdom_id && !needsKingdomResetCheck(player.last_kingdom_check_at, nowMs())) {
      return { player, revalidated: false };
    }

    const claimName = manual
      ? "claim_kingshot_kingdom_manual_check"
      : "claim_kingshot_kingdom_reset_check";
    const claim = await rpc(claimName, { p_player_id: player.player_id }) as KingdomRpcResult & {
      deferred?: boolean;
      retry_after_at?: string | null;
      reason?: string;
    };
    if (!claim?.claimed) {
      const retryAt = Date.parse(String(claim?.retry_after_at || ""));
      if (claim?.deferred || (Number.isFinite(retryAt) && retryAt > nowMs())) {
        return {
          player,
          deferred: true,
          deferredReason: claim.reason || "RETRY_WINDOW",
          retryAfterMs: Number.isFinite(retryAt) ? Math.max(0, retryAt - nowMs()) : 60_000
        };
      }
      return { player, revalidated: false };
    }
    claimed = true;

    let fetched: FreshPlayer;
    try {
      fetched = await fetchPlayer(player.player_id);
    } catch (error) {
      const fetchError = error as MightPulseFetchError;
      const status = Number(fetchError?.status || 0);
      const message = String(fetchError instanceof Error ? fetchError.message : error);
      const quotaDeferred = isKingdomValidationDeferred(error);
      const retryableStatus = status === 404 || status === 408 || status === 429 || status >= 500;
      const retryableMessage = RETRYABLE.test(message) || /timeout|timed out|abort|temporarily unavailable/i.test(message);
      if (quotaDeferred || retryableStatus || retryableMessage) {
        const reason = status === 404 ? "NOT_FOUND"
          : status === 429 || quotaDeferred ? "RATE_LIMITED"
          : status >= 500 || status === 408 || retryableMessage ? "TIMEOUT"
          : "TRANSIENT";
        return await deferClaim(reason, { status, retryAfterMs: fetchError?.retryAfterMs });
      }
      throw error;
    }

    if (fetched.status === 404) {
      return await deferClaim("NOT_FOUND", {
        status: 404,
        snapshot: fetched.snapshot,
        retryAfterMs: fetched.retryAfterMs
      });
    }
    if (fetched.status === 429 || fetched.status === 408 || fetched.status >= 500) {
      const reason = fetched.status === 429 ? "RATE_LIMITED" : fetched.status === 408 ? "TIMEOUT" : "UPSTREAM_5XX";
      return await deferClaim(reason, {
        status: fetched.status,
        snapshot: fetched.snapshot,
        retryAfterMs: fetched.retryAfterMs
      });
    }
    if (fetched.status < 200 || fetched.status >= 300) {
      throw Object.assign(new Error(fetched.errorMessage || "MightPulse revalidation failed."), { status: fetched.status });
    }

    const validation = evaluateMightPulseSnapshot(fetched.snapshot, nowMs());
    if (!validation.valid) {
      const snapshot = fetched.snapshot;
      const cachedAt = typeof snapshot?.cached_at === "string" ? Date.parse(snapshot.cached_at) : NaN;
      const age = snapshot?.age_seconds;
      const reliableAge = Number.isFinite(cachedAt) && typeof age === "number" && Number.isFinite(age) && age >= 0;
      const reason = validation.reason === "CACHE_TOO_OLD"
        ? "CACHE_TOO_OLD"
        : snapshot?.fresh === false && reliableAge && age < 3600
          ? "STALE_CACHE"
          : validation.reason || "INVALID_SNAPSHOT";
      return await deferClaim(reason, { snapshot });
    }

    const p = validation.player as KingshotPlayer;
    const currentKingdom = String(p.kid ?? p.kingdom_id ?? "").replace(/\D/g, "");
    const result = await rpc("record_kingshot_kingdom_revalidation", {
      p_player_id: player.player_id,
      p_kingdom_id: currentKingdom,
      p_player_name: p.nick_name || p.name || p.nickname || null,
      p_avatar_url: p.avatar_url || p.avatar || p.avatarUrl || null
    }) as KingdomRpcResult & { ok?: boolean; reason?: string };

    if (result?.ok === false || !result?.player) {
      claimed = false;
      await rpc("release_kingshot_kingdom_reset_check", { p_player_id: player.player_id }).catch(() => {});
      return { player, revalidationError: 1 };
    }

    claimed = false; // The successful RPC clears the database claim and retry window.
    if (result?.kingdom_changed) {
      console.log("Kingshot " + (manual ? "manual " : "") + "kingdom changed:", {
        playerId: player.player_id,
        from: result.old_kingdom_id,
        to: result.new_kingdom_id
      });
      await notify({
        title: "🔄 Kingdom changed",
        description: manual ? "A manual kingdom check detected a registered player's kingdom change." : "A registered player's current Kingshot kingdom changed.",
        fields: [
          { name: "Player ID", value: String(player.player_id), inline: true },
          { name: "Previous", value: String(result.old_kingdom_id || "Unknown"), inline: true },
          { name: "Current", value: String(result.new_kingdom_id || currentKingdom), inline: true }
        ],
        color: 0x5865F2
      }).catch(error => console.error("Kingdom change notification failed:", String(error?.message || error).slice(0, 160)));
    }
    return {
      player: result.player,
      revalidated: true,
      kingdomChanged: Boolean(result?.kingdom_changed)
    };
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (claimed) {
      await rpc("release_kingshot_kingdom_reset_check", { p_player_id: player.player_id })
        .catch(releaseError => console.error("Kingdom check claim release failed:", String(releaseError?.message || releaseError).slice(0, 160)));
    }
    // Avoid putting player identifiers or provider response bodies in runtime logs.
    console.error("Kingshot player validation failed:", { reason: message.slice(0, 200) });
    return { player, revalidationError: 1 };
  }
}
