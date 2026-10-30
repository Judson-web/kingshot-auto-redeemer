import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const interactions = await readFile(new URL("../lib/discord-interactions.js", import.meta.url), "utf8");
const renderer = await readFile(new URL("../lib/discord-player-card-png.js", import.meta.url), "utf8");
const endpoint = await readFile(new URL("../lib/discord-player-card.js", import.meta.url), "utf8");
const router = await readFile(new URL("../api/discord-tools/[...path].js", import.meta.url), "utf8");

test("player command sends a generated PNG image card instead of a native field embed", () => {
  assert.match(interactions, /image: \{ url: playerCardUrl\(data\) \}/);
  assert.match(interactions, /\/api\/discord-player-card\?data=/);
  assert.match(interactions, /embeds: \[playerProfileEmbed\(data\)\]/);
  assert.doesNotMatch(interactions, /fields,\s*footer: \{ text: "MightPulse/);
});

test("player card renderer matches the landscape Oracle-style layout", () => {
  assert.match(renderer, /const WIDTH = 900/);
  assert.match(renderer, /const HEIGHT = 342/);
  for (const label of ["POWER", "KILLS", "TOWN CENTER", "VIP", "ALLIANCE RANK"]) {
    assert.ok(renderer.includes('["' + label + '"'), "missing stat " + label);
  }
  assert.match(endpoint, /Content-Type", "image\\/png"/);
  assert.match(renderer, /KINGSHOT ORACLE-STYLE PLAYER PROFILE/);
});

test("player card endpoint validates IDs and serves PNG bytes only", () => {
  assert.match(endpoint, /req\.method !== "GET"/);
  assert.match(endpoint, /encoded, 6000/);
  assert.match(endpoint, /\\d\{5,20\}/);
  assert.match(endpoint, /Content-Type", "image\/png"/);
  assert.match(endpoint, /renderPlayerCardPng\(card\)/);
  assert.match(router, /endpoint === "player-card"\) return playerCard/);
});

test("player avatar URLs are restricted to trusted HTTPS hosts", () => {
  assert.match(interactions, /parsed\.protocol !== "https:"/);
  assert.match(interactions, /got-global-avatar\.akamaized\.net/);
  assert.match(interactions, /got-global-avatar\.chosenonegames\.com/);
});

test("registration remains private and uses a compact structured confirmation", () => {
  assert.match(interactions, /embeds: \[registrationEmbed\(data\)\]/);
  assert.match(interactions, /flags: 64/);
  assert.match(interactions, /result\.alreadyRegistered \? "ALREADY REGISTERED"/);
});

test("optional player lookup cannot block registration", () => {
  assert.match(interactions, /try \{ player = await fetchPlayer\(id\); \} catch/);
});
