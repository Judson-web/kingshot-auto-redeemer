import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { trustedClientIp } from "../lib/api-v3/http.ts";

test("V3 trusted client identity uses only Cloudflare's edge-authenticated IP header", () => {
  assert.equal(trustedClientIp({ headers: { "cf-connecting-ip": "203.0.113.8" } }), "203.0.113.8");
  assert.equal(trustedClientIp({ headers: { "x-vercel-forwarded-for": "198.51.100.4" } }), "");
  assert.equal(trustedClientIp({ headers: { "cf-connecting-ip": "not-an-ip", "x-vercel-forwarded-for": "198.51.100.4" } }), "");
  assert.equal(trustedClientIp({ headers: { "cf-connecting-ip": "203.0.113.8, 198.51.100.4" } }), "");
});

test("legacy developer key handlers use validated Cloudflare IP and no Vercel forwarding header", async () => {
  const api = await readFile(new URL("../lib/developer-api.ts", import.meta.url), "utf8");
  const account = await readFile(new URL("../lib/developer-account.ts", import.meta.url), "utf8");
  for (const source of [api, account]) {
    assert.match(source, /cf-connecting-ip/);
    assert.match(source, /isIP\(/);
    assert.doesNotMatch(source, /x-vercel-forwarded-for/i);
  }
});
