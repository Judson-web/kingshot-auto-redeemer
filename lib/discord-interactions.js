import crypto from "node:crypto";
import { fetchMightPulse } from "./mightpulse-key-pool.js";
import { allianceDisplayName, formatPower, playerDisplayName } from "./player-display.js";
import { formatTownCenterLevel } from "./town-center-level.js";

const DISCORD_API = "https://discord.com/api/v10";
const SITE_URL = "https://kingshot-autoredeemer.vercel.app";
const BRAND = {
  name: "KINGSHOT AUTO REDEEMER",
  color: 0xD6A84F,
  footer: "KINGSHOT AUTO REDEEMER • Community tools",
  icon: process.env.DISCORD_BRAND_ICON_URL || undefined
};
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || process.env.DISCORD_APPLICATION_PUBLIC_KEY || "";
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "";

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function verifySignature(timestamp, raw, signature) {
  if (!PUBLIC_KEY || !timestamp || !signature) return false;
  try {
    const keyBytes = Buffer.from(PUBLIC_KEY, "hex");
    if (keyBytes.length !== 32) return false;
    const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), keyBytes]);
    return crypto.verify(null, Buffer.from(timestamp + raw),
      crypto.createPublicKey({ key: der, format: "der", type: "spki" }), Buffer.from(signature, "hex"));
  } catch { return false; }
}
function option(options, name) { return options?.find(item => item.name === name)?.value; }
function safe(value, fallback = "—") { const result = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim(); return result || fallback; }
function field(name, value, inline = true) { return { name, value: safe(value).slice(0, 1024), inline }; }
function safeAvatar(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:" || ![
      "got-global-avatar.akamaized.net",
      "got-global-avatar.chosenonegames.com",
      "cdn.mightpulse.com",
      "www.mightpulse.com"
    ].includes(parsed.hostname)) return undefined;
    return parsed.href;
  } catch { return undefined; }
}
function brandedEmbed({ title, description, fields = [], thumbnail, color = BRAND.color }) {
  return {
    title, description, color,
    ...(thumbnail ? { thumbnail: { url: String(thumbnail) } } : {}),
    fields,
    author: { name: BRAND.name, ...(BRAND.icon ? { icon_url: BRAND.icon } : {}) },
    footer: { text: BRAND.footer },
    timestamp: new Date().toISOString()
  };
}
function playerProfileEmbed(data) {
  const avatar = safeAvatar(data.avatar);
  const fields = [
    field("GOVERNOR ID", "`" + data.playerId + "`"),
    field("KINGDOM", data.kingdom),
    field("ALLIANCE", data.alliance),
    field("POWER", data.power),
    field("TOWN CENTER", data.townCenter),
    field("VIP", data.vip),
    field("KILLS", data.kills),
    field("ALLIANCE RANK", data.rank),
    field("COORDINATES", data.coordinates),
    field("STATUS", data.online)
  ];
  return {
    ...brandedEmbed({
      title: data.governor,
      description: [
        data.tag ? "**[" + data.tag + "]**" : "",
        "Live Kingshot governor profile"
      ].filter(Boolean).join(" • "),
      fields,
      thumbnail: avatar,
      color: 0xC99B45
    }),
    footer: { text: "MIGHTPULSE • LIVE GOVERNOR PROFILE" }
  };
}
function registrationEmbed(data) {
  const already = data.status === "ALREADY REGISTERED";
  return brandedEmbed({
    color: already ? 0x64748B : 0x36A878,
    title: already ? "Already enrolled" : "Player registered successfully",
    description: already
      ? "**" + safe(data.governor, "Kingshot player") + "** is already enrolled in automatic gift-code redemption. No changes were needed."
      : "**" + safe(data.governor, "Kingshot player") + "** has been added to automatic gift-code redemption. Future eligible codes will be processed automatically.",
    fields: [field("KINGDOM", data.kingdom), field("PLAYER ID", "`" + data.playerId + "`")],
  });
}
function playerComponents(id, registered = false) {
  const row = [{
    type: 2, style: 2, custom_id: "ks:refresh:" + id, label: "Refresh profile", emoji: { name: "🔄" }
  }];
  if (!registered) row.push({
    type: 2, style: 3, custom_id: "ks:register:" + id, label: "Register for auto-redeem", emoji: { name: "🎁" }
  });
  row.push({
    type: 2, style: 5, url: SITE_URL, label: "Open dashboard", emoji: { name: "🌐" }
  });
  return [{ type: 1, components: row }];
}
async function discordRequest(path, method = "POST", body) {
  return fetch(DISCORD_API + path, {
    method, headers: { Authorization: "Bot " + BOT_TOKEN, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000)
  });
}
async function followup(token, body) {
  const response = await fetch(DISCORD_API + "/webhooks/" + (await getApplicationId()) + "/" + token, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw Error("Discord could not deliver the response.");
  return { delivered: true };
}
async function editOriginal(token, body) {
  const response = await fetch(DISCORD_API + "/webhooks/" + (await getApplicationId()) + "/" + token + "/messages/@original", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw Error("Discord could not update the profile message.");
  return response.json().catch(() => ({}));
}
let appIdCache = String(process.env.DISCORD_APPLICATION_ID || "").trim() || null;
async function getApplicationId() {
  if (appIdCache) return appIdCache;
  const response = await discordRequest("/users/@me", "GET");
  if (!response.ok) throw Error("Discord bot authentication failed.");
  appIdCache = String((await response.json()).id);
  return appIdCache;
}
const playerCache = new Map();
const playerInFlight = new Map();
const PLAYER_CACHE_TTL_MS = 45_000;
const PLAYER_CACHE_MAX = 300;
async function fetchPlayer(id, forceRefresh = false) {
  const cached = playerCache.get(id);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.value;
  if (playerInFlight.has(id)) return playerInFlight.get(id);
  const lookup = (async () => {
    const startedAt = Date.now();
    try {
      const response = await fetchMightPulse("https://api.mightpulse.com/v1/players/" + encodeURIComponent(id) + "?include=base",
        {}, { timeoutMs: 8000, fastPath: true });
      const data = await response.json().catch(() => ({}));
      if (response.status === 404) return null;
      if (!response.ok) throw Error(data?.message || data?.error || "Player lookup is temporarily unavailable.");
      const player = data.player || data;
      if (player && typeof player === "object") {
        if (playerCache.size >= PLAYER_CACHE_MAX) {
          const oldest = playerCache.keys().next().value;
          if (oldest) playerCache.delete(oldest);
        }
        playerCache.set(id, { value: player, expiresAt: Date.now() + PLAYER_CACHE_TTL_MS });
      }
      console.info("Discord player lookup completed", { durationMs: Date.now() - startedAt, cache: forceRefresh ? "refresh" : "miss" });
      return player;
    } catch (error) {
      console.warn("Discord player lookup failed", { durationMs: Date.now() - startedAt, message: String(error?.message || error).slice(0, 120) });
      throw error;
    } finally {
      playerInFlight.delete(id);
    }
  })();
  playerInFlight.set(id, lookup);
  return lookup;
}
async function registerPlayer(req, id, player = null) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  if (!host) throw Error("Registration service is unavailable.");
  const response = await fetch(proto + "://" + host + "/api/kingshot-register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerId: id,
      ...(player?.kid != null ? { kingdomId: String(player.kid) } : {}),
      ...(player ? { playerName: playerDisplayName(player, "Kingshot Player") } : {}),
      ...(typeof player?.avatar_url === "string" ? { avatarUrl: player.avatar_url } : {})
    }), signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data?.error || "Could not register this player.");
  return data;
}
function playerCardData(player, id) {
  const alliance = player.alliance || {};
  const fullName = playerDisplayName(player, "Unknown player");
  const tagMatch = fullName.match(/^\[([^\]]+)\]\s*(.*)$/);
  return {
    governor: tagMatch ? tagMatch[2] : fullName,
    tag: tagMatch ? tagMatch[1] : "",
    kingdom: safe(player.kid),
    power: safe(formatPower(player.power)),
    townCenter: safe(formatTownCenterLevel(player.town_center_level ?? player.town_center)),
    vip: safe(player.vip),
    alliance: safe(allianceDisplayName(player)),
    rank: safe(alliance.rank_label || alliance.rank),
    kills: safe(formatPower(player.kills)),
    coordinates: player.x != null && player.y != null ? String(player.x) + " / " + player.y : "—",
    online: player.online ? "Online" : "Offline",
    playerId: id,
    avatar: typeof player.avatar_url === "string" ? player.avatar_url : ""
  };
}
function registrationCardData(result, id, player) {
  return {
    governor: player ? playerDisplayName(player, "Kingshot Player") : safe(result.player?.player_name || result.player?.name, "Kingshot Player"),
    kingdom: safe(result.verifiedKingdomId || player?.kid || result.player?.kingdom_id || result.player?.kid),
    playerId: id,
    status: result.alreadyRegistered ? "ALREADY REGISTERED" : "REGISTRATION SUCCESSFUL"
  };
}
function acknowledge(res, body) {
  res.status(200).json(body);
}
async function handleCommand(req, interaction, res) {
  const name = String(interaction.data?.name || "");
  const options = interaction.data?.options || [];
  if (name === "player") {
    const id = String(option(options, "id") || "").trim();
    if (!/^\d{5,20}$/.test(id)) return { content: "Please enter a valid Kingshot Player ID.", flags: 64 };
    acknowledge(res, { type: 5, data: {} });
    try {
      const player = await fetchPlayer(id);
      if (!player) return followup(interaction.token, { content: "No player was found for that ID.", flags: 64 });
      const data = playerCardData(player, id);
      return followup(interaction.token, {
        embeds: [playerProfileEmbed(data)],
        components: playerComponents(id),
        allowed_mentions: { parse: [] }
      });
    } catch (error) {
      return followup(interaction.token, { content: safe(error.message, "Player lookup failed."), flags: 64 });
    }
  }
  if (name === "register") {
    const id = String(option(options, "player_id") || "").trim();
    if (!/^\d{5,20}$/.test(id)) return { content: "Please enter a valid Kingshot Player ID.", flags: 64 };
    acknowledge(res, { type: 5, data: { flags: 64 } });
    try {
      let player = null;
      try { player = await fetchPlayer(id); } catch { /* Optional profile data must not block registration. */ }
      const result = await registerPlayer(req, id, player);
      return followup(interaction.token, {
        embeds: [registrationEmbed(registrationCardData(result, id, player))],
        allowed_mentions: { parse: [] },
        flags: 64
      });
    } catch (error) {
      return followup(interaction.token, {
        embeds: [brandedEmbed({ title: "Registration could not be completed", description: safe(error.message, "Please try again later.") })],
        flags: 64
      });
    }
  }
  return { content: "That command is not available.", flags: 64 };
}
async function handleComponent(req, interaction, res) {
  const [prefix, action, id] = String(interaction.data?.custom_id || "").split(":");
  if (prefix !== "ks" || !/^\d{5,20}$/.test(id || "")) {
    return acknowledge(res, { type: 4, data: { content: "This action is invalid or has expired.", flags: 64 } });
  }
  if (action === "refresh") {
    acknowledge(res, { type: 6 });
    try {
      const player = await fetchPlayer(id, true);
      if (!player) return editOriginal(interaction.token, { content: "No player was found for this ID.", embeds: [], components: [] });
      const data = playerCardData(player, id);
      return editOriginal(interaction.token, {
        embeds: [playerProfileEmbed(data)],
        components: playerComponents(id),
        allowed_mentions: { parse: [] }
      });
    } catch (error) {
      return followup(interaction.token, { content: safe(error.message, "Profile refresh failed."), flags: 64 });
    }
  }
  if (action === "register") {
    acknowledge(res, { type: 5, data: { flags: 64 } });
    try {
      let player = null;
      try { player = await fetchPlayer(id); } catch { /* Registration backend remains authoritative. */ }
      const result = await registerPlayer(req, id, player);
      const data = registrationCardData(result, id, player);
      await followup(interaction.token, {
        embeds: [registrationEmbed(data)],
        allowed_mentions: { parse: [] },
        flags: 64
      });
      if (!result.alreadyRegistered) {
        await editOriginal(interaction.token, { components: playerComponents(id, true) }).catch(() => {});
      }
      return { delivered: true };
    } catch (error) {
      return followup(interaction.token, {
        embeds: [brandedEmbed({ title: "Registration could not be completed", description: safe(error.message, "Please try again later.") })],
        flags: 64
      });
    }
  }
  return acknowledge(res, { type: 4, data: { content: "That action is not available.", flags: 64 } });
}
export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const raw = await getRawBody(req);
  if (!verifySignature(String(req.headers["x-signature-timestamp"] || ""), raw,
    String(req.headers["x-signature-ed25519"] || ""))) return res.status(401).send("invalid request signature");
  let interaction;
  try { interaction = JSON.parse(raw); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
  if (interaction.type === 1) return res.status(200).json({ type: 1 });
  try {
    if (interaction.type === 2) {
      const result = await handleCommand(req, interaction, res);
      if (res.headersSent) return;
      if (result?.delivered) return res.status(200).end();
      if (result?.content || result?.embeds) return res.status(200).json({ type: 4, data: result });
      return res.status(200).end();
    }
    if (interaction.type === 3) {
      await handleComponent(req, interaction, res);
      return;
    }
    return res.status(400).json({ error: "Unsupported interaction" });
  } catch (error) {
    if (res.headersSent) return;
    return res.status(200).json({
      type: 4,
      data: { content: safe(error.message, "Something went wrong."), flags: 64 }
    });
  }
}
