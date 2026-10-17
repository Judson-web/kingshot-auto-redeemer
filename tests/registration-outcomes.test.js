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
  assert.equal(item.summary, "This Player ID is disabled for automatic redemption. Contact support if you need help re-enabling it.");
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
  assert.match(summary.message, /5 Player IDs checked/);
  assert.match(summary.message, /2 active/);
  assert.match(summary.message, /2 disabled/);
  assert.equal(summary.needsAttention, true);
  assert.equal(registrationOutcomeHeadline(items), "Registration results");
});

test("single-ID summary keeps the individual headline", () => {
  const outcome = makeFailureOutcome({ id: "100006", banned: true, message: "blocked" });
  assert.equal(registrationOutcomeHeadline([outcome]), "Auto-redemption disabled");
  assert.equal(summarizeRegistrationOutcomes([outcome]).total, 1);
});
