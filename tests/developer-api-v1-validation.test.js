import assert from "node:assert/strict";
import test from "node:test";
import { isValidV1PlayerId, isValidV1RedemptionInput } from "../lib/developer-api-v1-validation.js";

test("V1 player validator accepts numeric IDs and rejects malformed values", () => {
  assert.equal(isValidV1PlayerId("43180889"), true);
  assert.equal(isValidV1PlayerId("12345"), true);
  for (const value of ["1234", "123456789012345678901", "12abc34", "", 43180889, null]) assert.equal(isValidV1PlayerId(value), false);
});

test("V1 redemption validator accepts valid numeric player and kingdom IDs", () => {
  assert.equal(isValidV1RedemptionInput("43180889", "EXAMPLE_CODE-1", "1125"), true);
  assert.equal(isValidV1RedemptionInput("43180889", "VIP777", "1"), true);
  assert.equal(isValidV1RedemptionInput("12abc34", "VIP777", "1125"), false);
  assert.equal(isValidV1RedemptionInput("43180889", "bad code", "1125"), false);
  assert.equal(isValidV1RedemptionInput("43180889", "VIP777", "11x5"), false);
});
