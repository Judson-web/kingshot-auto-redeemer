import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("worker discovers gift codes only from the single Kingshot.net API feed", () => {
  const source = readFileSync(new URL("../api/kingshot-auto.js", import.meta.url), "utf8");
  const scraper = readFileSync(new URL("../internal/kingshot/scraper.ts", import.meta.url), "utf8");
  assert.ok(source.includes('const GIFT_SOURCE_URL="https://kingshot.net/api/gift-codes"'));
  assert.ok(source.includes('fetchSource(rpc,GIFT_SOURCE_URL,"api")'));
  assert.ok(source.includes("const kingshotPageCodes=[]"));
  assert.ok(source.includes("mergeCodes([apiCodes,kingshotPageCodes])"));
  assert.ok(!source.includes("kingshotPageSource"));
  assert.ok(!source.includes("kingshot.net/gift-codes"));
  assert.ok(scraper.includes('kind !== "api" || url !== "https://kingshot.net/api/gift-codes"'));
  assert.ok(source.includes("Kingshot gift-code verification advisory:"));
  assert.ok(!source.includes("if(canaryCandidate&&dispatchPlayers.length)"));
});
