import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_REGISTRATION_IDS,
  registrationInputSummary,
  sanitizeRegistrationInput,
  splitRegistrationIds,
  validateRegistrationIds
} from "../src/registration-input.js";

test("empty or separator-only auto-registration input asks for at least one Player ID", () => {
  assert.equal(validateRegistrationIds("").error, "Enter at least one Kingshot Player ID.");
  assert.equal(validateRegistrationIds("  ").ids.length, 0);
  assert.equal(validateRegistrationIds(",,  ,").error, "Enter at least one Kingshot Player ID.");
});

test("pasted multiline lists normalize to digits, commas, and plain spaces", () => {
  const clean = sanitizeRegistrationInput("43180889,\n51234567\t 61234567");
  assert.equal(clean, "43180889, 51234567 61234567");
  assert.match(clean, /^[0-9, ]+$/);
  assert.deepEqual(validateRegistrationIds(clean).ids, ["43180889", "51234567", "61234567"]);
});

test("non-breaking and repeated Unicode whitespace normalize to a valid separator", () => {
  const clean = sanitizeRegistrationInput("43180889\u00a051234567\u200361234567");
  assert.equal(clean, "43180889 51234567 61234567");
  assert.deepEqual(validateRegistrationIds(clean).ids, ["43180889", "51234567", "61234567"]);
});

test("pasted symbols cannot turn an invalid token into a different Player ID", () => {
  assert.equal(sanitizeRegistrationInput("123abc456"), "");
  assert.equal(sanitizeRegistrationInput("12#345678"), "");
  assert.equal(sanitizeRegistrationInput("43180889;51234567"), "");
  assert.deepEqual(validateRegistrationIds(sanitizeRegistrationInput("123abc456, 51234567")).ids, ["51234567"]);
});

test("10 IDs at the exact length boundaries are accepted; too-short IDs are rejected", () => {
  assert.equal(validateRegistrationIds("12345").error, "");
  assert.equal(validateRegistrationIds("12345678901234567890").error, "");
  assert.match(validateRegistrationIds("1234").error, /5–20 digits/);
  assert.match(validateRegistrationIds("123456789012345678901").error, /5–20 digits/);
});

test("invalid pasted tokens are dropped whole instead of turning into different IDs", () => {
  const clean = sanitizeRegistrationInput("Player 43180889, abc123, 51234567!");
  assert.equal(clean, " 43180889, , ");
  assert.deepEqual(validateRegistrationIds(clean.trim()).ids, ["43180889"]);
  assert.equal(sanitizeRegistrationInput("83838n2mk.").trim(), "");
});

test("direct validation rejects letters, symbols, tabs, and raw new lines", () => {
  assert.match(validateRegistrationIds("43180889;51234567").error, /digits, commas, and spaces only/i);
  assert.match(validateRegistrationIds("4318abc89").error, /digits, commas, and spaces only/i);
  assert.match(validateRegistrationIds("43180889\n51234567").error, /digits, commas, and spaces only/i);
  assert.match(validateRegistrationIds("1234").error, /5–20 digits/);
  assert.match(validateRegistrationIds("123456789012345678901").error, /5–20 digits/);
});

test("duplicate IDs are deduplicated while keeping their original order", () => {
  const parsed = splitRegistrationIds("43180889,51234567 43180889 51234567");
  assert.deepEqual(parsed.ids, ["43180889", "51234567"]);
  assert.equal(parsed.duplicateCount, 2);
  const result = validateRegistrationIds("43180889,51234567,43180889");
  assert.deepEqual(result.ids, ["43180889", "51234567"]);
  assert.equal(result.duplicateCount, 1);
});

test("submission is capped at ten unique IDs", () => {
  const ten = Array.from({ length: MAX_REGISTRATION_IDS }, (_, i) => String(43180000 + i)).join(" ");
  const eleven = ten + " 43180100";
  assert.equal(validateRegistrationIds(ten).ids.length, MAX_REGISTRATION_IDS);
  assert.match(validateRegistrationIds(eleven).error, /up to 10 unique Player IDs/i);
  assert.match(registrationInputSummary(eleven).detail, /Process 10 at a time/);
});

test("live input summary reports duplicate cleanup without hiding IDs", () => {
  const result = registrationInputSummary("43180889, 51234567 43180889");
  assert.equal(result.label, "2 unique IDs entered");
  assert.match(result.detail, /1 duplicate ID will be ignored/);
});
