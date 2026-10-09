import test from "node:test";
import assert from "node:assert/strict";
import { extractPublicSourceCodes } from "../internal/kingshot/gift-codes.ts";

test("does not infer gift codes from generic copy/redeem page text", () => {
  const html = `
    <main>
      <p>New rewards are available. Copy the FREEGIFT rewards text below.</p>
      <button>Redeem BONUSREWARD now</button>
      <p>Redeem the latest rewards and continue playing.</p>
    </main>
  `;
  assert.deepEqual(extractPublicSourceCodes(html, "fixture"), []);
});

test("extracts a code from an explicit active gift-code section", () => {
  const html = `
    <h2>Active Gift Codes</h2>
    <p>Hangul2026</p>
    <p>Expires: 31 December 2026</p>
    <h2>Expired Gift Codes</h2>
    <p>OLDGIFT2025</p>
  `;
  assert.deepEqual(
    extractPublicSourceCodes(html, "fixture").map(row => row.code),
    ["Hangul2026"]
  );
});

test("ignores fake code-like tokens inside scripts and generic code attributes", () => {
  const html = `
    <script>const height = "height"; const gift_code = "FAKECODE99";</script>
    <div class="height buttons">height</div>
    <div code="FAKECODE99">ordinary component</div>
    <h2>Active Gift Codes</h2>
    <p>Hangul2026</p>
    <h2>Expired Gift Codes</h2>
  `;
  assert.deepEqual(
    extractPublicSourceCodes(html, "fixture").map(row => row.code),
    ["Hangul2026"]
  );
});
