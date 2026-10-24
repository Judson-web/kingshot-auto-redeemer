import test from "node:test";
import assert from "node:assert/strict";
import { makeSuccessOutcome, makeFailureOutcome, summarizeRegistrationOutcomes, registrationOutcomeHeadline } from "../src/registration-outcomes.js";

test("classifies new, already-registered and reactivated players distinctly", () => {
  const player = { nick_name: "Sparky", kid: 280 };
  assert.equal(makeSuccessOutcome("12345678", player, { registrationStatus: "NEW" }).kind, "registered");
  assert.equal(makeSuccessOutcome("12345679", player, { registrationStatus: "ALREADY_REGISTERED", alreadyRegistered: true }).kind, "existing");
  assert.equal(makeSuccessOutcome("12345680", player, { registrationStatus: "REACTIVATED" }).kind, "reactivated");
});

test("treats banned IDs as disabled and preserves the restriction reason", () => {
  const item = makeFailureOutcome({
    id: "415857658", code: "player_banned", banned: true,
    ban: { reason: "Abuse or invalid registration" },
    message: "This Player ID is blocked from registration. Reason: Abuse or invalid registration"
  });
  assert.equal(item.kind, "disabled");
  assert.equal(item.label, "DISABLED");
  assert.equal(item.reason, "Abuse or invalid registration");
  assert.equal(item.summary, "Auto-redemption is disabled. Contact support if you think this is a mistake.");
});

test("classifies disabled and already-active responses without treating them as generic failures", () => {
  const disabled = makeFailureOutcome({ id: "100001", code: "player_disabled", message: "This player is disabled for auto-redemption." });
  const existing = makeFailureOutcome({ id: "100002", message: "This Player ID is already enrolled." });
  assert.equal(disabled.kind, "disabled");
  assert.equal(existing.kind, "existing");
});

test("mixed multi-ID results preserve per-ID outcomes and aggregate counts", () => {
  const items = [
    makeSuccessOutcome("100001", { nick_name: "One" }, { registrationStatus: "NEW" }),
    makeSuccessOutcome("100002", {}, { registrationStatus: "ALREADY_REGISTERED", alreadyRegistered: true }),
    makeFailureOutcome({ id: "100003", banned: true, message: "This Player ID is blocked from registration. Reason: abuse" }),
    makeFailureOutcome({ id: "100004", code: "player_disabled", message: "Player disabled" }),
    makeFailureOutcome({ id: "100005", message: "Player profile not found" })
  ];
  const summary = summarizeRegistrationOutcomes(items);
  assert.deepEqual({ total: summary.total, active: summary.active, registered: summary.registered, existing: summary.existing, disabled: summary.disabled, failed: summary.failed },
    { total: 5, active: 2, registered: 1, existing: 1, disabled: 2, failed: 1 });
  assert.equal(summary.message, "Review each player below.");
  assert.equal(summary.needsAttention, true);
  assert.equal(registrationOutcomeHeadline(items), "Registration results");
});

test("successful registration outcomes include formatted power and alliance tag", () => {
  const item = makeSuccessOutcome("12345678", {
    nick_name: "Sparky", kid: 280, power: "411851257", town_center_level: 31, alliance: { name: "The Wind", abbr: "WIND" }
  }, { registrationStatus: "NEW" });
  assert.equal(item.name, "[WIND] Sparky");
  assert.equal(item.power, "411.85M");
  assert.equal(item.townCenterLevel, 31);
  assert.equal(item.kingdom, "280");
  assert.equal(item.allianceName, "The Wind");
  assert.equal(item.allianceTag, "WIND");
});

test("failed registration preserves profile details already retrieved", () => {
  const item = makeFailureOutcome({
    id: "12345678", message: "Registration service unavailable",
    player: { nick_name: "Sparky", kid: 280, power: 123000000, alliance: { abbr: "WIND" } }
  });
  assert.equal(item.name, "[WIND] Sparky");
  assert.equal(item.power, "123.00M");
  assert.equal(item.kingdom, "280");
});

test("single-ID summary keeps the individual headline", () => {
  const outcome = makeFailureOutcome({ id: "100006", banned: true, message: "blocked" });
  assert.equal(registrationOutcomeHeadline([outcome]), "Auto-redemption disabled");
  assert.equal(summarizeRegistrationOutcomes([outcome]).total, 1);
});

test("Auto Redeem distinguishes a malformed Player ID from a player not found", () => {
  const invalid = makeFailureOutcome({
    id: "1234", code: "invalid_player_id",
    message: "Player ID must contain 5–20 digits."
  });
  const missing = makeFailureOutcome({
    id: "43180889", code: "player_not_found",
    message: "MightPulse could not find this player."
  });

  assert.equal(invalid.kind, "failed");
  assert.equal(invalid.label, "INVALID ID");
  assert.equal(invalid.headline, "Check Player ID");
  assert.match(invalid.summary, /Profile → Info/);
  assert.match(invalid.summary, /5–20 digits/);

  assert.equal(missing.kind, "failed");
  assert.equal(missing.label, "NOT FOUND");
  assert.equal(missing.headline, "Player not found");
  assert.match(missing.summary, /Check every digit/);
  assert.match(missing.summary, /If the ID is correct, try again shortly/);
});

test("Auto Redeem leaves provider outages as provider errors instead of invalid-ID errors", () => {
  const item = makeFailureOutcome({
    id: "43180889", code: "upstream_unavailable",
    message: "Player lookup provider is unavailable."
  });
  assert.equal(item.label, "NEEDS ATTENTION");
  assert.equal(item.headline, "Registration needs attention");
  assert.match(item.summary, /provider is unavailable/i);
});

