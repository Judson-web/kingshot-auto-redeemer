import assert from "node:assert/strict";
import test from "node:test";
import { allianceDetails, allianceDisplayName, formatPower, playerDisplayName, playerPower } from "../lib/player-display.js";

test("player names show a single alliance tag using provider alliance objects", () => {
  const player = { nick_name: "  Sharkyo  ", alliance: { name: "The Wind", abbr: "WIND" } };
  assert.equal(playerDisplayName(player), "[WIND] Sharkyo");
  assert.equal(allianceDisplayName(player), "[WIND] The Wind");
  assert.deepEqual(allianceDetails(player), { name: "The Wind", tag: "WIND" });
});

test("alliance metadata falls back to stored flat columns and avoids duplicate tags", () => {
  assert.equal(playerDisplayName({ player_name: "[WIND] Sharkyo", alliance_tag: "WIND" }), "Sharkyo [WIND]");
  assert.equal(allianceDisplayName({ alliance_name: "The Wind", alliance_tag: "[WIND]" }), "[WIND] The Wind");
  assert.equal(playerDisplayName({}, "Unknown player"), "Unknown player");
});

test("power values are normalized and formatted consistently", () => {
  assert.equal(playerPower({ power: "411,851,257" }), 411851257);
  assert.equal(playerPower({ player_power: 123000000 }), 123000000);
  assert.equal(playerPower({ power: "not reported" }), null);
  assert.equal(formatPower(411851257), "411.85M");
  assert.equal(formatPower("1,250"), "1.3K");
  assert.equal(formatPower(928), "928");
  assert.equal(formatPower(null), "—");
  assert.equal(formatPower(-1), "—");
});
