import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

function response() {
  const headers = new Map();
  return {
    statusCode: 200, body: undefined, headers,
    setHeader(name, value) { headers.set(name, value); },
    getHeader(name) { return headers.get(name); },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; }
  };
}

const req = (path, method="GET", body={}) => ({
  method,
  query: { path: Array.isArray(path) ? path : [path] },
  headers: {},
  body
});

test("admin router rejects unauthenticated data access", async () => {
  const {default:router}=await import("../api/admin-tools/[...path].js");
  const res=response();
  await router(req("data"),res);
  assert.equal(res.statusCode,401);
  assert.equal(res.body?.error,"Discord administrator sign-in required.");
});

test("custom message endpoint rejects unauthenticated destination access", async () => {
  const {default:handler}=await import("../api/custom-message.js");
  const res=response();
  await handler(req("", "POST", {action:"DESTINATIONS"}),res);
  assert.equal(res.statusCode,401);
  assert.equal(res.body?.error,"Unauthorized.");
});

test("custom message endpoint rejects unauthenticated sends", async () => {
  const {default:handler}=await import("../api/custom-message.js");
  const res=response();
  await handler(req("", "POST", {action:"SEND",target:"test",message:"hello"}),res);
  assert.equal(res.statusCode,401);
  assert.equal(res.body?.error,"Unauthorized.");
});

test("worker enforces bans before redemption and fails closed when ban lookup fails", async () => {
  const source = await readFile(new URL("../api/kingshot-auto.js", import.meta.url), "utf8");
  assert.match(source, /kingshot_player_bans\?select=player_id/);
  assert.match(source, /Unable to verify player bans before redemption/);
  assert.match(source, /const eligiblePlayers=assignedPlayers\.filter\(player=>!bannedIds\.has/);
  assert.match(source, /runWorkerShard\(slot,codes,eligiblePlayers/);
  assert.match(source, /bannedPlayersSkipped/);
});


test("admin stylesheet is included in the entry bundle and blocked registrations use a dedicated response card", async () => {
  const entry = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  const adminCss = await readFile(new URL("../src/admin-players.css", import.meta.url), "utf8");
  const app = entry;
  const siteCss = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(entry, /import["']\.\/admin-players\.css["'];/);
  assert.match(adminCss, /main\.admin-players-page/);
  assert.match(app, /ks-registration-results-blocked/);
  assert.match(siteCss, /\.ks-registration-results/);
  assert.match(app, /Boolean\(err\.banned\)/);
});
