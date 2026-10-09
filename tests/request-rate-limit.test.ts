import test from "node:test";
import assert from "node:assert/strict";
import { rateLimit } from "../lib/request-rate-limit.ts";

function response() {
  const headers = new Map();
  return { headers, setHeader(name, value) { headers.set(name, value); } };
}
function request(ip = "192.0.2.10") {
  return { headers: { "x-forwarded-for": ip, "x-real-ip": "198.51.100.7" } };
}
function reset() { globalThis.__ksRateLimitBuckets = new Map(); }

test("allows requests within limit and rejects the next request", () => {
  reset();
  const req = request(), first = response(), second = response(), third = response();
  assert.equal(rateLimit(req, first, "limit-test", 2, 60000), true);
  assert.equal(first.headers.get("X-RateLimit-Remaining"), "1");
  assert.equal(rateLimit(req, second, "limit-test", 2, 60000), true);
  assert.equal(second.headers.get("X-RateLimit-Remaining"), "0");
  assert.equal(rateLimit(req, third, "limit-test", 2, 60000), false);
  assert.equal(third.headers.get("Cache-Control"), "no-store");
  assert.ok(Number(third.headers.get("Retry-After")) >= 1);
});

test("isolates rate limits by scope and client IP", () => {
  reset();
  assert.equal(rateLimit(request("192.0.2.10"), response(), "login", 1), true);
  assert.equal(rateLimit(request("192.0.2.10"), response(), "send", 1), true);
  assert.equal(rateLimit(request("192.0.2.11"), response(), "login", 1), true);
  assert.equal(rateLimit(request("192.0.2.10"), response(), "login", 1), false);
});

test("uses the first forwarded address as the client key", () => {
  reset();
  assert.equal(rateLimit(request("203.0.113.1, 203.0.113.2"), response(), "ip-test", 1), true);
  assert.equal(rateLimit(request("203.0.113.2"), response(), "ip-test", 1), true);
});

test("bounds limiter memory and fails closed for new keys at capacity", () => {
  reset();
  const buckets = new Map();
  const resetAt = Date.now() + 60000;
  for (let i = 0; i < 5000; i++) buckets.set("occupied:" + i, { count: 1, resetAt });
  globalThis.__ksRateLimitBuckets = buckets;
  const res = response();
  assert.equal(rateLimit(request("198.51.100.200"), res, "capacity-test", 20, 60000), false);
  assert.equal(buckets.size, 5000);
  assert.equal(res.headers.get("X-RateLimit-Remaining"), "0");
  assert.ok(Number(res.headers.get("Retry-After")) >= 1);
});
