import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const interactions = await readFile(new URL("../lib/discord-interactions.js", import.meta.url), "utf8");
const renderer = await readFile(new URL("../api/discord-tools/[...path].js", import.meta.url), "utf8");

test("player command returns a generated image card with the live profile fields", () => {
  for (const field of ["governor", "kingdom", "power", "townCenter", "vip", "alliance", "rank", "kills", "coordinates", "online"]) {
    assert.match(interactions, new RegExp(field));
  }
  assert.match(interactions, /imageCardEmbed\(cardUrl\("player"/);
  assert.match(renderer, /function renderPlayerCard\(d\)/);
});

test("registration command returns a compact private image card", () => {
  assert.match(interactions, /imageCardEmbed\(cardUrl\("registration"/);
  assert.match(interactions, /flags: 64/);
  assert.match(renderer, /function renderRegistrationCard\(d\)/);
  assert.match(renderer, /REGISTRATION SUCCESSFUL/);
});

test("optional player lookup cannot block registration and duplicate state is represented", () => {
  assert.match(interactions, /try \{ player = await fetchPlayer\(id\); \} catch/);
  assert.match(interactions, /result\.alreadyRegistered \? "ALREADY REGISTERED"/);
});

test("card renderer validates request method, kind, payload size, and player ID", () => {
  assert.match(renderer, /req\.method!=="GET"/);
  assert.match(renderer, /encoded.length>7000/);
  assert.match(renderer, /\["player","registration"\]\.includes\(kind\)/);
  assert.match(renderer, /\\d\{5,20\}/);
  assert.match(renderer, /replace\(\/\[\&<>"'\]/);
});