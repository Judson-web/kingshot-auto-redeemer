import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("worker discovers gift codes only from the two official Kingshot.net feeds", () => {
  const source = readFileSync(new URL("../api/kingshot-auto.js", import.meta.url), "utf8");
  assert.ok(source.includes('const GIFT_SOURCE_URL="https://kingshot.net/api/gift-codes"'));
  assert.ok(source.includes("kingshotPageSource.codes"));
  assert.ok(source.includes("mergeCodes([apiCodes,kingshotPageCodes])"));
  assert.ok(!source.includes("mergeCodes([apiCodes,kingshotPageCodes,adminCodes])"));
  assert.ok(source.includes("Kingshot gift-code verification advisory:"));
  assert.ok(!source.includes("if(canaryCandidate&&dispatchPlayers.length)"));
});
