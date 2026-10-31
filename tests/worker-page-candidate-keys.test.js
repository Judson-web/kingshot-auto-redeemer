import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("worker initializes page candidate keys from the first-party page scraper before canary selection", () => {
  const source = readFileSync(new URL("../api/kingshot-auto.js", import.meta.url), "utf8");
  const declaration = 'const pageCandidateKeys=new Set(kingshotPageCodes.map(item=>String(item.code||"").trim().toUpperCase()))';
  const use = "pageCandidateKeys.has(codeKey)";
  assert.ok(source.includes(declaration), "page candidate keys must be derived from kingshotPageCodes");
  assert.ok(source.indexOf(declaration) < source.indexOf(use), "page candidate keys must be initialized before canary filtering");
});
