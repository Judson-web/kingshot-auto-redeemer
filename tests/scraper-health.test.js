import test from "node:test";
import assert from "node:assert/strict";
import { getActiveScraperSources, safeScraper, SCRAPER_STALE_AFTER_MS } from "../lib/scraper-health.js";
import { fetchSource } from "../internal/kingshot/scraper.ts";

test("only the Kingshot.net API is an active discovery source", () => {
  assert.deepEqual(getActiveScraperSources({}), ["kingshot-api"]);
  assert.deepEqual(getActiveScraperSources({
    KINGSHOT_AGGREGATOR_URL: "https://aggregator.example/codes",
    KINGSHOT_AGGREGATOR_API_KEY: "configured"
  }), ["kingshot-api"]);
});

test("retired discovery endpoints are rejected without making network requests", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("unexpected network request"); };
  try {
    const page = await fetchSource(async () => null, "https://kingshot.net/gift-codes", "page");
    const thirdParty = await fetchSource(async () => null, "https://example.com/codes", "aggregator");
    assert.equal(page.ok, false);
    assert.equal(thirdParty.ok, false);
    assert.match(page.error, /sole source/i);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fresh and successful scraper runs are healthy", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  const result = safeScraper({
    source: "kingshot-api",
    consecutive_empty_runs: 0,
    consecutive_error_runs: 0,
    last_code_count: 4,
    last_success_at: new Date(now - 2 * 60_000).toISOString()
  }, now);
  assert.equal(result.status, "HEALTHY");
  assert.equal(result.healthScore, 100);
  assert.equal(result.lastSuccessFresh, true);
  assert.equal(result.lastSuccessAgeMinutes, 2);
});

test("old last-success timestamps cannot score healthy", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  const result = safeScraper({
    source: "kingshot-guides",
    consecutive_empty_runs: 0,
    consecutive_error_runs: 0,
    last_success_at: new Date(now - 9 * 24 * 60 * 60_000).toISOString()
  }, now);
  assert.equal(result.status, "STALE");
  assert.equal(result.healthScore, 0);
  assert.equal(result.lastSuccessFresh, false);
});

test("a never-successful active source fails health", () => {
  const result = safeScraper({
    source: "pocketgamer",
    consecutive_empty_runs: 10,
    consecutive_error_runs: 3,
    last_success_at: null
  }, Date.now());
  assert.equal(result.status, "FAILING");
  assert.equal(result.healthScore, 0);
  assert.equal(result.lastSuccessAgeMinutes, null);
});

test("sources become stale after the freshness window", () => {
  const now = Date.now();
  const result = safeScraper({
    source: "beebom",
    consecutive_empty_runs: 0,
    consecutive_error_runs: 0,
    last_success_at: new Date(now - SCRAPER_STALE_AFTER_MS - 1000).toISOString()
  }, now);
  assert.equal(result.status, "STALE");
  assert.equal(result.lastSuccessFresh, false);
});
