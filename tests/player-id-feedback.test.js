import test from "node:test";
import assert from "node:assert/strict";
import { playerIdFeedback } from "../src/player-id-feedback.js";

test("invalid Player ID format has a precise in-game correction", () => {
  const issue = playerIdFeedback("invalid_player_id", "Player ID must contain 5–20 digits.");
  assert.deepEqual(issue, {
    type: "invalid",
    title: "Check Player ID",
    message: "Use the numeric Player ID shown in Kingshot under Profile → Info. It must contain 5–20 digits; your kingdom number is different."
  });
});

test("missing player lookup uses not-found guidance without calling the ID malformed", () => {
  const issue = playerIdFeedback("player_not_found", "MightPulse could not find this player.");
  assert.equal(issue.type, "not_found");
  assert.equal(issue.title, "Player not found");
  assert.match(issue.message, /Check every digit/);
  assert.match(issue.message, /If the ID is correct, try again shortly/);
  assert.doesNotMatch(issue.message, /invalid ID/i);
});

test("known error messages are classified even if an older API omits its error code", () => {
  assert.equal(playerIdFeedback("", "Invalid Player ID.").type, "invalid");
  assert.equal(playerIdFeedback("", "The player lookup provider could not find this player.").type, "not_found");
});

test("upstream outages and unrelated errors are not mislabeled as invalid IDs", () => {
  assert.equal(playerIdFeedback("upstream_unavailable", "Player lookup provider is unavailable."), null);
  assert.equal(playerIdFeedback("upstream_timeout", "MightPulse request timed out."), null);
  assert.equal(playerIdFeedback("rate_limit_exceeded", "Too many player lookups."), null);
  assert.equal(playerIdFeedback("", "This Player ID is blocked from registration."), null);
});
