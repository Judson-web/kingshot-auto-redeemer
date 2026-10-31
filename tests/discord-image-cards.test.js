import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const interactions = await readFile(new URL("../lib/discord-interactions.js", import.meta.url), "utf8");
const renderer = await readFile(new URL("../lib/discord-player-card-png.js", import.meta.url), "utf8");
const endpoint = await readFile(new URL("../lib/discord-player-card.js", import.meta.url), "utf8");
const router = await readFile(new URL("../api/discord-tools/[...path].js", import.meta.url), "utf8");

test("player and registration commands defer through the HTTP interaction response before slow work", () => {
  assert.match(interactions, /async function handleCommand\(req, interaction, res\)/);
  assert.match(interactions, /res\.status\(200\)\.json\(\{ type: 5, data: \{\} \}\);[\s\S]*?const player = await fetchPlayer\(id\)/);
  assert.match(interactions, /res\.status\(200\)\.json\(\{ type: 5, data: \{\} \}\);[\s\S]*?let player = null/);
  assert.match(interactions, /if \(res\.headersSent\) return;/);
});

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
  assert.match(renderer, /KINGSHOT  •  PLAYER INTELLIGENCE/);
  assert.ok(endpoint.includes('res.setHeader("Content-Type", "image/png")'));
});

test("player card endpoint validates IDs and serves PNG bytes only", () => {
  assert.match(endpoint, /req\.method !== "GET"/);
  assert.match(endpoint, /encoded, 6000/);
  assert.match(endpoint, /\\d\{5,20\}/);
  assert.match(endpoint, /renderPlayerCardPng\(card\)/);
  assert.match(router, /endpoint === "player-card"\) return playerCard/);
});

test("player avatar URLs are restricted to trusted HTTPS hosts", () => {
  assert.match(interactions, /parsed\.protocol !== "https:"/);
  assert.match(interactions, /got-global-avatar\.akamaized\.net/);
  assert.match(interactions, /got-global-avatar\.chosenonegames\.com/);
});

test("registration result is public and clearly distinguishes existing players", () => {
  assert.match(interactions, /registrationEmbed/);
  assert.match(interactions, /type: 5, data: \{\}/);
  assert.match(interactions, /Already enrolled/);
  assert.match(interactions, /Player registered successfully/);
  assert.match(interactions, /AUTO REDEEM • REGISTRATION CONFIRMED/);
  const register = interactions.slice(interactions.indexOf("if (name === \"register\")"), interactions.indexOf("return { content: \"That command"));
  assert.doesNotMatch(register, /flags: 64/);
});

test("player card offers a verified, paginated alliance roster with player selection", () => {
  assert.match(interactions, /View alliance roster/);
  assert.match(interactions, /type: 3, custom_id: "select\|"/);
  assert.match(interactions, /Back to alliance roster/);
  assert.match(interactions, /fetchAllianceRoster/);
  assert.match(interactions, /members\.some\(member => member\.id === id\)/);
  assert.match(interactions, /Math\.min\(count, 5\)/);
  assert.match(interactions, /interaction\.type !== 2 && interaction\.type !== 3/);
});

test("optional player lookup cannot block registration", () => {
  assert.match(interactions, /try \{ player = await fetchPlayer\(id\); \} catch/);
});
