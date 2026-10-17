// Keep the live health summary aligned with the scraper sources invoked by api/kingshot-auto.js.
// Historical source runs remain available through recentScraperRuns and the archive tools.
const CORE_ACTIVE_SOURCES = new Set([
  "kingshot-api",
  "kingshot-page",
  "beebom",
  "pocketgamer",
]);

export function filterActiveScraperHealth(rows, { aggregatorEnabled = false } = {}) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => {
    const source = typeof row?.source === "string" ? row.source : "";
    return CORE_ACTIVE_SOURCES.has(source) || (aggregatorEnabled && source === "whiteout-bot-aggregator");
  });
}
