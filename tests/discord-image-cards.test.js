import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { playerImageUrl } from "../lib/discord-player-image-url.js";

const interactions = await readFile(new URL("../lib/discord-interactions.js", import.meta.url), "utf8");
const pool = await readFile(new URL("../lib/mightpulse-key-pool.js", import.meta.url), "utf8");

test("player and registration commands defer before slow work", () => {
  assert.match(interactions, /async function handleCommand\\(req, interaction, res\\)/);
  assert.match(interactions, /res\\.status\\(200\\)\\.json\\(\\{ type: 5, data: \\{\\} \\}\\);[\\s\\S]*?const player = await fetchPlayer\\(id\\)/);
  assert.match(interactions, /res\\.status\\(200\\)\\.json\\(\\{ type: 5, data: \\{\\} \\}\\);[\\s\\S]*?let player = null/);
});

test("Discord player lookups keep the quota-reserved fast path and cache", () => {
  assert.match(interactions, /PLAYER_CACHE_TTL_MS = 45_000/);
  assert.match(interactions, /playerInFlight\\.has\\(id\\)/);
  assert.match(interactions, /timeoutMs: 8000, fastPath: true/);
  assert.match(pool, /claim_mightpulse_api_key_request/);
});

test("player card uses a hosted external PNG URL and sends no roster controls", () => {
  assert.match(interactions, /image: \\{ url: playerImageUrl\\(data\\) \\}/);
  assert.doesNotMatch(interactions, /View alliance roster|fetchAllianceRoster|rosterComponents|handleComponent/);
  assert.match(interactions, /interaction\\.type !== 2/);
});

test("external image URL carries only compact display fields", () => {
  const url = new URL(playerImageUrl({
    governor: "Test Governor", kingdom: "1125", alliance: "ONE", power: "1.2B",
    townCenter: "30", vip: "12", kills: "45M", coordinates: "716 / 458",
    avatar: "https://cdn.mightpulse.com/avatar.png", playerId: "123456789"
  }));
  assert.equal(url.origin, "https://ogimagen.com");
  assert.equal(url.pathname, "/api/template/preview");
  assert.equal(url.searchParams.get("template"), "profile");
  assert.equal(url.searchParams.get("title"), "Test Governor");
  assert.equal(url.searchParams.get("subtitle"), "KINGDOM 1125  •  ONE");
  assert.equal(url.searchParams.get("authorName"), "POWER 1.2B");
  assert.equal(url.searchParams.get("avatarUrl"), "https://cdn.mightpulse.com/avatar.png");
  assert.equal(url.searchParams.has("playerId"), false);
});

test("registration result remains public and optional lookup cannot block registration", () => {
  assert.match(interactions, /registrationEmbed/);
  assert.match(interactions, /Already enrolled/);
  assert.match(interactions, /Player registered successfully/);
  assert.match(interactions, /try \\{ player = await fetchPlayer\\(id\\); \\} catch/);
});
