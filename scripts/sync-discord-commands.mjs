#!/usr/bin/env node
/**
 * Safely reconcile this application's four Kingshot slash commands.
 *
 * Uses Discord's per-command POST upsert endpoint, not bulk overwrite. This
 * preserves commands owned by other integrations in the same scope.
 *
 * Required: DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID.
 * Optional: DISCORD_GUILD_ID (guild scope; otherwise global scope).
 */
const token = String(process.env.DISCORD_BOT_TOKEN || "").trim();
const applicationId = String(process.env.DISCORD_APPLICATION_ID || "").trim();
const guildId = String(process.env.DISCORD_GUILD_ID || "").trim();

if (!token) {
  console.error("Missing DISCORD_BOT_TOKEN. Add it as a GitHub Actions secret.");
  process.exit(1);
}
if (!/^\d{5,25}$/.test(applicationId)) {
  console.error("DISCORD_APPLICATION_ID must be the Discord application's numeric ID.");
  process.exit(1);
}
if (guildId && !/^\d{5,25}$/.test(guildId)) {
  console.error("DISCORD_GUILD_ID must be the Discord server's numeric ID.");
  process.exit(1);
}

const commands = [
  { name: "bot-info", description: "Show bot features and the invite link", type: 1 },
  { name: "set-gift-code-alert-channel", description: "Choose this server’s verified gift-code alert channel", type: 1, default_member_permissions: "8", dm_permission: false, options: [{ type: 7, name: "channel", description: "Text channel for gift-code alerts", required: true, channel_types: [0, 5] }] },
  { name: "announce", description: "Preview and publish a server announcement", type: 1, default_member_permissions: "8", dm_permission: false, options: [{ type: 7, name: "channel", description: "Where to publish the announcement", required: true, channel_types: [0, 5] }, { type: 3, name: "title", description: "Announcement title", required: true, max_length: 256 }, { type: 3, name: "message", description: "Announcement message", required: true, max_length: 3500 }] },
  { name: "codes", description: "List active verified gift codes and recent redemption results", type: 1 },
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
    name: "alliance",
    description: "Browse alliances and player rosters in a kingdom",
    type: 1,
    options: [
      { type: 4, name: "kingdom", description: "Kingshot kingdom number", required: true },
      { type: 3, name: "search", description: "Optional alliance name or tag filter", required: false }
    ]
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

async function request(method, path = "", body) {
  const url = endpoint + path;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: "Bot " + token,
        "Content-Type": "application/json"
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000)
    });
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }

    if (response.status === 429 && attempt < 3) {
      const headerDelay = Number(response.headers.get("retry-after"));
      const bodyDelay = Number(data?.retry_after);
      const delaySeconds = Number.isFinite(headerDelay) && headerDelay > 0
        ? headerDelay
        : Number.isFinite(bodyDelay) && bodyDelay > 0 ? bodyDelay : 1;
      await new Promise(resolve => setTimeout(resolve, Math.min(delaySeconds * 1000, 10000)));
      continue;
    }

    if (!response.ok) {
      const detail = typeof data === "string" ? data : JSON.stringify(data);
      throw new Error(`Discord API ${method} ${url.replace(token, "[redacted]")} failed (${response.status}): ${String(detail || "").slice(0, 700)}`);
    }
    return data;
  }
  throw new Error("Discord API rate limit retries were exhausted.");
}

function commandMatches(actual, expected) {
  if (!actual || actual.name !== expected.name || Number(actual.type || 1) !== expected.type) return false;
  const actualOptions = Array.isArray(actual.options) ? actual.options : [];
  const expectedOptions = expected.options || [];
  if (actualOptions.length !== expectedOptions.length) return false;
  return expectedOptions.every(expectedOption => {
    const found = actualOptions.find(option => option.name === expectedOption.name);
    return Boolean(found)
      && Number(found.type) === expectedOption.type
      && Boolean(found.required) === Boolean(expectedOption.required);
  });
}

try {
  // Prove the credentials work before attempting writes.
  const bot = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: "Bot " + token },
    signal: AbortSignal.timeout(15000)
  });
  const botBody = await bot.json().catch(() => ({}));
  if (!bot.ok) {
    throw new Error(`Discord bot authentication failed (${bot.status}): ${JSON.stringify(botBody).slice(0, 500)}`);
  }
  console.log(`Authenticated as Discord bot ${botBody.username || "unknown"} (${botBody.id || "ID unavailable"}).`);

  // Guild commands are the recommended fast path for testing and update
  // immediately. This preflight catches a wrong server ID or missing bot access.
  if (guildId) {
    const guildResponse = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: { Authorization: "Bot " + token },
      signal: AbortSignal.timeout(15000)
    });
    const guildBody = await guildResponse.json().catch(() => ({}));
    if (!guildResponse.ok) {
      throw new Error(`Bot cannot access target Discord server ${guildId} (${guildResponse.status}): ${JSON.stringify(guildBody).slice(0, 500)}. Check the server ID and that this bot is a member.`);
    }
    console.log(`Verified access to Discord server ${guildBody.name || guildId} (${guildId}).`);
  }

  // POST is an idempotent upsert for an existing command name/type. Unlike
  // PUT bulk overwrite, it leaves unrelated commands untouched.
  const upserted = [];
  for (const command of commands) {
    const result = await request("POST", "", command);
    if (!result?.id || result.name !== command.name) {
      throw new Error(`Discord accepted an unexpected response while registering /${command.name}.`);
    }
    upserted.push({ name: result.name, id: result.id, version: result.version || null });
    console.log(`Registered /${result.name} (${result.id}).`);
  }

  // This bot is intentionally guild-scoped for the Kingshot community.
  // Remove only matching global commands from this same application, which
  // otherwise appear beside the guild commands as duplicate slash entries.
  // Unrelated global commands are left untouched.
  if (guildId) {
    const globalEndpoint = `https://discord.com/api/v10/applications/${applicationId}/commands`;
    async function globalRequest(method, path = "") {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await fetch(globalEndpoint + path, {
          method,
          headers: { Authorization: "Bot " + token, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(15000)
        });
        const raw = await response.text();
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
        if (response.status === 429 && attempt < 3) {
          const headerDelay = Number(response.headers.get("retry-after"));
          const bodyDelay = Number(data?.retry_after);
          const delaySeconds = Number.isFinite(headerDelay) && headerDelay > 0
            ? headerDelay
            : Number.isFinite(bodyDelay) && bodyDelay > 0 ? bodyDelay : 1;
          await new Promise(resolve => setTimeout(resolve, Math.min(delaySeconds * 1000, 10000)));
          continue;
        }
        if (!response.ok) {
          throw new Error(`Discord global command API ${method} failed (${response.status}): ${String(typeof data === "string" ? data : JSON.stringify(data)).slice(0, 500)}`);
        }
        return data;
      }
      throw new Error("Discord global command cleanup rate limit retries were exhausted.");
    }

    const globalBefore = await globalRequest("GET");
    if (!Array.isArray(globalBefore)) throw new Error("Discord returned an invalid global command list.");
    const duplicateGlobals = globalBefore.filter(globalCommand =>
      commands.some(expected =>
        globalCommand.name === expected.name &&
        Number(globalCommand.type || 1) === expected.type
      )
    );
    for (const duplicate of duplicateGlobals) {
      await globalRequest("DELETE", `/${encodeURIComponent(duplicate.id)}`);
      console.log(`Removed duplicate global command /${duplicate.name} (${duplicate.id}); guild command remains.`);
    }
    const globalAfter = await globalRequest("GET");
    const remainingDuplicates = globalAfter.filter(globalCommand =>
      commands.some(expected =>
        globalCommand.name === expected.name &&
        Number(globalCommand.type || 1) === expected.type
      )
    );
    if (remainingDuplicates.length) {
      throw new Error("Duplicate global commands remain: " + remainingDuplicates.map(item => "/" + item.name).join(", "));
    }
    console.log(`Global duplicate cleanup verified. Removed ${duplicateGlobals.length} duplicate command(s).`);
  }

  // Read the scope back from Discord and verify the options, not just HTTP 2xx.
  const registered = await request("GET");
  if (!Array.isArray(registered)) {
    throw new Error("Discord returned an invalid command list during verification.");
  }
  const failures = commands.filter(expected => {
    const actual = registered.find(command => command.name === expected.name && Number(command.type || 1) === expected.type);
    return !commandMatches(actual, expected);
  });
  if (failures.length) {
    throw new Error("Discord read-back verification failed for: " + failures.map(item => "/" + item.name).join(", "));
  }

  console.log(JSON.stringify({
    status: "verified",
    scope: guildId ? "guild" : "global",
    guildId: guildId || null,
    applicationId,
    bot: { id: botBody.id, username: botBody.username },
    verifiedCommands: commands.map(command => {
      const actual = registered.find(item => item.name === command.name && Number(item.type || 1) === command.type);
      return { name: actual.name, id: actual.id, options: (actual.options || []).map(option => option.name) };
    }),
    unrelatedCommandsPreserved: true,
    duplicateGlobalCommandsRemoved: Boolean(guildId)
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Discord command synchronization failed.");
  process.exit(1);
}
