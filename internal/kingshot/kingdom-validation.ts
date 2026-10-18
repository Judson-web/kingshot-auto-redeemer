import type { KingshotPlayer } from "./mightpulse.js";

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
}

interface FreshPlayer {
  notFound?: boolean;
  player?: KingshotPlayer;
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

const RESET_HOUR = 5;
const RESET_MINUTE = 30;
const RETRYABLE = /timeout|timed out|abort|429|rate limit|too many requests|502|503|504/i;
type MightPulseFetchError = Error & { status?: number; retryAfterMs?: number; localBudgetDenied?: boolean };
const RATE_LIMIT_COOLDOWN_FALLBACK_MS = 60_000;
let mightPulseCooldownUntil = 0;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let mightPulseUsageCheckUntil = 0;
let mightPulseUsageCheckInFlight: Promise<void> | null = null;

/**
 * /v1/usage is uncounted by MightPulse. Refresh it occasionally and persist the
 * observed headroom so the shared request RPC accounts for key usage outside
 * this app as well as requests reserved by other Vercel instances.
 */
async function refreshMightPulseUsage(rpc: Rpc, key: string): Promise<void> {
  if (Date.now() < mightPulseUsageCheckUntil) return;
  if (!mightPulseUsageCheckInFlight) {
    mightPulseUsageCheckInFlight = (async () => {
      // Include a small overlap window for requests that were reserved but may
      // not yet have appeared in the upstream usage snapshot.
      const observedAt = new Date(Date.now() - 10_000).toISOString();
      try {
        const response = await fetch("https://api.mightpulse.com/v1/usage", {
          headers: { Authorization: "Bearer " + key },
          signal: AbortSignal.timeout(5000)
        });
        if (!response.ok) throw Error("usage endpoint returned HTTP " + response.status);
        const data = await response.json().catch(() => null) as {
          minute?: { remaining?: number; resets_at?: string };
          daily?: { remaining?: number; resets_at?: string };
        } | null;
        const minuteRemaining = Number(data?.minute?.remaining);
        const dayRemaining = Number(data?.daily?.remaining);
        const minuteResetAt = Date.parse(String(data?.minute?.resets_at || ""));
        const dayResetAt = Date.parse(String(data?.daily?.resets_at || ""));
        if (!Number.isFinite(minuteRemaining) || minuteRemaining < 0 ||
            !Number.isFinite(dayRemaining) || dayRemaining < 0 ||
            !Number.isFinite(minuteResetAt) || !Number.isFinite(dayResetAt)) {
          throw Error("usage endpoint returned an invalid allowance snapshot");
        }
        await rpc("record_mightpulse_api_usage", {
          p_observed_at: observedAt,
          p_minute_remaining: Math.floor(minuteRemaining),
          p_minute_resets_at: new Date(minuteResetAt).toISOString(),
          p_day_remaining: Math.floor(dayRemaining),
          p_day_resets_at: new Date(dayResetAt).toISOString()
        });
      } catch (error) {
        // Fail over to the shared static budget if usage telemetry is unavailable.
        console.warn("MightPulse usage preflight unavailable; using shared request budget:",
          String((error as Error)?.message || error).slice(0, 160));
      } finally {
        mightPulseUsageCheckUntil = Date.now() + 30_000;
      }
    })().finally(() => {
      mightPulseUsageCheckInFlight = null;
    });
  }
  await mightPulseUsageCheckInFlight;
}

function resetBoundary(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  return {
    dateKey: year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0"),
    afterReset: hour > RESET_HOUR || (hour === RESET_HOUR && minute >= RESET_MINUTE)
  };
}

export function needsKingdomResetCheck(lastCheckedAt: unknown, now = Date.now()): boolean {
  if (!lastCheckedAt) return true;
  const last = Date.parse(String(lastCheckedAt));
  if (Number.isNaN(last)) return true;
  const current = resetBoundary(now);
  const previous = resetBoundary(last);
  if (current.dateKey !== previous.dateKey) return current.afterReset;
  return current.afterReset && !previous.afterReset;
}

async function fetchCurrentPlayer(playerId: string, rpc: Rpc): Promise<FreshPlayer> {
  const key = process.env.MIGHTPULSE_API_KEY_3 || process.env.MIGHTPULSE_API_KEY_2 || process.env.MIGHTPULSE_API_KEY || process.env.KSS_API_KEY;
  if (!key) throw Error("MightPulse API key is not configured on the server.");
  let lastError: MightPulseFetchError | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (Date.now() < mightPulseCooldownUntil) {
      throw Error("MightPulse rate-limit cooldown active; validation deferred to the next cycle.");
    }
    try {
      await refreshMightPulseUsage(rpc, key);
      const reservation = await rpc("claim_mightpulse_api_request", { p_mark_cooldown_seconds: 0 }) as {
        claimed?: boolean;
        reason?: string;
        retry_after_ms?: number;
      };
      if (!reservation?.claimed) {
        const error = Error("MightPulse shared request budget deferred this validation (" + String(reservation?.reason || "BUDGET_UNAVAILABLE") + ").") as MightPulseFetchError;
        error.status = 429;
        error.retryAfterMs = Number(reservation?.retry_after_ms) || RATE_LIMIT_COOLDOWN_FALLBACK_MS;
        error.localBudgetDenied = true;
        throw error;
      }
      const response = await fetch("https://api.mightpulse.com/v1/players/" + encodeURIComponent(playerId) + "?include=base", {
        headers: { Authorization: "Bearer " + key },
        signal: AbortSignal.timeout(10000)
      });
      const data = await response.json().catch(() => ({})) as {
        player?: KingshotPlayer;
        message?: string;
        error?: string;
        [key: string]: unknown;
      };
      if (response.status === 404) return { notFound: true };
      if (!response.ok) {
        const error = Error(data?.message || data?.error || "MightPulse revalidation failed.") as Error & { status?: number; retryAfterMs?: number };
        error.status = response.status;
        const retryAfter = Number(response.headers.get("retry-after") || "0");
        if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = Math.min(90000, retryAfter * 1000);
        throw error;
      }
      return { player: data.player || data as KingshotPlayer };
    } catch (error) {
      lastError = error as MightPulseFetchError;
      const status = Number(lastError.status || 0);
      const message = String(lastError.message || "");
      if (lastError.localBudgetDenied) {
        // Cache shared denials in this warm instance so the remaining players
        // don't each incur another Supabase RPC during the same worker cycle.
        const deferMs = Math.min(90_000, Math.max(1_000, Number(lastError.retryAfterMs) || RATE_LIMIT_COOLDOWN_FALLBACK_MS));
        mightPulseCooldownUntil = Math.max(mightPulseCooldownUntil, Date.now() + deferMs);
        throw lastError;
      }
      const rateLimited = status === 429 || /rate[_ -]?limited|rate limit|too many requests/i.test(message);
      const retryable = RETRYABLE.test(message) || [429, 502, 503, 504].includes(status);
      if (rateLimited) {
        // A 429 must not hold the whole worker cycle for 15/30/60 seconds.
        // Remaining due players defer safely to the next cycle without more
        // upstream requests from this invocation.
        const requestedCooldown = Number(lastError.retryAfterMs) || RATE_LIMIT_COOLDOWN_FALLBACK_MS;
        const cooldownMs = Math.min(90_000, Math.max(15_000, requestedCooldown));
        mightPulseCooldownUntil = Math.max(mightPulseCooldownUntil, Date.now() + cooldownMs);
        await rpc("claim_mightpulse_api_request", {
          p_mark_cooldown_seconds: Math.ceil(cooldownMs / 1000)
        }).catch(cooldownError => console.error("MightPulse shared cooldown update failed:", cooldownError?.message || cooldownError));
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
  dependencies: { rpc: Rpc; notify: Notify },
  options: { force?: boolean } = {}
): Promise<KingdomValidationResult> {
  const { rpc, notify } = dependencies;
  try {
    const persistFreshPlayer = async (current: KingdomValidationPlayer, manual = false) => {
      const fresh = await fetchCurrentPlayer(current.player_id, rpc);
      if (fresh.notFound) {
        await rpc("mark_kingshot_player_stale", { p_player_id: current.player_id, p_reason: "MIGHTPULSE_PLAYER_NOT_FOUND" });
        if (!manual) {
          await notify({
            title: "🗑️ Deleted Kingshot account filtered",
            description: "The scheduled kingdom-reset revalidation could not find this registered player. The registration is now stale and excluded from future auto-redeem cycles.",
            fields: [
              { name: "Player ID", value: String(current.player_id), inline: true },
              { name: "Last kingdom", value: String(current.kingdom_id || "Unknown"), inline: true },
              { name: "Check", value: "Reset-cycle player revalidation", inline: true }
            ],
            color: 0xFEE75C
          });
        }
        return { stale: true } as KingdomValidationResult;
      }

      const p = fresh.player || {};
      const currentKingdom = String(p.kid ?? p.kingdom_id ?? "").replace(/\D/g, "");
      if (!currentKingdom) throw Error("MightPulse returned no kingdom for this player.");
      const result = await rpc("record_kingshot_kingdom_revalidation", {
        p_player_id: current.player_id,
        p_kingdom_id: currentKingdom,
        p_player_name: p.nick_name || p.name || p.nickname || null,
        p_avatar_url: p.avatar_url || p.avatar || p.avatarUrl || null
      }) as KingdomRpcResult;

      if (result?.kingdom_changed) {
        console.log("Kingshot " + (manual ? "manual " : "") + "kingdom changed:", {
          playerId: current.player_id,
          from: result.old_kingdom_id,
          to: result.new_kingdom_id
        });
        await notify({
          title: "🔄 Kingdom changed",
          description: manual ? "A manual kingdom check detected a registered player's kingdom change." : "A registered player's current Kingshot kingdom changed.",
          fields: [
            { name: "Player ID", value: String(current.player_id), inline: true },
            { name: "Previous", value: String(result.old_kingdom_id || "Unknown"), inline: true },
            { name: "Current", value: String(result.new_kingdom_id || currentKingdom), inline: true }
          ],
          color: 0x5865F2
        });
      }
      return {
        player: result?.player || current,
        revalidated: true,
        kingdomChanged: Boolean(result?.kingdom_changed)
      };
    };

    if (options.force) return await persistFreshPlayer(player, true);

    if (!player.kingdom_id) {
      const initial = await persistFreshPlayer(player);
      if (initial.stale) return initial;
      player = initial.player || player;
    }

    if (!needsKingdomResetCheck(player.last_kingdom_check_at)) return { player, revalidated: false };

    const claim = await rpc("claim_kingshot_kingdom_reset_check", { p_player_id: player.player_id }) as KingdomRpcResult;
    if (!claim?.claimed) return { player, revalidated: false };

    let claimed = true;
    try {
      const result = await persistFreshPlayer(player);
      claimed = false;
      return result;
    } catch (error) {
      if (claimed) {
        await rpc("release_kingshot_kingdom_reset_check", { p_player_id: player.player_id })
          .catch(releaseError => console.error("Kingdom check claim release failed:", releaseError?.message || releaseError));
      }
      throw error;
    }
  } catch (error) {
    console.error("Kingshot player validation failed:", player?.player_id, error instanceof Error ? error.message : error);
    return { revalidationError: 1 };
  }
}
