import test from "node:test";
import assert from "node:assert/strict";
import { getHandledGiftCodes, selectNextOutstandingCode } from "../internal/kingshot/redemption-history.ts";

test("normalizes persisted statuses and code keys without changing display casing", () => {
  const handled = getHandledGiftCodes([
    { gift_code: "Hangul2026", status: "success" },
    { gift_code: " WELLDONE ", status: "USER INFO ERROR" },
    { gift_code: "VIP777", status: "stove_lv error" },
    { gift_code: "KS1025", status: "STOVE LV ERROR" },
    { gift_code: "PROFILE1", status: "user_info_error" },
    { gift_code: "Kingshot888", status: "TIMEOUT_RETRY", err_code: 40019 },
    null
  ]);
  assert.deepEqual([...handled].sort(), ["HANGUL2026", "KS1025", "PROFILE1", "VIP777", "WELLDONE"]);
});

test("treats concierge recharge-money errors as handled for that player only", () => {
  const codes = [{ code: "VIP1017" }, { code: "KS1017" }];
  const handled = getHandledGiftCodes([
    { gift_code: "VIP1017", status: "RECHARGE_MONEY ERROR" }
  ]);
  assert.equal(selectNextOutstandingCode(codes, handled)?.code, "KS1017");
  // This does not invalidate the code globally; another player can still verify it.
  assert.equal(handled.has("VIP1017"), true);
});

test("moves to the next code after a handled player-specific error", () => {
  const codes = [{ code: "Hangul2026" }, { code: "WELLDONE" }, { code: "VIP777" }];
  const handled = getHandledGiftCodes([
    { gift_code: "Hangul2026", status: "USER INFO ERROR" }
  ]);
  assert.equal(selectNextOutstandingCode(codes, handled)?.code, "WELLDONE");
});

test("returns no candidate when all available codes are handled, including persisted spaced statuses", () => {
  const codes = [{ code: "Hangul2026" }, { code: "WELLDONE" }];
  const handled = getHandledGiftCodes([
    { gift_code: "Hangul2026", status: "SUCCESS" },
    { gift_code: "WELLDONE", status: "STOVE LV ERROR" }
  ]);
  assert.equal(selectNextOutstandingCode(codes, handled), undefined);
});

test("retries only definitive upstream rate-limit responses and quarantines uncertain outcomes", () => {
  const handled = getHandledGiftCodes([
    { gift_code: "RATE_LIMIT", status: "TIMEOUT_RETRY", err_code: 40019 },
    { gift_code: "NETWORK_TIMEOUT", status: "TIMEOUT RETRY", err_code: 40004 },
    { gift_code: "PROCESSING", status: "PROCESSING" },
    { gift_code: "UNKNOWN_ERROR", status: "ERROR" }
  ]);
  assert.equal(selectNextOutstandingCode([{ code: "RATE_LIMIT" }, { code: "NETWORK_TIMEOUT" }], handled)?.code, "RATE_LIMIT");
  assert.equal(handled.has("NETWORK_TIMEOUT"), true);
  assert.equal(handled.has("PROCESSING"), true);
  assert.equal(handled.has("UNKNOWN_ERROR"), true);
});

test("ignores malformed candidate entries rather than selecting an empty code", () => {
  assert.equal(selectNextOutstandingCode([null, {}, { code: " " }, { code: "VIP777" }], new Set())?.code, "VIP777");
});
