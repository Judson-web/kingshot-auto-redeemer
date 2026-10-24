import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRegistrationInput } from "../internal/kingshot/registration-input.js";

test("normalization trims a legitimate Player ID but preserves the numeric ID exactly", () => {
  const result = normalizeRegistrationInput({ playerId: " 43180889 " });
  assert.equal(result.playerId, "43180889");
});

test("normalization does not turn malformed Player IDs into different numeric IDs", () => {
  assert.equal(normalizeRegistrationInput({ playerId: "abc43180889" }).playerId, "abc43180889");
  assert.equal(normalizeRegistrationInput({ playerId: "43180889.0" }).playerId, "43180889.0");
  assert.equal(normalizeRegistrationInput({ playerId: "4318 0889" }).playerId, "4318 0889");
});

test("normalization preserves malformed Kingdom IDs for the API validator to reject", () => {
  assert.equal(normalizeRegistrationInput({ kingdomId: "K1143" }).kingdomId, "K1143");
  assert.equal(normalizeRegistrationInput({ kingdomId: " 1143 " }).kingdomId, "1143");
});

test("optional registration metadata is trimmed and bounded", () => {
  const result = normalizeRegistrationInput({
    playerId: null,
    playerName: "  Example player  ",
    avatarUrl: "  https://example.test/avatar.png  "
  });
  assert.equal(result.playerId, "");
  assert.equal(result.playerName, "Example player");
  assert.equal(result.avatarUrl, "https://example.test/avatar.png");
  assert.equal(normalizeRegistrationInput({ playerName: "x".repeat(150) }).playerName.length, 120);
  assert.equal(normalizeRegistrationInput({ avatarUrl: "x".repeat(600) }).avatarUrl.length, 500);
});
