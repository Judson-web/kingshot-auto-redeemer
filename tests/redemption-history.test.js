import test from "node:test";
import assert from "node:assert/strict";
import { getHandledGiftCodes, selectNextOutstandingCode } from "../internal/kingshot/redemption-history.ts";

test("normalizes persisted statuses and code keys without changing display casing", () => {
  const handled = getHandledGiftCodes([
    { gift_code: "Hangul2026", status: "success" },
    { gift_code: " WELLDONE ", status: "USER INFO ERROR" },
    { gift_code: "VIP777", status: "stove_lv error" },
    { gift_code: "Kingshot888", status: "TIMEOUT_RETRY" },
    null
  ]);
  assert.deepEqual([...handled].sort(), ["HANGUL2026", "VIP777", "WELLDONE"]);
});

test("moves to the next code after a handled player-specific error", () => {
  const codes = [{ code: "Hangul2026" }, { code: "WELLDONE" }, { code: "VIP777" }];
  const handled = getHandledGiftCodes([
    { gift_code: "Hangul2026", status: "USER INFO ERROR" }
  ]);
  assert.equal(selectNextOutstandingCode(codes, handled)?.code, "WELLDONE");
});

test("returns no candidate when all available codes are handled", () => {
  const codes = [{ code: "Hangul2026" }, { code: "WELLDONE" }];
  const handled = getHandledGiftCodes([
    { gift_code: "Hangul2026", status: "SUCCESS" },
    { gift_code: "WELLDONE", status: "STOVE_LV ERROR" }
  ]);
  assert.equal(selectNextOutstandingCode(codes, handled), undefined);
});

test("keeps transient failures eligible for a later retry", () => {
  const handled = getHandledGiftCodes([
    { gift_code: "Hangul2026", status: "TIMEOUT_RETRY" },
    { gift_code: "WELLDONE", status: "ERROR" }
  ]);
  assert.equal(selectNextOutstandingCode([{ code: "Hangul2026" }, { code: "WELLDONE" }], handled)?.code, "Hangul2026");
});

test("ignores malformed candidate entries rather than selecting an empty code", () => {
  assert.equal(selectNextOutstandingCode([null, {}, { code: " " }, { code: "VIP777" }], new Set())?.code, "VIP777");
});
