import assert from "node:assert/strict";
import test from "node:test";
import { rateLimit } from "../lib/request-rate-limit.js";

function response() {
  const headers = new Map();
  return { headers, setHeader(name, value) { headers.set(name, value); } };
}

test("same valid x-real-ip shares a bucket despite spoofed X-Forwarded-For", () => {
  const scope = "limiter-test-" + Math.random().toString(36).slice(2);
  const first = response(), second = response();
  const a = { headers: { "x-real-ip": "203.0.113.40", "x-forwarded-for": "198.51.100.1" } };
  const b = { headers: { "x-real-ip": "203.0.113.40", "x-forwarded-for": "198.51.100.2" } };
  assert.equal(rateLimit(a, first, scope, 1, 60000), true);
  assert.equal(rateLimit(b, second, scope, 1, 60000), false);
  assert.equal(second.headers.get("Retry-After") !== undefined, true);
});

test("invalid IP headers use the unknown bucket instead of attacker-controlled names", () => {
  const scope = "limiter-invalid-test-" + Math.random().toString(36).slice(2);
  assert.equal(rateLimit({ headers: { "x-real-ip": "bad", "x-forwarded-for": "attacker-controlled" } }, response(), scope, 1, 60000), true);
});
