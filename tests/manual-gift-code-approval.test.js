import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const adminApi = await readFile(new URL("../api/custom-message.js", import.meta.url), "utf8");
const adminUi = await readFile(new URL("../src/GiftCodesApp.jsx", import.meta.url), "utf8");
const expiryMigration = await readFile(new URL("../supabase/migrations/20261023150000_admin_manual_gift_code_approval.sql", import.meta.url), "utf8");

test("trusted admin-added codes are active and verified without canary validation", () => {
  assert.ok(adminApi.includes('if(body.confirmManual!==true)'));
  assert.ok(adminApi.includes('validation_status:"verified"'));
  assert.ok(adminApi.includes('validation_message:"Manual approval: trusted-source confirmation accepted; canary verification skipped."'));
  assert.ok(adminApi.includes("verificationSkipped:true"));
  assert.ok(adminUi.includes("Canary verification was skipped"));
  const addAction = adminApi.slice(adminApi.indexOf('if(action==="GIFT_CODE_ADD")'), adminApi.indexOf('if(action==="GIFT_CODE_UPDATE"'));
  assert.ok(!addAction.includes('validation_status:"pending"'));
});

test("manual approval overrides only older invalid history, not explicit expiry or later failures", () => {
  assert.ok(expiryMigration.includes("g.expires_at <= now()"));
  assert.ok(expiryMigration.includes("g.validated_at > r.attempted_at"));
  assert.ok(expiryMigration.includes("g.validation_message like 'Manual approval:%'"));
  assert.ok(expiryMigration.includes("'TIME_ERROR'"));
  assert.ok(expiryMigration.includes("'CDK_NOT_FOUND'"));
});

test("manually entered codes with an expiry in the past are rejected", () => {
  assert.ok(adminApi.includes("expiryDate!==null&&expiryDate<=Date.now()"));
});
