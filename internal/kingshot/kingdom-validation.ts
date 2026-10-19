import type { KingshotPlayer } from "./mightpulse.js";
import { fetchMightPulse } from "../../lib/mightpulse-key-pool.js";
import { getKingdomValidationRetryAfterMs, isKingdomValidationDeferred } from "./kingdom-validation-errors.js";

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

async function fetchCurrentPlayer(playerId: string): Promise<FreshPlayer> {
  let lastError: MightPulseFetchError | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (Date.now() < mightPulseCooldownUntil) {
      throw Error("MightPulse shared key-pool cooldown active; validation deferred to the next cycle.");
    }
    try {
      const response = await fetchMightPulse(
        "https://api.mightpulse.com/v1/players/" + encodeURIComponent(playerId) + "?include=base",
        {},
        { timeoutMs: 10_000 }
      );
      const data = await response.json().catch(() => ({})) as {
        player?: KingshotPlayer;
        message?: string;
        error?: string;
        [key: string]: unknown;
      };
      if (response.status === 404) return { notFound: true };
      if (!response.ok) {
        const error = Error(data?.message || data?.error || "MightPulse revalidation failed.") as MightPulseFetchError;
        error.status = response.status;
        const retryAfter = Number(response.headers.get("retry-after") || "0");
        if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = Math.min(90_000, retryAfter * 1000);
        throw error;
      }
      return { player: data.player || data as KingshotPlayer };
    } catch (error) {
      lastError = error as MightPulseFetchError;
      const status = Number(lastError.status || 0);
      const message = String(lastError.message || "");
      const rateLimited = status === 429 || /rate[_ -]?limited|rate limit|too many requests|no request headroom/i.test(message);
      const retryable = RETRYABLE.test(message) || [429, 502, 503, 504].includes(status);
      if (rateLimited) {
        // The key pool records a shared cooldown per limited key. Only enter a
        // worker-level cooldown after every configured key has been tried.
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
  dependencies: { rpc: Rpc; notify: Notify },
  options: { force?: boolean } = {}
): Promise<KingdomValidationResult> {
  const { rpc, notify } = dependencies;
  try {
    const persistFreshPlayer = async (current: KingdomValidationPlayer, manual = false) => {
      const fresh = await fetchCurrentPlayer(current.player_id);
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
    const message = String(error instanceof Error ? error.message : error);
    // Cooldown/headroom means the upstream was intentionally not queried (or
    // refused the request). It is deferred work, not a bad player record.
    if (isKingdomValidationDeferred(error)) {
      console.warn("Kingshot kingdom validation deferred by MightPulse quota/cooldown.");
      return { deferred: true, retryAfterMs: getKingdomValidationRetryAfterMs(error) };
    }
    // Avoid putting player identifiers or provider response bodies in runtime logs.
    console.error("Kingshot player validation failed:", { reason: message.slice(0, 200) });
    return { revalidationError: 1 };
  }
}
