import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const callerPaths = [
  "../internal/kingshot/mightpulse.ts",
  "../internal/kingshot/kingdom-validation.ts",
  "../lib/discord-interactions.js",
  "../api/kingshot-player.ts",
];

test("MightPulse reads use the shared quota-aware multi-key pool", async () => {
  for (const path of callerPaths) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /fetchMightPulse/, path + " must use shared key-pool routing");
    assert.doesNotMatch(source, /process\.env\.MIGHTPULSE_API_KEY_3\s*\|\|\s*process\.env\.MIGHTPULSE_API_KEY_2/, path + " must not hard-code a single preferred key");
  }
});

test("key pool defines all supported keys, deduplicates repeated secrets, and never logs secret values", async () => {
  const source = await readFile(new URL("../lib/mightpulse-key-pool.js", import.meta.url), "utf8");
  for (const envName of ["MIGHTPULSE_API_KEY_3", "MIGHTPULSE_API_KEY_2", "MIGHTPULSE_API_KEY", "KSS_API_KEY"]) {
    assert.ok(source.includes("process.env." + envName), "Missing key source " + envName);
  }
  assert.match(source, /seen\.has\(value\)/);
  assert.match(source, /process\.env\["KSS_API_KEY_" \+ suffix\]/, "Numbered KSS key slots must be supported");
  assert.match(source, /claim_mightpulse_api_key_request/);
  assert.match(source, /record_mightpulse_api_key_usage/);
  assert.match(source, /status === 429/);
  assert.match(source, /status === 401 \|\| response\.status === 403/);
  assert.doesNotMatch(source, /console\.(log|warn|error).*key\.value/);
});
