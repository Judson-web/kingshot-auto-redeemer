export const SCRAPER_STALE_AFTER_MS = 30 * 60 * 1000;
const SCRAPER_UNHEALTHY_AFTER_MS = 6 * 60 * 60 * 1000;

export function getActiveScraperSources(env = process.env) {
  const sources = ["kingshot-api", "kingshot-page", "beebom", "pocketgamer"];
  if (String(env?.KINGSHOT_AGGREGATOR_URL || "").trim() && String(env?.KINGSHOT_AGGREGATOR_API_KEY || "").trim()) {
    sources.push("whiteout-bot-aggregator");
  }
  return sources;
}

export function safeScraper(row, now = Date.now()) {
  const empty = Math.max(0, Number(row?.consecutive_empty_runs || 0));
  const errors = Math.max(0, Number(row?.consecutive_error_runs || 0));
  const successAt = row?.last_success_at ? Date.parse(String(row.last_success_at)) : Number.NaN;
  const hasSuccess = Number.isFinite(successAt);
  const ageMs = hasSuccess ? Math.max(0, now - successAt) : Number.POSITIVE_INFINITY;
  const stale = !hasSuccess || ageMs > SCRAPER_STALE_AFTER_MS;
  const activityScore = Math.max(0, 100 - Math.min(errors, 5) * 15 - Math.min(empty, 5) * 8);
  const freshnessScore = !hasSuccess
    ? 0
    : ageMs <= SCRAPER_STALE_AFTER_MS
      ? 100
      : ageMs >= SCRAPER_UNHEALTHY_AFTER_MS
        ? 0
        : Math.max(0, Math.round(100 * (1 - (ageMs - SCRAPER_STALE_AFTER_MS) / (SCRAPER_UNHEALTHY_AFTER_MS - SCRAPER_STALE_AFTER_MS))));
  const healthScore = Math.min(activityScore, freshnessScore);
  let status;
  if (errors >= 3 || !hasSuccess) status = "FAILING";
  else if (stale) status = "STALE";
  else if (empty >= 3) status = "DEGRADED";
  else status = healthScore >= 80 ? "HEALTHY" : "WATCH";

  return {
    source: row?.source ?? null,
    codeCount: Number(row?.last_code_count || 0),
    consecutiveEmptyRuns: empty,
    consecutiveErrors: errors,
    lastSuccessAt: hasSuccess ? row.last_success_at : null,
    lastSuccessAgeMinutes: hasSuccess ? Math.floor(ageMs / 60_000) : null,
    lastSuccessFresh: !stale,
    alertState: row?.alert_state ?? null,
    healthScore,
    status,
    lastError: row?.last_error ? String(row.last_error).slice(0, 160) : null
  };
}
