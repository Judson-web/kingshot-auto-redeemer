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

test("registration responses are public and preserve the authoritative backend", () => {
  assert.ok(interactions.includes("acknowledge(res, { type: 5, data: {} });"));
  const buttonStart = interactions.indexOf('if (action === "register")');
  const buttonEnd = interactions.indexOf("\n  }", buttonStart);
  assert.ok(!interactions.slice(buttonStart, buttonEnd).includes("flags: 64"));
  assert.ok(interactions.includes('custom_id: "ks:register-alliance:"'));
  assert.ok(interactions.includes('label: "Register alliance"'));
  assert.ok(interactions.includes("registerAllianceFromDiscord"));
  assert.ok(!interactions.includes('alliance-registration.html?kingdomId='));
  assert.ok(interactions.includes('field("ALLIANCE", data.alliance || "—")'));
  assert.ok(interactions.includes('return details.tag ? "[" + details.tag + "] " + (details.name || "Alliance")'));
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
  assert.ok(interactions.includes("slice(start, start + pageSize)"));
  assert.ok(interactions.includes("const pageSize = 10;"));
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


test("verified gift-code command calls the restricted summary RPC", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20261031180000_discord_verified_gift_codes.sql", import.meta.url), "utf8");
  assert.ok(interactions.includes("discord_list_verified_gift_codes"));
  assert.ok(interactions.includes("recentSuccesses"));
  assert.ok(interactions.includes("giftCodesEmbed"));
  assert.ok(interactions.includes("ks:codes-page:"));
  for (const expected of ["g.active = true", "g.suppressed = false", "g.validation_status = 'verified'", "r.status = 'SUCCESS'", "r.attempted_at >=", "g.expires_at > now()", "grant execute"]) {
    assert.ok(migration.includes(expected), "missing verified gift-code SQL predicate: " + expected);
  }
  assert.ok(commands.includes('name: "codes"'));
});

test("Discord registration command is public on valid registration and cards can show avatars", () => {
  const start = interactions.indexOf('if (name === "register")');
  const end = interactions.indexOf('if (customId.startsWith("ks:"))', start);
  const block = interactions.slice(start, end);
  assert.ok(block.includes("acknowledge(res, { type: 5, data: {} })"));
  assert.ok(interactions.includes("const avatar = safeAvatar(data.avatar)"));
  assert.ok(interactions.includes("thumbnail: avatar"));
});

test("Discord alliance registration uses signed identity and owner-only database bypass", async () => {
 const handler=await readFile(new URL("../internal/kingshot/alliance-sync-handler.ts",import.meta.url),"utf8");
 const migration=await readFile(new URL("../supabase/migrations/20261101150000_discord_alliance_registration_owner_bypass.sql",import.meta.url),"utf8");
 assert.ok(interactions.includes("interaction.member?.user?.id || interaction.user?.id"));
 assert.ok(interactions.includes("verifySignature("));
 assert.ok(handler.includes("registerAllianceFromDiscord"));
 assert.ok(handler.includes("discordUserId==='871756466900598815'"));
 assert.ok(handler.includes("p_owner_bypass:isOwner"));
 assert.ok(migration.includes("p_owner_bypass boolean"));
 assert.ok(migration.includes("p_owner_bypass is distinct from true and v_total >= 4"));
 assert.ok(migration.includes("grant execute on function public.register_alliance_sync_config_from_discord"));
});


test("alliance information is a detailed embed and roster names stay in the selector", () => {
  assert.ok(interactions.includes("allianceEmbed(data, registrationStatus)"));
  assert.ok(interactions.includes("fields: []"));
  assert.ok(interactions.includes("SERVER DETAILS"));
  assert.ok(interactions.includes("Choose a governor from the selector below"));
});

test("Discord server Administrator is distinct from project-owner bypass", () => {
  assert.ok(interactions.includes("function isGuildAdministrator(interaction)"));
  assert.ok(interactions.includes("& 8n"));
  assert.ok(interactions.includes('name === "set-gift-code-alert-channel"'));
  assert.ok(interactions.includes('name === "announce"'));
  assert.ok(interactions.includes("announce-confirm"));
  assert.ok(interactions.includes("announce-cancel"));
  assert.ok(commands.includes('default_member_permissions: "8"'));
  assert.ok(commands.includes('name: "set-gift-code-alert-channel"'));
  assert.ok(commands.includes('name: "announce"'));
});

 
test("announcement confirmation claims a pending send exactly once", () => {
  assert.ok(interactions.includes('status: "publishing"'));
  assert.ok(interactions.includes("if (!Array.isArray(claimed) || !claimed.length)"));
});


test("Discord alliance cards show authoritative registration status and player cards expose alliance navigation", () => {
  assert.ok(interactions.includes("fetchAllianceRegistrationStatus(kingdomId, tag)"));
  assert.ok(interactions.includes('field("REGISTRATION", registrationStatus)'));
  assert.ok(interactions.includes("alliance_sync_config?kingdom_id=eq."));
  assert.ok(interactions.includes('custom_id: "ks:player-alliance:" + id'));
  assert.ok(interactions.includes('action === "player-alliance"'));
  assert.ok(interactions.includes('action === "player-return"'));
  assert.ok(interactions.includes("Back to player profile"));
  assert.ok(interactions.includes("fetchPlayerRegistrationStatus(playerId)"));
  assert.ok(interactions.includes('field("AUTO-REDEEM", data.registrationStatus || "Status unavailable", true)') || interactions.includes('field("AUTO-REDEEM", data.registrationStatus || "Status unavailable")'));
  assert.ok(interactions.includes('status === "unregistered"'));
  assert.ok(interactions.includes('name === "bot-info"'));
  assert.ok(interactions.includes("fetchPlayerRegistrationStatus(playerId)"));
  assert.ok(interactions.includes("field(\"AUTO-REDEEM\", data.registrationStatus || \"Status unavailable\")"));
  assert.ok(interactions.includes("status === \"unregistered\""));
  assert.ok(interactions.includes("name === \"bot-info\""));
});

 
test("scheduled website announcements use durable claims, validated roles, and private image storage", async () => {
  const api = await readFile(new URL("../api/custom-message.js", import.meta.url), "utf8");
  const ui = await readFile(new URL("../src/CustomMessageApp.jsx", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase/migrations/20261101170000_durable_discord_announcements.sql", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../.github/workflows/announcement-scheduler.yml", import.meta.url), "utf8");
  for (const expected of ["SCHEDULE_CREATE","SCHEDULE_LIST","SCHEDULE_UPDATE","SCHEDULE_RUN","ANNOUNCEMENT_ROLES","ANNOUNCEMENT_ATTACHMENT_UPLOAD","claim_due_discord_announcements","allowed_mentions:{parse:[],roles:roleIds}","lease_token","interval_seconds","attachment_path"]) {
    assert.ok(api.includes(expected) || migration.includes(expected), "missing scheduler backend feature: "+expected);
  }
  for (const expected of ["datetime-local","repeatMinutes","roleIdsInput","SCHEDULE_CREATE","Pause","Resume","Cancel",'type="file"']) assert.ok(ui.includes(expected), "missing scheduler UI feature: "+expected);
  for (const expected of ["create table if not exists public.discord_scheduled_announcements","for update skip locked","lease_until","enable row level security","revoke all","claim_due_discord_announcements","announcement-attachments"]) assert.ok(migration.includes(expected), "missing durable migration feature: "+expected);
  assert.ok(workflow.includes('cron: "*/5 * * * *"'));
  assert.ok(workflow.includes("CRON_SECRET"));
});
