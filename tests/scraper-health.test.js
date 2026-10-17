import test from "node:test";
import assert from "node:assert/strict";
import { filterActiveScraperHealth } from "../lib/scraper-health.js";

const rows = [
  { source: "kingshot-api" },
  { source: "kingshot-page" },
  { source: "beebom" },
  { source: "pocketgamer" },
  { source: "whiteout-bot-aggregator" },
  { source: "gamesradar" },
  { source: "mrguider" },
  { source: null },
];

test("live scraper health includes only the core active pipeline", () => {
  assert.deepEqual(filterActiveScraperHealth(rows).map((row) => row.source), [
    "kingshot-api", "kingshot-page", "beebom", "pocketgamer",
  ]);
});

test("optional aggregator appears only when both endpoint and key are configured", () => {
  assert.deepEqual(filterActiveScraperHealth(rows, { aggregatorEnabled: true }).map((row) => row.source), [
    "kingshot-api", "kingshot-page", "beebom", "pocketgamer", "whiteout-bot-aggregator",
  ]);
});

test("non-array input safely produces an empty live summary", () => {
  assert.deepEqual(filterActiveScraperHealth(null), []);
});
