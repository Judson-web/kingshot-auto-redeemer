import crypto from "node:crypto";
import { fetchMightPulse } from "./mightpulse-key-pool.js";
import { allianceDisplayName, formatPower, playerDisplayName } from "./player-display.js";
import { formatTownCenterLevel } from "./town-center-level.js";

const DISCORD_API = "https://discord.com/api/v10";
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
function safe(value, fallback = "—") { const result = String(value ?? "").trim(); return result || fallback; }
function field(name, value, inline = true) { return { name, value: safe(value).slice(0, 1024), inline }; }
function safeAvatar(value) {
  const url = String(value || "");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || ![
      "got-global-avatar.akamaized.net",
      "got-global-avatar.chosenonegames.com",
      "cdn.mightpulse.com",
      "www.mightpulse.com"
    ].includes(parsed.hostname)) return undefined;
    return url;
  } catch { return undefined; }
}
function playerProfileEmbed(data) {
  const fields = [
    field("⚡ POWER", data.power),
    field("⚔️ KILLS", data.kills),
    field("🏰 TOWN CENTER", data.townCenter),
    field("💎 VIP", data.vip),
    field("🏅 ALLIANCE RANK", data.rank),
    field("📍 COORDINATES", data.coordinates),
    field("🟢 STATUS", data.online)
  ];
  return {
    color: BRAND.color,
    author: { name: "KINGSHOT • PLAYER INTELLIGENCE", ...(BRAND.icon ? { icon_url: BRAND.icon } : {}) },
    title: data.governor,
    description: "**Kingdom " + data.kingdom + "**  ·  **" + data.alliance + "**\nPlayer ID: `" + data.playerId + "`",
    thumbnail: safeAvatar(data.avatar) ? { url: safeAvatar(data.avatar) } : undefined,
    fields,
    footer: { text: "MightPulse • Live player profile" },
    timestamp: new Date().toISOString()
  };
}
function registrationEmbed(data) {
  return {
    color: BRAND.color,
    author: { name: BRAND.name, ...(BRAND.icon ? { icon_url: BRAND.icon } : {}) },
    title: data.status === "ALREADY REGISTERED" ? "Already registered" : "Registration successful",
    description: "Your player is enrolled in automatic gift-code redemption.",
    fields: [
      field("GOVERNOR", data.governor),
      field("KINGDOM", data.kingdom),
      field("PLAYER ID", "`" + data.playerId + "`")
    ],
    footer: { text: BRAND.footer },
    timestamp: new Date().toISOString()
  };
}
function brandedEmbed({ title, description, fields = [], thumbnail }) {
  return {
    title, description, color: BRAND.color,
    ...(thumbnail ? { thumbnail: { url: String(thumbnail) } } : {}),
    fields,
    author: { name: BRAND.name, ...(BRAND.icon ? { icon_url: BRAND.icon } : {}) },
    footer: { text: BRAND.footer },
    timestamp: new Date().toISOString()
  };
}
async function discordRequest(path, method = "POST", body) {
  return fetch(DISCORD_API + path, {
    method, headers: { Authorization: "Bot " + BOT_TOKEN, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000)
  });
}
async function interactionCallback(id, token, body) {
  return fetch(DISCORD_API + "/interactions/" + id + "/" + token + "/callback", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(8000)
  });
}
let appIdCache = null;
async function getApplicationId() {
  if (appIdCache) return appIdCache;
  const response = await discordRequest("/users/@me", "GET");
  if (!response.ok) throw Error("Discord bot authentication failed.");
  appIdCache = String((await response.json()).id);
  return appIdCache;
}
async function followup(token, body) {
  const response = await fetch(DISCORD_API + "/webhooks/" + (await getApplicationId()) + "/" + token, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw Error("Discord could not deliver the response.");
  return { delivered: true };
}
async function fetchPlayer(id) {
  const response = await fetchMightPulse("https://api.mightpulse.com/v1/players/" + encodeURIComponent(id) + "?include=base",
    {}, { timeoutMs: 15000 });
  const data = await response.json().catch(() => ({}));
  if (response.status === 404) return null;
  if (!response.ok) throw Error(data?.message || data?.error || "Player lookup is temporarily unavailable.");
  return data.player || data;
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
  return {
    governor: playerDisplayName(player, "Unknown player"), kingdom: safe(player.kid),
    power: safe(formatPower(player.power)),
    townCenter: safe(formatTownCenterLevel(player.town_center_level ?? player.town_center)),
    vip: safe(player.vip), alliance: safe(allianceDisplayName(player)),
    rank: safe(alliance.rank_label || alliance.rank), kills: safe(formatPower(player.kills)),
    coordinates: player.x != null && player.y != null ? String(player.x) + " / " + String(player.y) : "—",
    online: player.online ? "Online" : "Offline", playerId: id,
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

async function handleCommand(req, interaction) {
  const name = String(interaction.data?.name || "");
  const options = interaction.data?.options || [];
  if (name === "player") {
    const id = String(option(options, "id") || "").trim();
    if (!/^\d{5,20}$/.test(id)) return { content: "Please enter a valid Kingshot Player ID.", flags: 64 };
    await interactionCallback(interaction.id, interaction.token, { type: 5, data: {} });
    try {
      const player = await fetchPlayer(id);
      if (!player) return followup(interaction.token, { content: "No player was found for that ID." });
      const data = playerCardData(player, id);
      return followup(interaction.token, {
        embeds: [playerProfileEmbed(data)],
        allowed_mentions: { parse: [] }
      });
    } catch (error) {
      return followup(interaction.token, { content: safe(error.message, "Player lookup failed.") });
    }
  }
  if (name === "register") {
    const id = String(option(options, "player_id") || "").trim();
    if (!/^\d{5,20}$/.test(id)) return { content: "Please enter a valid Kingshot Player ID.", flags: 64 };
    await interactionCallback(interaction.id, interaction.token, { type: 5, data: { flags: 64 } });
    try {
      let player = null;
      try { player = await fetchPlayer(id); } catch { /* Optional profile data must not block registration. */ }
      const result = await registerPlayer(req, id, player);
      const data = registrationCardData(result, id, player);
      return followup(interaction.token, {
        embeds: [registrationEmbed(data)],
        flags: 64,
        allowed_mentions: { parse: [] }
      });
    } catch (error) {
      return followup(interaction.token, {
        embeds: [brandedEmbed({ title: "Registration could not be completed",
          description: safe(error.message, "Please try again later.") })], flags: 64
      });
    }
  }
  return { content: "That command is not available.", flags: 64 };
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
  if (interaction.type !== 2) return res.status(400).json({ error: "Unsupported interaction" });
  try {
    const result = await handleCommand(req, interaction);
    if (result?.delivered) return res.status(200).end();
    if (result?.content || result?.embeds) return res.status(200).json({ type: 4, data: result });
    return res.status(200).end();
  } catch (error) {
    try {
      await interactionCallback(interaction.id, interaction.token, {
        type: 4, data: { content: safe(error.message, "Something went wrong."), flags: 64 }
      });
    } catch {}
    return res.status(200).end();
  }
}
