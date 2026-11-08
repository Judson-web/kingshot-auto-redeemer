import test from "node:test";
import assert from "node:assert/strict";
import { resolveGiftCodeValidationStatus } from "../internal/kingshot/gift-code-validation.ts";

test("successful or already-received redemption verifies a code", () => {
  for (const status of ["SUCCESS", "RECEIVED", "SAME TYPE EXCHANGE"]) {
    assert.equal(
      resolveGiftCodeValidationStatus({ ["11OFFICIALSTORE08_status_" + status]: 1 }, "11OFFICIALSTORE08")?.status,
      "verified"
    );
  }
});

test("positive evidence wins over conflicting invalid or expired responses", () => {
  const result = resolveGiftCodeValidationStatus({
    "CODE_status_CDK NOT FOUND": 1,
    "CODE_status_SUCCESS": 1,
    "CODE_status_TIME ERROR": 1
  }, "code");
  assert.equal(result?.status, "verified");
});

test("recognized usage-limit, invalid, and expired responses are distinguished", () => {
  assert.equal(resolveGiftCodeValidationStatus({ "CODE_status_USAGE LIMIT": 2 }, "code")?.status, "usage_limit");
  assert.equal(resolveGiftCodeValidationStatus({ "CODE_status_CDK_NOT_FOUND": 1 }, "code")?.status, "invalid");
  assert.equal(resolveGiftCodeValidationStatus({ "CODE_status_TIME_ERROR": 1 }, "code")?.status, "expired");
});

test("player-specific and transport failures never establish global code validity", () => {
  for (const status of ["USER INFO ERROR", "STOVE LV ERROR", "RECHARGE MONEY ERROR", "ERROR", "TIMEOUT", "HTTP RATE LIMIT"]) {
    assert.equal(resolveGiftCodeValidationStatus({ ["CODE_status_" + status]: 1 }, "code"), null);
  }
});

test("negative evidence does not overwrite an existing definitive status", () => {
  assert.equal(resolveGiftCodeValidationStatus({ "CODE_status_CDK NOT FOUND": 1 }, "code", "verified"), null);
  assert.equal(resolveGiftCodeValidationStatus({ "CODE_status_USAGE LIMIT": 1 }, "code", "expired"), null);
});

test("code matching is case-insensitive and ignores non-positive counts", () => {
  assert.equal(resolveGiftCodeValidationStatus({ "11officialstore08_status_SUCCESS": 0 }, "11OFFICIALSTORE08"), null);
  assert.equal(resolveGiftCodeValidationStatus({ "11officialstore08_status_SUCCESS": 1 }, "11OFFICIALSTORE08")?.status, "verified");
});

test("new gift-code candidates are prioritized before older verified codes", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../api/kingshot-auto.js", import.meta.url), "utf8");
  assert.ok(source.includes("const priorityCodeKeys=new Set(activeCodes.filter"));
  assert.ok(source.includes("activeCodes=[...activeCodes.filter(item=>priorityCodeKeys.has"));
  assert.ok(source.includes("codes:activeCodes,players:batchPlayers"));
  assert.ok(source.includes("set_kingshot_gift_codes_validation"));
});

test("batch validation migration protects verified results and limits negative updates", async () => {
  const { readFile } = await import("node:fs/promises");
  const migration = await readFile(new URL("../supabase/migrations/20261108120000_batch_gift_code_validation.sql", import.meta.url), "utf8");
  assert.ok(migration.includes("v_status='verified'"));
  assert.ok(migration.includes("validation_status in ('pending','indeterminate')"));
  assert.ok(migration.includes("where upper(code)=any(v_codes)"));
  assert.ok(migration.includes("grant execute on function public.set_kingshot_gift_codes_validation"));
});
