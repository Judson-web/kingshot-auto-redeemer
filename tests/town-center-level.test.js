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

test("maps every progression value to the correct Truegold tier and stage", () => {
  const cases = [
    [35, "TG1"], [36, "TG1-1"], [37, "TG1-2"], [38, "TG1-3"], [39, "TG1-4"],
    [40, "TG2"], [44, "TG2-4"], [45, "TG3"], [49, "TG3-4"],
    [50, "TG4"], [54, "TG4-4"], [55, "TG5"], [59, "TG5-4"],
    [60, "TG6"], [61, "TG6-1"], [64, "TG6-4"],
    [65, "TG7"], [69, "TG7-4"], [70, "TG8"], [74, "TG8-4"]
  ];
  for (const [level, label] of cases) {
    assert.equal(formatTownCenterLevel(level), label, "level " + level);
    assert.equal(townCenterTier(level), Number(/^TG(\\d+)/.exec(label)[1]), "icon tier for " + level);
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
