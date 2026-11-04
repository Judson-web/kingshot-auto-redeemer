import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("admin player workspace exposes one combined restriction and restore control", async () => {
  const ui = await read("../src/AdminPlayersApp.tsx");
  assert.match(ui, /const restricted=Boolean\(banned\)\|\|current\?\.enabled===false/);
  assert.match(ui, /action\(restricted\?"UNBAN_PLAYER":"BAN_PLAYER"/);
  assert.doesNotMatch(ui, /SET_PLAYER_ENABLED/);
  assert.match(ui, /\{restricted\?"Restore player":"Restrict player"\}/);
  assert.match(ui, /\["Status",restricted\?"Restricted":"Enabled"\]/);
});

test("restriction and restore remain server-enforced and fail safely", async () => {
  const api = await read("../lib/admin-data.js");
  const worker = await read("../api/kingshot-auto.js");
  const banStart = api.indexOf('if(action==="BAN_PLAYER")');
  const unbanStart = api.indexOf('if(action==="UNBAN_PLAYER")');
  assert.ok(banStart >= 0 && unbanStart > banStart);
  const ban = api.slice(banStart, unbanStart);
  assert.ok(ban.indexOf('kingshot_player_bans?on_conflict=player_id') < ban.indexOf('p_enabled:false'));
  const unban = api.slice(unbanStart, api.indexOf('if(action==="ADMIN_PUSH_STATUS"', unbanStart));
  assert.ok(unban.indexOf('p_enabled:true') < unban.indexOf('method:"DELETE"'));
  assert.match(unban, /p_enabled:false/);
  assert.match(worker, /assignedPlayers\.filter\(player=>player\?\.enabled!==false\)/);
  assert.match(worker, /kingshot_player_bans\?select=player_id/);
});
