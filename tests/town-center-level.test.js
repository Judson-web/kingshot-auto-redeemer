import test from "node:test";
import assert from "node:assert/strict";
import { formatTownCenterLevel, townCenterTier } from "../lib/town-center-level.js";

test("keeps normal Town Center levels as ordinary levels", () => {
  for (const level of [1, 10, 25, 30]) {
    assert.equal(townCenterTier(level), null);
    assert.equal(formatTownCenterLevel(level), String(level));
  }
});

test("labels the four level-30 transition stages correctly", () => {
  for (let level = 31; level <= 34; level += 1) {
    assert.equal(townCenterTier(level), null);
    assert.equal(formatTownCenterLevel(level), "30-" + (level - 30));
  }
});

test("maps linear progression values to the correct completed TG tier", () => {
  const ranges = [
    [35, 39, 1], [40, 44, 2], [45, 49, 3], [50, 54, 4],
    [55, 59, 5], [60, 64, 6], [65, 69, 7], [70, 74, 8]
  ];
  for (const [start, end, tier] of ranges) {
    for (let level = start; level <= end; level += 1) {
      assert.equal(townCenterTier(level), tier, "level " + level + " should map to TG" + tier);
      assert.equal(formatTownCenterLevel(level), "TG" + tier);
    }
  }
});

test("accepts explicit TG labels and optional stage suffixes", () => {
  assert.equal(townCenterTier("TG 6"), 6);
  assert.equal(formatTownCenterLevel("TG 6"), "TG6");
  assert.equal(townCenterTier("Truegold 8"), 8);
  assert.equal(formatTownCenterLevel("TG8-4"), "TG8-4");
});

test("does not infer unsupported tiers or replace unknown values", () => {
  assert.equal(townCenterTier(75), null);
  assert.equal(formatTownCenterLevel(75), "75");
  assert.equal(townCenterTier("—"), null);
  assert.equal(formatTownCenterLevel(null), "—");
  assert.equal(formatTownCenterLevel("unknown"), "unknown");
});
