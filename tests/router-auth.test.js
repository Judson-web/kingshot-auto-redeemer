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
  assert.match(source, /const eligiblePlayers=assignedPlayers\.filter\(player=>.*bannedIds\.has/);\n  assert.match(source, /player\?\.enabled!==false/);
  assert.match(source, /runWorkerShard\(slot,codes,eligiblePlayers/);
  assert.match(source, /bannedPlayersSkipped/);
});


test("admin stylesheet is loaded and registration responses share one swipeable result panel", async () => {
  const entry = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  const adminCss = await readFile(new URL("../src/admin-players.css", import.meta.url), "utf8");
  const outcomeSource = await readFile(new URL("../src/registration-outcomes.js", import.meta.url), "utf8");
  const siteCss = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(entry, /import["\']\.\/admin-players\.css["\'];/);
  assert.match(adminCss, /main\.admin-players-page/);
  assert.match(entry, /RegistrationOutcomePanel/);
  assert.match(entry, /registration-outcomes\.js/);
  assert.match(siteCss, /\.ks-outcome-panel/);
  assert.match(siteCss, /\.ks-outcome-track/);
  assert.match(outcomeSource, /makeSuccessOutcome/);
  assert.match(outcomeSource, /makeFailureOutcome/);
});


test("home page registration outcome component is defined before React mounts the app", async () => {
  const entry = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  assert.ok(entry.includes("<RegistrationOutcomePanel outcomes={outcomes}/>"));
  assert.match(entry, /function RegistrationOutcomePanel\(\{outcomes\}\)/);
  assert.ok(entry.indexOf("function RegistrationOutcomePanel") < entry.indexOf("createRoot(document.getElementById"));
});


test("push console reuses the existing account session instead of offering passkey login", async () => {
  const ui = await readFile(new URL("../src/PushConsoleApp.tsx", import.meta.url), "utf8");
  const endpoint = await readFile(new URL("../api/custom-message.js", import.meta.url), "utf8");
  const legacy = await readFile(new URL("../lib/developer-login.js", import.meta.url), "utf8");
  assert.doesNotMatch(ui, /ACCESS PASSKEY|Enter your passkey|Unlock console|setPasskey|showPass/);
  assert.match(ui, /action: "CHECK"/);
  assert.match(ui, /href="\/developer\?next=%2Fpush"/);
  assert.match(endpoint, /__Host-ks_developer_session/);
  assert.match(endpoint, /kingshot_developer_account_session_get/);
  assert.match(endpoint, /discordId===OWNER_DISCORD_ID/);
  assert.match(legacy, /Legacy developer passkey authentication has been retired/);
  assert.doesNotMatch(legacy, /kingshot_developer_create_session_with_key|req\.body\?\.accessKey/);
});
