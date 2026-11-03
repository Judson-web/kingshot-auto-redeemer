import test from "node:test";
import assert from "node:assert/strict";
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

test("Retry-After parses delta seconds and clamps past HTTP dates", () => {\n  assert.equal(parseRetryAfter("45", 0), 45);\n  assert.equal(parseRetryAfter("invalid", 0), 60);\n  assert.equal(parseRetryAfter("Thu, 01 Jan 1970 00:00:10 GMT", 15000), 0);\n});\n