import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeV3PlayerId, validateV3RedemptionBody } from "../lib/developer-api-v3-validation.js";

test("V3 player IDs accept numeric strings from 5 to 20 digits",()=>{
 assert.equal(normalizeV3PlayerId("43180889"),"43180889");
 assert.equal(normalizeV3PlayerId(" 43180889 "),"43180889");
 for(const input of ["1234","123456789012345678901","12abc34",43180889,null,undefined,""])assert.equal(normalizeV3PlayerId(input),null);
});
test("V3 redemption validation accepts and normalizes valid string inputs",()=>{
 assert.deepEqual(validateV3RedemptionBody({playerId:"43180889",code:"EXAMPLE_CODE-1",kid:"1125"}),{valid:true,value:{playerId:"43180889",code:"EXAMPLE_CODE-1",kid:"1125"}});
});
test("V3 redemption validation rejects extra fields, wrong types and malformed values",()=>{
 assert.equal(validateV3RedemptionBody({playerId:"43180889",code:"OK",kid:"1125",admin:true}).code,"unknown_fields");
 assert.equal(validateV3RedemptionBody({playerId:43180889,code:"OK",kid:"1125"}).code,"invalid_player_id");
 assert.equal(validateV3RedemptionBody({playerId:"43180889",code:"bad code",kid:"1125"}).code,"invalid_gift_code");
 assert.equal(validateV3RedemptionBody({playerId:"43180889",code:"OK",kid:"1a25"}).code,"invalid_kingdom_id");
 assert.equal(validateV3RedemptionBody([]).code,"invalid_request_body");
});
test("V3 routes are wired through existing serverless handler",async()=>{
 const config=JSON.parse(await readFile(new URL("../vercel.json",import.meta.url),"utf8"));
 assert.ok(config.rewrites.some(r=>r.source==="/api/v3/players/:playerId"&&r.destination.includes("developer=v3-player")));
 assert.ok(config.rewrites.some(r=>r.source==="/api/v3/redemptions"&&r.destination.includes("developer=v3-redemptions")));
 const router=await readFile(new URL("../api/kingshot-player.ts",import.meta.url),"utf8");
 assert.match(router,/developerPath\.startsWith\("v3-"\)/);
 assert.match(router,/developerApiV3\(req, res, developerPath\.slice\(3\)\)/);
});
