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
  for (const envName of ["MIGHTPULSE_API_KEY_6", "MIGHTPULSE_API_KEY_5", "MIGHTPULSE_API_KEY_4", "MIGHTPULSE_API_KEY_3", "MIGHTPULSE_API_KEY_2", "MIGHTPULSE_API_KEY"]) {
    assert.ok(source.includes("process.env." + envName), "Missing key source " + envName);
  }
  assert.match(source, /seen\.has\(value\)/);
  assert.doesNotMatch(source, /KSS_API_KEY/, "Retired KSS credentials must not be loaded");
  assert.match(source, /claim_mightpulse_api_key_request/);
  assert.match(source, /record_mightpulse_api_key_usage/);
  assert.match(source, /checkProviderCircuitBreaker/);
  assert.match(source, /recordProviderBlockSweep/);
  assert.match(source, /resetProviderCircuitBreaker/);
  assert.match(source, /providerBlockedKeys\.size === candidates\.length/);
  assert.match(source, /status === 429/);
  assert.match(source, /status === 401 \|\| response\.status === 403/);
  assert.doesNotMatch(source, /console\.(log|warn|error).*key\.value/);
});

test("MightPulse provider circuit breaker uses RLS-protected state and service-role-only RPCs", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20261026120000_mightpulse_provider_circuit_breaker.sql", import.meta.url), "utf8");
  assert.match(migration, /private\.mightpulse_provider_circuit_breaker/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table private\.mightpulse_provider_circuit_breaker from public, anon, authenticated, service_role/i);
  assert.match(migration, /v_failure_count >= 3/i);
  assert.match(migration, /interval '60 seconds'/i);
  assert.match(migration, /interval '120 seconds'/i);
  for (const rpc of ["check_mightpulse_provider_circuit_breaker", "record_mightpulse_provider_block_sweep", "reset_mightpulse_provider_circuit_breaker"]) {
    assert.ok(migration.includes("grant execute on function public." + rpc + "() to service_role;"), "RPC must grant service_role: " + rpc);
    assert.ok(!migration.includes("grant execute on function public." + rpc + "() to anon;"), "RPC must not grant anon: " + rpc);
  }
});
