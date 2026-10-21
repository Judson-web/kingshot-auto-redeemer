import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNewGiftCodeAlert,
  buildGiftCodeValidationAlert,
  buildGiftCodeVerificationErrorAlert
} from "../lib/discord-gift-code-alerts.js";

test("candidate alert never claims a discovered code is valid", () => {
  const alert = buildNewGiftCodeAlert({
    code: "lwaL5ZKx5", source: "kingshot-net-api", confidence: 0.35,
    confidenceTier: "low", expiresAt: null
  });
  assert.match(alert.title, /candidate discovered/i);
  assert.match(alert.description, /not a confirmation/i);
  assert.equal(alert.fields.find(item => item.name === "Code status").value, "UNVERIFIED");
  assert.equal(alert.fields.find(item => item.name === "Evidence sources").value, "Kingshot.net API");
});

test("USAGE_LIMIT wording confirms code recognition and describes the limit", () => {
  const alert = buildGiftCodeValidationAlert({
    code: "lwaL5ZKx5", status: "USAGE_LIMIT", validationStatus: "usage_limit"
  });
  assert.match(alert.title, /code recognized.*redemption limit reached/i);
  assert.match(alert.description, /recognized this code.*redemption limit has been reached/i);
  assert.match(alert.description, /not a code-not-found or invalid-code result/i);
  assert.match(alert.fields.find(item => item.name === "Next step").value, /do not mark it invalid/i);
});

test("only explicit invalid/expired responses get definitive rejection alert titles", () => {
  assert.match(buildGiftCodeValidationAlert({status:"CDK_NOT_FOUND",validationStatus:"invalid"}).title, /not found/i);
  assert.match(buildGiftCodeValidationAlert({status:"TIME_ERROR",validationStatus:"expired"}).title, /expired/i);
  assert.match(buildGiftCodeValidationAlert({status:"ROLE_NOT_EXIST",validationStatus:"pending"}).title, /inconclusive/i);
});

test("verification failure alert makes no claim about code validity", () => {
  const alert = buildGiftCodeVerificationErrorAlert({code:"EXAMPLECODE",errorCategory:"TIMEOUT"});
  assert.match(alert.description, /not evidence that the code is invalid/i);
  assert.ok(alert.fields.some(field => field.name === "Error category" && field.value === "TIMEOUT"));
});
