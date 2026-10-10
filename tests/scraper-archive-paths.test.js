import test from "node:test";
import assert from "node:assert/strict";
import { archivePathDate, shouldSkipArchivePath, utcDay } from "../lib/scraper-archive-paths.js";

test("archivePathDate recognizes daily JSONL archive files", () => {
  assert.equal(archivePathDate("archive/scraper-runs/2026/10/2026-10-01.jsonl"), "2026-10-01");
});

test("archivePathDate recognizes timestamped shards under date directories", () => {
  assert.equal(archivePathDate("archive/scraper-runs/2026/10/2026-10-05/13-51-02__shard.jsonl"), "2026-10-05");
});

test("archivePathDate leaves unknown and non-date paths unclassified", () => {
  assert.equal(archivePathDate("archive/scraper-runs/legacy.jsonl"), null);
  assert.equal(archivePathDate("archive/scraper-runs/2026/10/not-a-date.jsonl"), null);
});

test("utcDay normalizes timestamps to UTC day and rejects invalid dates", () => {
  assert.equal(utcDay("2026-10-05T23:30:00-02:00"), "2026-10-06");
  assert.equal(utcDay("not-a-date"), null);
  assert.equal(utcDay(null), null);
});

test("date pruning skips only files strictly outside the requested days", () => {
  assert.equal(shouldSkipArchivePath("2026-10-04.jsonl", "2026-10-05", null), true);
  assert.equal(shouldSkipArchivePath("2026-10-05.jsonl", "2026-10-05", null), false);
  assert.equal(shouldSkipArchivePath("2026-10-06.jsonl", null, "2026-10-05"), true);
  assert.equal(shouldSkipArchivePath("2026-10-05.jsonl", null, "2026-10-05"), false);
  assert.equal(shouldSkipArchivePath("legacy.jsonl", "2026-10-05", "2026-10-05"), false);
});
