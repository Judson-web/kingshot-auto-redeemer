import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const interactions = await readFile(new URL("../lib/discord-interactions.js", import.meta.url), "utf8");
const route = await readFile(new URL("../api/discord-tools/[...path].js", import.meta.url), "utf8");
const pool = await readFile(new URL("../lib/mightpulse-key-pool.js", import.meta.url), "utf8");

test("player and registration commands defer before slow work", () => {
  assert.ok(interactions.includes("async function handleCommand(req, interaction, res)"));
  assert.ok(interactions.includes("acknowledge(res, { type: 5, data: {} })"));
  assert.ok(interactions.includes("const player = await fetchPlayer(id)"));
  assert.ok(interactions.includes("let player = null"));
});

test("Discord player lookups keep the quota-reserved fast path and cache", () => {
  assert.ok(interactions.includes("PLAYER_CACHE_TTL_MS = 45_000"));
  assert.ok(interactions.includes("playerInFlight.has(id)"));
  assert.ok(interactions.includes("timeoutMs: 8000, fastPath: true"));
  assert.ok(pool.includes("claim_mightpulse_api_key_request"));
});

test("player profiles use native Discord embeds and interactive components", () => {
  for (const expected of [
    "playerProfileEmbed", "playerComponents", "Refresh profile",
    "Register for auto-redeem", "Open dashboard", "ks:refresh:", "ks:register:"
  ]) assert.ok(interactions.includes(expected), "missing native UI feature: " + expected);
  assert.ok(interactions.includes("async function handleComponent"));
  assert.ok(interactions.includes("interaction.type === 3"));
  assert.ok(interactions.includes("editOriginal(interaction.token"));
  assert.ok(!interactions.includes("playerImageUrl"));
  assert.ok(!interactions.includes("image: { url:"));
});

test("PNG player-card endpoint and renderer are retired", () => {
  assert.ok(!route.includes("player-card"));
  assert.ok(!route.includes("discord-player-card"));
});

test("registration responses are private and preserve the authoritative backend", () => {
  assert.ok(interactions.includes("data: { flags: 64 }"));
  assert.ok(interactions.includes("flags: 64"));
  assert.ok(interactions.includes("Already enrolled"));
  assert.ok(interactions.includes("Player registered successfully"));
  assert.ok(interactions.includes("/api/kingshot-register"));
});
