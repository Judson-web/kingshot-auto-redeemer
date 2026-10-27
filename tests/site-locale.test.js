import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import visitorTelemetry from "../lib/visitor-telemetry.js";

function responseRecorder() {
  return {
    headers: {}, statusCode: 200, body: null, ended: false,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; }
  };
}

test("locale lookup returns only a normalized Vercel country code", async () => {
  const res = responseRecorder();
  await visitorTelemetry({ method: "GET", headers: { "x-vercel-ip-country": "kr", "x-real-ip": "203.0.113.10" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { countryCode: "KR" });
  assert.equal(res.headers["Cache-Control"], "no-store, max-age=0");
  assert.equal(res.headers.Vary, "x-vercel-ip-country");
  assert.equal(JSON.stringify(res.body).includes("203.0.113.10"), false);
});

test("locale lookup falls back safely for missing, malformed, or non-string country metadata", async () => {
  for (const country of [undefined, "", "KOREA", "K1", ["KR", "US"], null]) {
    const res = responseRecorder();
    await visitorTelemetry({ method: "GET", headers: { "x-vercel-ip-country": country } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { countryCode: null });
  }
});

test("locale lookup handles absent request headers without throwing", async () => {
  const res = responseRecorder();
  await visitorTelemetry({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { countryCode: null });
});

test("telemetry still rejects unsupported methods and only allows GET/POST", async () => {
  const res = responseRecorder();
  await visitorTelemetry({ method: "PUT", headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.deepEqual(res.body, { error: "Method not allowed" });
  assert.equal(res.headers.Allow, "GET, POST");
});

test("country detection only supplies a default and never overrides a saved language choice", async () => {
  const source = await readFile(new URL("../src/shared/site-language.js", import.meta.url), "utf8");
  assert.match(source, /getSavedSiteLanguage\(\)\)return;/);
  assert.match(source, /selectionVersion!==languageSelectionVersion/);
  assert.match(source, /data\?\.countryCode\|\|""\)\.toUpperCase\(\)==="KR"\?"ko":"en"/);
  assert.match(source, /fetch\("\/api\/ops-tools\/visitor"/);
  const detector = source.slice(source.indexOf("function detectDefaultLanguage()"), source.indexOf("export function translate"));
  assert.doesNotMatch(detector, /localStorage\.setItem/);
  assert.match(source, /export function setSiteLanguage\(language\).*localStorage\.setItem\(KEY,next\)/);
});
