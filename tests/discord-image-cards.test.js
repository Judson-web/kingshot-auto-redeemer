import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const interactions = await readFile(new URL("../lib/discord-interactions.js", import.meta.url), "utf8");

test("player command returns one structured Oracle-style profile embed", () => {
  assert.match(interactions, /embeds: \[playerProfileEmbed\(data\)\]/);
  assert.match(interactions, /field\("⚡ POWER", data\.power\)/);
  assert.match(interactions, /field\("⚔️ KILLS", data\.kills\)/);
  assert.match(interactions, /field\("🏰 TOWN CENTER", data\.townCenter\)/);
  assert.match(interactions, /field\("💎 VIP", data\.vip\)/);
  assert.match(interactions, /field\("🏅 ALLIANCE RANK", data\.rank\)/);
  assert.match(interactions, /field\("📍 COORDINATES", data\.coordinates\)/);
  assert.match(interactions, /field\("🟢 STATUS", data\.online\)/);
  assert.match(interactions, /thumbnail: safeAvatar\(data\.avatar\)/);
  assert.doesNotMatch(interactions, /imageCardEmbed\(cardUrl\("player"/);
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
