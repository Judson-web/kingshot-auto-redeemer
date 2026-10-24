import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_REGISTRATION_IDS,
  registrationInputSummary,
  splitRegistrationIds,
  validateRegistrationIds
} from "../src/registration-input.js";

test("empty auto-registration input asks for at least one Player ID", () => {
  assert.equal(validateRegistrationIds("").error, "Enter at least one Kingshot Player ID.");
  assert.equal(validateRegistrationIds("  ").ids.length, 0);
  assert.equal(validateRegistrationIds(",,  ,").error, "Enter at least one Kingshot Player ID.");
});

test("Player IDs can be separated with commas, spaces, or new lines", () => {
  const result = validateRegistrationIds("43180889, 51234567\n 61234567\t71234567");
  assert.equal(result.error, "");
  assert.deepEqual(result.ids, ["43180889", "51234567", "61234567", "71234567"]);
});

test("duplicate IDs are deduplicated while keeping their original order", () => {
  const parsed = splitRegistrationIds("43180889,51234567\n43180889 51234567");
  assert.deepEqual(parsed.ids, ["43180889", "51234567"]);
  assert.equal(parsed.duplicateCount, 2);
  const result = validateRegistrationIds("43180889,51234567,43180889");
  assert.deepEqual(result.ids, ["43180889", "51234567"]);
  assert.equal(result.duplicateCount, 1);
});

test("invalid characters and invalid ID lengths are explained before requests are made", () => {
  assert.match(validateRegistrationIds("43180889;51234567").error, /digits, commas, spaces, or new lines/i);
  assert.match(validateRegistrationIds("1234").error, /5–20 digits/);
  assert.match(validateRegistrationIds("123456789012345678901").error, /5–20 digits/);
});

test("submission is capped at ten unique IDs", () => {
  const ten = Array.from({ length: MAX_REGISTRATION_IDS }, (_, i) => String(43180000 + i)).join("\n");
  const eleven = ten + "\n43180100";
  assert.equal(validateRegistrationIds(ten).ids.length, MAX_REGISTRATION_IDS);
  assert.match(validateRegistrationIds(eleven).error, /up to 10 unique Player IDs/i);
  assert.match(registrationInputSummary(eleven).detail, /Process 10 at a time/);
});

test("live input summary reports duplicate cleanup without hiding IDs", () => {
  const result = registrationInputSummary("43180889, 51234567 43180889");
  assert.equal(result.label, "2 unique IDs entered");
  assert.match(result.detail, /1 duplicate ID will be ignored/);
});
