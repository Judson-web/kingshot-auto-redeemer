import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { rateLimit } from "../lib/request-rate-limit.js";

test("in-process rate limits key off Cloudflare IP, not client-controlled forwarding headers", () => {
  const response = () => ({ headers: {}, setHeader(name, value) { this.headers[name] = value; } });
  const scope = "cloudflare-ip-regression-" + randomUUID();
  const first = response();
  const second = response();
  assert.equal(rateLimit({ headers: { "cf-connecting-ip": "203.0.113.19", "x-real-ip": "198.51.100.1" } }, first, scope, 1, 60000), true);
  assert.equal(rateLimit({ headers: { "cf-connecting-ip": "203.0.113.19", "x-real-ip": "198.51.100.2" } }, second, scope, 1, 60000), false);
  assert.equal(second.headers["Retry-After"] !== undefined, true);
});
