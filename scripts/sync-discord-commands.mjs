#!/usr/bin/env node
/**
 * Reconcile Discord application commands with the commands implemented by
 * lib/discord-interactions.js. Requires DISCORD_BOT_TOKEN and
 * DISCORD_APPLICATION_ID. Set DISCORD_GUILD_ID to reconcile one guild scope
 * instead of the global scope.
 *
 * This is intentionally an allow-list sync: commands absent from this file
 * are removed from the selected scope. It never edits other guild scopes.
 */
const token = process.env.DISCORD_BOT_TOKEN;
const applicationId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !applicationId) {
  console.error("Set DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID.");
  process.exit(1);
}
if (!/^\d{5,25}$/.test(applicationId) || (guildId && !/^\d{5,25}$/.test(guildId))) {
  console.error("Discord application and guild IDs must be numeric snowflakes.");
  process.exit(1);
}

const commands = [
  {
    name: "player",
    description: "Look up a Kingshot player",
    type: 1,
    options: [{
      type: 3,
      name: "id",
      description: "Kingshot Player ID",
      required: true
    }]
  },
  {
    name: "register",
    description: "Register a Kingshot player for auto-redeem",
    type: 1,
    options: [{
      type: 3,
      name: "player_id",
      description: "Kingshot Player ID",
      required: true
    }]
  }
];

const scope = guildId
  ? `guilds/${guildId}/commands`
  : "commands";
const endpoint = `https://discord.com/api/v10/applications/${applicationId}/${scope}`;

async function request(method, body) {
  const response = await fetch(endpoint, {
    method,
    headers: {
      Authorization: "Bot " + token,
      "Content-Type": "application/json"
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    throw new Error(`Discord API ${method} failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

try {
  const before = await request("GET");
  const after = await request("PUT", commands);
  console.log(JSON.stringify({
    scope: guildId ? "guild:" + guildId : "global",
    removedOrReplaced: Math.max(0, (Array.isArray(before) ? before.length : 0) - commands.length),
    commands: (Array.isArray(after) ? after : []).map(command => ({
      name: command.name,
      id: command.id,
      version: command.version
    }))
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Command sync failed.");
  process.exit(1);
}
