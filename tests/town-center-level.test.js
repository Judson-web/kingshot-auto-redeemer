import test from "node:test";
import assert from "node:assert/strict";
import { formatTownCenterLevel, normalizeTownCenterValue, townCenterTier } from "../lib/town-center-level.js";

test("keeps normal Town Center levels as ordinary levels", () => {
  for (const level of [1, 10, 25, 30]) {
    assert.equal(townCenterTier(level), null);
    assert.equal(formatTownCenterLevel(level), String(level));
    assert.equal(normalizeTownCenterValue(level), String(level));
  }
});

test("labels the four level-30 transition stages correctly", () => {
  for (let level = 31; level <= 34; level += 1) {
    assert.equal(townCenterTier(level), null);
    assert.equal(formatTownCenterLevel(level), "30-" + (level - 30));
    assert.equal(normalizeTownCenterValue(level), String(level));
  }
  assert.equal(normalizeTownCenterValue("30-4"), "30-4");
});

test("maps every Truegold progression value to its correct tier and stage", () => {
  const cases = [
    [35, "TG1"], [36, "TG1-1"], [37, "TG1-2"], [38, "TG1-3"], [39, "TG1-4"],
    [40, "TG2"], [44, "TG2-4"], [45, "TG3"], [49, "TG3-4"],
    [50, "TG4"], [54, "TG4-4"], [55, "TG5"], [59, "TG5-4"],
    [60, "TG6"], [61, "TG6-1"], [64, "TG6-4"],
    [65, "TG7"], [69, "TG7-4"], [70, "TG8"], [74, "TG8-4"]
  ];
  for (const [level, label] of cases) {
    assert.equal(formatTownCenterLevel(level), label, "level " + level);
    assert.equal(townCenterTier(level), Number(/^TG([0-9]+)/.exec(label)[1]), "icon tier for " + level);
    assert.equal(normalizeTownCenterValue(level), String(level));
  }
});

test("accepts explicit TG labels with optional upgrade stages", () => {
  for (const [input, expected] of [["TG 6", "TG6"], ["Truegold 8", "TG8"], ["TG8-4", "TG8-4"]]) {
    assert.equal(formatTownCenterLevel(input), expected);
    assert.equal(normalizeTownCenterValue(input), expected);
  }
  assert.equal(townCenterTier("TG 6"), 6);
  assert.equal(townCenterTier("Truegold 8"), 8);
});

test("does not persist unsupported or unknown levels", () => {
  for (const value of [0, 75, "unknown", "TG9", "TG6-5", null, ""]) {
    assert.equal(normalizeTownCenterValue(value), null);
  }
  assert.equal(townCenterTier(75), null);
  assert.equal(formatTownCenterLevel(75), "75");
  assert.equal(townCenterTier("—"), null);
  assert.equal(formatTownCenterLevel(null), "—");
});
