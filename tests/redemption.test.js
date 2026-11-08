import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kingshotSignature, parseRetryAfter, handleNativeRedemption } from "../cloudflare/redemption.ts";

test("Kingshot MD5 signing uses sorted form fields and MD5", async () => {
  const result = await kingshotSignature({ fid:"123", cdk:"ABCDEF", kid:"7", time:"1" }, "secret");
  assert.match(result, /^[a-f0-9]{32}$/);
  assert.equal(result, "df625edccc6bd1a93fb7f2e92185b660");
});
test("manual redemption rejects invalid player ID before writes", async () => {
  const r=await handleNativeRedemption(new Request("https://worker.test/api/kingshot-redeem",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({playerId:"bad",code:"ABCDEF",kid:"7"})}),{SUPABASE_WRITE_MODE:"enabled"});
  assert.equal(r.status,400); assert.equal((await r.json()).code,"invalid_player_id");
});
test("manual redemption writes remain disabled in preview", async () => {
  const r=await handleNativeRedemption(new Request("https://worker.test/api/kingshot-redeem",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({playerId:"123456789",code:"ABCDEF",kid:"7"})}),{SUPABASE_WRITE_MODE:"disabled"});
  assert.equal(r.status,503); assert.equal((await r.json()).code,"writes_disabled");
});
test("manual redemption refuses to run without Neon recovery journal", async () => {
  const r=await handleNativeRedemption(new Request("https://worker.test/api/kingshot-redeem",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({playerId:"123456789",code:"ABCDEF",kid:"7"})}),{SUPABASE_WRITE_MODE:"enabled",SUPABASE_URL:"https://db.test",SUPABASE_SERVICE_ROLE_KEY:"test"});
  assert.equal(r.status,503); assert.equal((await r.json()).code,"redemption_unavailable");
});

test("Retry-After parses delta seconds and clamps past HTTP dates", () => {
  assert.equal(parseRetryAfter("45", 0), 45);
  assert.equal(parseRetryAfter("invalid", 0), 60);
  assert.equal(parseRetryAfter("Thu, 01 Jan 1970 00:00:10 GMT", 15000), 0);
});

test("secondary executor claims future Neon reservations in one batch and waits only at the database executor", () => {
  const claimMigration = readFileSync("supabase/migrations/20261108140000_hybrid_redemption_execution_pipeline.sql", "utf8");
  const executorMigration = readFileSync("supabase/migrations/20261108170000_secondary_database_executor.sql", "utf8");
  const claimStart = claimMigration.indexOf("create or replace function public.redemption_claim_batch");
  const claimEnd = claimMigration.indexOf("create or replace function public.redemption_complete_batch", claimStart);
  const claimSql = claimMigration.slice(claimStart, claimEnd);
  assert.match(claimSql, /q\.state='pending'/);
  assert.doesNotMatch(claimSql, /available_at\s*<=\s*now\(\)/);
  assert.match(executorMigration, /v_wait:=extract\(epoch from \(v_item\.available_at-clock_timestamp\(\)\)\)/);
  assert.match(executorMigration, /pg_sleep\(least\(v_wait,600\)\)/);
  assert.doesNotMatch(executorMigration, /pg_sleep\(0\.1\)/);
});
