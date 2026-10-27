import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import siteLocale from "../api/site-locale.js";

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("site locale endpoint returns Vercel's country code without exposing IP data", () => {
  const res = responseRecorder();
  siteLocale({ method: "GET", headers: { "x-vercel-ip-country": "kr", "x-real-ip": "203.0.113.10" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { countryCode: "KR" });
  assert.equal(res.headers["Cache-Control"], "no-store, max-age=0");
  assert.equal(JSON.stringify(res.body).includes("203.0.113.10"), false);
});

test("site locale endpoint safely falls back when country metadata is unavailable or malformed", () => {
  for (const country of [undefined, "", "KOREA", "K1"]) {
    const res = responseRecorder();
    siteLocale({ method: "GET", headers: { "x-vercel-ip-country": country } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { countryCode: null });
  }
});

test("site locale endpoint only accepts GET requests", () => {
  const res = responseRecorder();
  siteLocale({ method: "POST", headers: { "x-vercel-ip-country": "KR" } }, res);
  assert.equal(res.statusCode, 405);
  assert.deepEqual(res.body, { error: "Method not allowed" });
  assert.equal(res.headers.Allow, "GET");
});

test("country detection only supplies a default and never overrides a saved language choice", async () => {
  const source = await readFile(new URL("../src/shared/site-language.js", import.meta.url), "utf8");
  assert.match(source, /getSavedSiteLanguage\(\)\)return;/);
  assert.match(source, /selectionVersion!==languageSelectionVersion/);
  assert.match(source, /data\?\.countryCode\|\|""\)\.toUpperCase\(\)==="KR"\?"ko":"en"/);
  const detector = source.slice(source.indexOf("function detectDefaultLanguage()"), source.indexOf("export function translate"));
  assert.doesNotMatch(detector, /localStorage\.setItem/);
  assert.match(source, /export function setSiteLanguage\(language\).*localStorage\.setItem\(KEY,next\)/);
});
