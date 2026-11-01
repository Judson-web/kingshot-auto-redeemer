import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL("../"+path, import.meta.url), "utf8");

test("player profile discovery is present in the grouped navigation drawer", async () => {
  const drawer = await read("src/components/MobileNavDrawer.jsx");
  const styles = await read("src/drawer-redesign.css");
  assert.match(drawer, /id:"player-profile",href:"\/user"/);
  assert.match(drawer, /nav\.groupRedeem/);
  assert.match(drawer, /nav\.groupKingshot/);
  assert.match(drawer, /nav\.groupResources/);
  assert.match(drawer, /nav\.groupAccount/);
  assert.match(styles, /\.ks-nav-drawer-groups/);
});

test("player profile has a discovery landing page and share actions", async () => {
  const page = await read("src/PlayerProfileApp.jsx");
  assert.match(page, /!playerId&&<section className="kp-discover"/);
  assert.match(page, /Share profile/);
  assert.match(page, /Copy link/);
  assert.match(page, /KingdomContext kingdom=\{kingdom\}/);
  assert.match(page, /AllianceRoster data=\{data\.alliance_roster\}/);
});

test("profile metadata and share cards use the existing OG handler", async () => {
  const og = await read("api/og.js");
  const config = JSON.parse(await read("vercel.json"));
  assert.ok(config.rewrites.some(route => route.source === "/user" && route.destination === "/index.html"));
  assert.ok(config.rewrites.some(route => route.source === "/user/:playerId" && route.destination.includes("/api/og?route=player-page")));
  assert.match(og, /route==="player-page"/);
  assert.match(og, /og:title/);
  assert.match(og, /twitter:card/);
  assert.match(og, /handlePlayerImage/);
  assert.match(og, /fetchMightPulse/);
});

test("profile supplements player details with public kingdom and alliance context", async () => {
  const api = await read("api/kingshot-player.ts");
  const helper = api.slice(api.indexOf("async function loadPlayerContext"), api.indexOf("const detailedProfileCache"));
  assert.match(helper, /\/v1\/kingdoms\//);
  assert.match(helper, /include=boards&limit=100/);
  assert.match(helper, /kingdom_board_ranks/);
  assert.match(helper, /\/v1\/alliances\//);
  assert.match(helper, /include=info,roster/);
  assert.match(helper, /player_power_rank/);
  assert.doesNotMatch(helper, /last_active_at|online/);
  assert.match(helper, /Promise\.allSettled/);
});
