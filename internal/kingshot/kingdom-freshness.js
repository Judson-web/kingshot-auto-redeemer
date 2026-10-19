const RESET_HOUR = 5;
const RESET_MINUTE = 30;
const METADATA_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_PROVIDER_AGE_SECONDS = 60 * 60 + 90;
const RETRY_AFTER_CAP_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function localPartsAtIst(nowMs) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(nowMs));
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function parseEpoch(value) {
  if (typeof value !== "string" || !value.trim()) return NaN;
  return Date.parse(value);
}

/**
 * Returns the currently active daily reset cycle using Asia/Kolkata wall time.
 * The boundary is returned in UTC epoch milliseconds (05:30 IST == 00:00 UTC).
 */
export function getResetCycle(nowMs = Date.now()) {
  const parts = localPartsAtIst(nowMs);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const afterReset = hour > RESET_HOUR || (hour === RESET_HOUR && minute >= RESET_MINUTE);

  // 05:30 Asia/Kolkata is exactly 00:00 UTC on the same IST calendar date.
  const sameIstDateBoundary = Date.UTC(year, month - 1, day);
  const resetBoundaryMs = afterReset ? sameIstDateBoundary : sameIstDateBoundary - 24 * 60 * MINUTE_MS;

  return {
    dateKey: year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0"),
    afterReset,
    resetBoundaryMs
  };
}

export function needsKingdomResetCheck(lastCheckedAt, nowMs = Date.now()) {
  if (!lastCheckedAt) return true;
  const lastMs = typeof lastCheckedAt === "number" ? lastCheckedAt : Date.parse(String(lastCheckedAt));
  if (!Number.isFinite(lastMs)) return true;

  const current = getResetCycle(nowMs);
  const previous = getResetCycle(lastMs);
  if (!current.afterReset) return false;
  if (!previous.afterReset) return true;

  return current.resetBoundaryMs > previous.resetBoundaryMs;
}

export function evaluateMightPulseSnapshot(snapshot, nowMs = Date.now()) {
  const invalid = reason => ({ valid: false, reason });
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return invalid("MISSING_ENVELOPE");
  if (snapshot.fresh !== true) return invalid("NOT_MARKED_FRESH");

  const cachedAtMs = parseEpoch(snapshot.cached_at);
  if (!Number.isFinite(cachedAtMs)) return invalid("INVALID_CACHED_AT");
  if (cachedAtMs > nowMs + METADATA_CLOCK_TOLERANCE_MS) return invalid("CACHED_AT_IN_FUTURE");

  const cycle = getResetCycle(nowMs);
  if (cachedAtMs < cycle.resetBoundaryMs) return invalid("PRE_RESET_CACHE");

  if (typeof snapshot.age_seconds !== "number" || !Number.isFinite(snapshot.age_seconds) || snapshot.age_seconds < 0) {
    return invalid("INVALID_AGE_SECONDS");
  }
  if (snapshot.age_seconds > MAX_PROVIDER_AGE_SECONDS) return invalid("CACHE_TOO_OLD");

  const localAgeSeconds = (nowMs - cachedAtMs) / 1000;
  if (Math.abs(localAgeSeconds - snapshot.age_seconds) > METADATA_CLOCK_TOLERANCE_MS / 1000) {
    return invalid("AGE_METADATA_MISMATCH");
  }

  const player = snapshot.player;
  if (!player || typeof player !== "object" || Array.isArray(player)) return invalid("MISSING_PLAYER");
  const kingdomId = String(player.kid ?? player.kingdom_id ?? "").replace(/\D/g, "");
  if (!kingdomId) return invalid("MISSING_KINGDOM");

  return { valid: true, player, cachedAtMs, ageSeconds: snapshot.age_seconds };
}

/**
 * @param {{
 *   reason?: string,
 *   snapshot?: { cached_at?: string | null, age_seconds?: number | null } | null,
 *   status?: number,
 *   retryAfterMs?: number,
 *   nowMs?: number
 * }} options
 * @returns {number} Absolute retry timestamp in milliseconds since epoch.
 */
export function getKingdomRetryAfterAtMs({ reason, snapshot, status, retryAfterMs, nowMs = Date.now() } = {}) {
  const numericStatus = Number(status || 0);
  const label = String(reason || "").toUpperCase();

  if (numericStatus === 404 || /NOT_FOUND|404/.test(label)) {
    return nowMs + 6 * 60 * 60 * 1000;
  }

  if (numericStatus === 429 || /RATE_LIMIT|COOLDOWN|QUOTA/.test(label)) {
    const suggested = Number(retryAfterMs);
    const bounded = Number.isFinite(suggested) && suggested > 0
      ? Math.min(RETRY_AFTER_CAP_MS, suggested)
      : 60_000;
    return nowMs + bounded;
  }

  if ([408, 500, 502, 503, 504].includes(numericStatus) || /TIMEOUT|ABORT|UPSTREAM_5XX|TRANSIENT|SERVER_ERROR/.test(label)) {
    return nowMs + 5 * 60 * 1000;
  }

  const cachedAtMs = parseEpoch(snapshot?.cached_at);
  const ageSeconds = snapshot?.age_seconds;
  if (label === "STALE_CACHE" && Number.isFinite(cachedAtMs) && typeof ageSeconds === "number" && Number.isFinite(ageSeconds) && ageSeconds >= 0 && ageSeconds < 3600) {
    return Math.max(cachedAtMs + 3600 * 1000 + 95 * 1000, nowMs + 60 * 1000);
  }

  if (label === "STALE_CACHE" && typeof ageSeconds === "number" && Number.isFinite(ageSeconds) && ageSeconds >= 3600) {
    return nowMs + 5 * 60 * 1000;
  }

  if (/CACHE_TOO_OLD/.test(label)) {
    return nowMs + 5 * 60 * 1000;
  }

  return nowMs + 10 * 60 * 1000;
}
