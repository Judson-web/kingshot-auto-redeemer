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
    { gift_code: "Kingshot888", status: "TIMEOUT_RETRY" },
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


test("bulk history filtering excludes fully handled players before shard dispatch", async () => {
  const { filterPlayersWithOutstandingCodes } = await import("../internal/kingshot/redemption-history.ts");
  const players = [{ player_id: "1" }, { player_id: "2" }, { player_id: "3" }];
  const codes = [{ code: "VIP777" }, { code: "KS1104" }];
  const result = filterPlayersWithOutstandingCodes(players, codes, [
    { player_id: "1", gift_code: "VIP777", status: "SUCCESS" },
    { player_id: "1", gift_code: "KS1104", status: "RECEIVED" },
    { player_id: "2", gift_code: "VIP777", status: "TIMEOUT_RETRY" },
    { player_id: "2", gift_code: "KS1104", status: "SUCCESS" }
  ]);
  assert.deepEqual(result.eligiblePlayers.map(player => player.player_id), ["2", "3"]);
  assert.deepEqual(result.alreadyHandledPlayers.map(player => player.player_id), ["1"]);
  assert.equal(result.historiesByPlayer.get("2").length, 2);
});

test("bulk history filtering keeps transient errors eligible and filters handled status aliases", async () => {
  const { filterPlayersWithOutstandingCodes } = await import("../internal/kingshot/redemption-history.ts");
  const result = filterPlayersWithOutstandingCodes(
    [{ player_id: "1" }, { player_id: "2" }],
    [{ code: "VIP777" }],
    [
      { player_id: "1", gift_code: "VIP777", status: "STOVE_LV ERROR" },
      { player_id: "2", gift_code: "VIP777", status: "UPSTREAM_TIMEOUT" }
    ]
  );
  assert.deepEqual(result.eligiblePlayers.map(player => player.player_id), ["2"]);
  assert.deepEqual(result.alreadyHandledPlayers.map(player => player.player_id), ["1"]);
});
