import test from "node:test";
import assert from "node:assert/strict";
import { extractPageCodes, extractPublicSourceCodes, mergeCodes, isCredibleGiftCodeCandidate } from "../internal/kingshot/gift-codes.ts";

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

test("official page parser ignores arbitrary markup tokens and only reads active entries", () => {
  const html = `
    <script>const fake = "FAKECODE99";</script>
    <div data-code="FAKECODE99">metadata</div>
    <a href="/gift-codes/redeem?code=FAKECODE99">Redeem</a>
    <h2>Active Gift Codes</h2>
    <p>Active</p><p>WELLDONE</p><p>Expires: 12/31/2099</p>
    <h2>Expired Gift Codes</h2>
    <p>Active</p><p>OLDGIFT99</p>
  `;
  assert.deepEqual(extractPageCodes(html).map(row => row.code), ["WELLDONE"]);
});

test("known webpage words are never accepted as gift codes", () => {
  for (const word of ["height", "Guides", "Mastery", "className", "buttons", "clipboard"]) {
    assert.equal(extractPublicSourceCodes(`<h2>Active Gift Codes</h2><p>${word}</p>`, "fixture").length, 0);
  }
});


test("Kingshot.net API and page endpoints count as one low-confidence source", () => {
  const api = { code: "lwaL5ZKx5", expiresAt: null, createdAt: Date.now(), source: "kingshot-net-api" };
  const page = { code: "lwaL5ZKx5", expiresAt: null, createdAt: Date.now(), source: "kingshot-net-page" };
  const [candidate] = mergeCodes([[api], [page]]);
  assert.equal(candidate.confidence, 0.35);
  assert.equal(candidate.confidenceTier, "low");
  assert.equal(isCredibleGiftCodeCandidate(candidate), false);
});

test("an uncorroborated Kingshot.net candidate is not eligible for announcement or player canary", () => {
  const [candidate] = mergeCodes([[
    { code: "lwaL5ZKx5", expiresAt: null, createdAt: Date.now(), source: "kingshot-net-api" }
  ]]);
  assert.equal(isCredibleGiftCodeCandidate(candidate), false);
});

test("one independently reputable active-code source remains eligible", () => {
  const [candidate] = mergeCodes([[
    { code: "AKeYD8gK8", expiresAt: null, createdAt: Date.now(), source: "beebom" }
  ]]);
  assert.equal(candidate.confidence, 0.65);
  assert.equal(candidate.confidenceTier, "medium");
  assert.equal(isCredibleGiftCodeCandidate(candidate), true);
});

test("duplicate records from one source do not artificially increase confidence", () => {
  const [candidate] = mergeCodes([[
    { code: "AKeYD8gK8", expiresAt: null, createdAt: Date.now(), source: "beebom" },
    { code: "AKeYD8gK8", expiresAt: null, createdAt: Date.now(), source: "beebom" }
  ]]);
  assert.equal(candidate.confidence, 0.65);
});

test("two independent reputable sources increase confidence", () => {
  const [candidate] = mergeCodes([
    [{ code: "AKeYD8gK8", expiresAt: null, createdAt: Date.now(), source: "beebom" }],
    [{ code: "AKeYD8gK8", expiresAt: null, createdAt: Date.now(), source: "pocketgamer" }]
  ]);
  assert.equal(candidate.confidence, 0.88);
  assert.equal(candidate.confidenceTier, "high");
  assert.equal(isCredibleGiftCodeCandidate(candidate), true);
});
