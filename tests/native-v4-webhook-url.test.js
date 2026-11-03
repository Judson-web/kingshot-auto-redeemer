import test from "node:test";
import assert from "node:assert/strict";
import { validDeliveryUrl } from "../cloudflare/webhook-url.ts";

test("webhook URL validation accepts public HTTPS hostnames", () => {
  assert.equal(validDeliveryUrl("https://hooks.example.com/events")?.hostname, "hooks.example.com");
  assert.equal(validDeliveryUrl("https://hooks.example.co.uk:443/events")?.protocol, "https:");
});

test("webhook URL validation rejects non-HTTPS, credentials and nonstandard ports", () => {
  for (const value of [
    "http://hooks.example.com",
    "https://user:pass@hooks.example.com",
    "https://hooks.example.com:8443",
    "ftp://hooks.example.com",
  ]) assert.equal(validDeliveryUrl(value), null, value);
});

test("webhook URL validation rejects canonical and obfuscated IP literals", () => {
  for (const value of [
    "https://127.0.0.1",
    "https://127.1",
    "https://2130706433",
    "https://0x7f000001",
    "https://0177.0.0.1",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
  ]) assert.equal(validDeliveryUrl(value), null, value);
});

test("webhook URL validation rejects local, reserved and single-label hostnames", () => {
  for (const value of [
    "https://localhost",
    "https://api.localhost",
    "https://printer.local",
    "https://metadata.google.internal",
    "https://service.home.arpa",
    "https://api.test",
    "https://api.invalid",
    "https://api.example",
    "https://hidden.onion",
    "https://service.lan",
    "https://singlelabel",
  ]) assert.equal(validDeliveryUrl(value), null, value);
});

test("webhook URL validation rejects malformed and oversized URLs", () => {
  assert.equal(validDeliveryUrl("https://bad..example.com"), null);
  assert.equal(validDeliveryUrl("https://" + "a".repeat(2050) + ".com"), null);
});
