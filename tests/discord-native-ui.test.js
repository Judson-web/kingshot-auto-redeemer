import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const interactions = await readFile(new URL("../lib/discord-interactions.js", import.meta.url), "utf8");
const route = await readFile(new URL("../api/discord-tools/[...path].js", import.meta.url), "utf8");
const pool = await readFile(new URL("../lib/mightpulse-key-pool.js", import.meta.url), "utf8");
const commands = await readFile(new URL("../scripts/sync-discord-commands.mjs", import.meta.url), "utf8");

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
    "label: \"Register\"", "Open dashboard", "ks:refresh:", "ks:register:"
  ]) assert.ok(interactions.includes(expected), "missing native UI feature: " + expected);
  assert.ok(interactions.includes("async function handleComponent"));
  assert.ok(interactions.includes("interaction.type === 3"));
  assert.ok(interactions.includes("editSourceMessage(interaction"));
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

test("alliance explorer exposes search, roster selection, pagination, and back navigation", () => {
  for (const expected of [
    'name: "alliance"', 'mode: "search"', "allianceSearchComponents",
    "rosterComponents", "rosterEmbed", "ks:alliance:", "ks:member:",
    "ks:page:", "ks:back:", "ks:alliances:", "Back to roster",
    "Back to alliances", "Previous", "Next", "fetchAllianceApi"
  ]) {
    assert.ok((expected === 'name: "alliance"' ? commands : interactions).includes(expected), "missing alliance explorer feature: " + expected);
  }
  assert.ok(interactions.includes("max_values: 1"));
  assert.ok(interactions.includes("slice(start, start + 25)"));
  assert.ok(interactions.includes("interaction.data?.values?.[0]"));
});

test("alliance browsing is read-only and uses the existing alliance lookup API", () => {
  assert.ok(interactions.includes("developer=alliance-lookup"));
  assert.ok(interactions.includes('mode: "search"'));
  assert.ok(interactions.includes('fetchAllianceApi(req, { kingdomId, tag })'));
  assert.ok(interactions.includes("Back to roster"));
  assert.ok(interactions.includes("registerPlayer(req, id, player)"));
});

test("deferred Discord commands update the original loading response and bound player lookup", () => {
  const commandStart = interactions.indexOf("async function handleCommand(req, interaction, res) {");
  const commandEnd = interactions.indexOf("\nasync function handleComponent", commandStart);
  const commandHandler = interactions.slice(commandStart, commandEnd);
  const componentStart = interactions.indexOf('if (action === "register")');
  const componentEnd = interactions.indexOf("\n  }\n  return acknowledge", componentStart) + 4;
  const registerComponent = interactions.slice(componentStart, componentEnd);

  assert.ok(interactions.includes("async function completeDeferred(token, body, label)"));
  assert.ok(interactions.includes('method: "PATCH"'));
  assert.ok(interactions.includes('/messages/@original'));
  assert.ok(commandHandler.includes("completeDeferred(interaction.token"));
  assert.ok(!commandHandler.includes("followup(interaction.token"), "deferred slash commands must edit the original response");
  assert.ok(registerComponent.includes("completeDeferred(interaction.token"));
  assert.ok(!registerComponent.includes("followup(interaction.token"), "deferred registration buttons must edit their ephemeral original response");
  assert.ok(interactions.includes("maxAttempts: 2, totalTimeoutMs: 18_000"));
});

test("Discord alliance lookup uses a bounded quota-safe fast path", async () => {
  const playerApi = await readFile(new URL("../api/kingshot-player.ts", import.meta.url), "utf8");
  assert.ok(interactions.includes('discordFastPath: "1"'));
  assert.ok(playerApi.includes('param("discordFastPath") === "1"'));
  assert.ok(playerApi.includes("fastPath: true, maxAttempts: 2, totalTimeoutMs: 18_000"));
  assert.ok(playerApi.includes("allianceRequestOptions"));
});


test("Discord command sync uses safe per-command upserts and verifies read-back", async () => {
  const workflow = await readFile(new URL("../.github/workflows/sync-discord-commands.yml", import.meta.url), "utf8");

  assert.ok(commands.includes('request("POST", "", command)'), "each expected command must be upserted individually");
  assert.ok(commands.includes('request("GET")'), "registered commands must be fetched back");
  assert.ok(commands.includes("commandMatches(actual, expected)"), "command options must be verified");
  assert.ok(commands.includes("unrelatedCommandsPreserved: true"));
  assert.ok(!commands.includes('request("PUT"'), "bulk overwrite must not delete unrelated application commands");
  assert.ok(commands.includes('"alliance"'));
  assert.ok(workflow.includes('default: "1494360495694549134"'));
  assert.ok(workflow.includes("push:"), "command changes must trigger an automatic sync");
  assert.ok(workflow.includes("Register and verify /player, /alliance, and /register"));
});


test("Discord deferred commands and components stay alive with Vercel waitUntil", () => {
  assert.ok(interactions.includes('import { waitUntil } from "@vercel/functions";'));
  assert.ok(interactions.includes("function retainAfterAcknowledgement(promise, interaction, label)"));
  assert.ok(interactions.includes("waitUntil(task)"));

  const handlerStart = interactions.indexOf("export default async function handler(req, res)");
  const handler = interactions.slice(handlerStart);
  assert.ok(handler.includes("const commandTask = handleCommand(req, interaction, res)"));
  assert.ok(handler.includes("retainAfterAcknowledgement(commandTask, interaction, \"slash-command\")"));
  assert.ok(handler.includes("const componentTask = handleComponent(req, interaction, res)"));
  assert.ok(handler.includes("retainAfterAcknowledgement(componentTask, interaction, \"message-component\")"));
  assert.ok(handler.includes("if (res.headersSent)"));
});
