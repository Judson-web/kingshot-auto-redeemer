import crypto from "node:crypto";
import { fetchMightPulse } from "./mightpulse-key-pool.js";
import { allianceDetails, allianceDisplayName, formatPower, playerDisplayName } from "./player-display.js";
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
function playerCardUrl(data) {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return "https://kingshot-autoredeemer.vercel.app/api/discord-player-card?data=" + encodeURIComponent(payload);
}
function playerProfileEmbed(data) {
  const avatar = safeAvatar(data.avatar);
  return {
    color: 0x8E3D78,
    image: { url: playerCardUrl(data) },
    ...(avatar ? { thumbnail: { url: avatar } } : {}),
    footer: { text: "MIGHTPULSE • LIVE GOVERNOR PROFILE" },
    timestamp: new Date().toISOString()
  };
}
function rosterButton(data) {
  const tag = String(data.allianceTag || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20);
  const kingdom = String(data.kingdom || "").replace(/\D/g, "").slice(0, 10);
  if (!tag || !kingdom) return [];
  return [{ type: 1, components: [{ type: 2, style: 2, label: "View alliance roster", custom_id: "roster|" + kingdom + "|" + tag + "|0" }] }];
}
function rosterComponents(roster, kingdom, tag, offset = 0) {
  const pageSize = 25;
  const page = roster.members.slice(offset, offset + pageSize);
  const components = [];
  if (page.length) components.push({ type: 1, components: [{
    type: 3, custom_id: "select|" + kingdom + "|" + tag + "|" + offset,
    placeholder: "Select a governor to view their profile",
    min_values: 1, max_values: 1,
    options: page.map(member => ({
      label: (member.name || "Governor " + member.id).slice(0, 100),
      value: member.id,
      description: ("ID " + member.id + (member.power ? " • " + member.power : "")).slice(0, 100)
    }))
  }] });
  const nav = [];
  if (offset > 0) nav.push({ type: 2, style: 2, label: "Previous", custom_id: "roster|" + kingdom + "|" + tag + "|" + Math.max(0, offset - pageSize) });
  if (offset + pageSize < roster.members.length) nav.push({ type: 2, style: 2, label: "Next", custom_id: "roster|" + kingdom + "|" + tag + "|" + (offset + pageSize) });
  if (nav.length) components.push({ type: 1, components: nav });
  return components;
}
function rosterEmbed(roster, kingdom, offset = 0) {
  const page = Math.floor(offset / 25) + 1;
  const pages = Math.max(1, Math.ceil(roster.members.length / 25));
  return {
    color: 0x8E3D78,
    title: (roster.name || roster.tag) + " • Alliance roster",
    description: "Kingdom **" + kingdom + "** · **" + roster.members.length + "** verified members\nChoose a governor below to open their live player profile.",
    footer: { text: "MIGHTPULSE • Roster page " + page + "/" + pages },
    timestamp: new Date().toISOString()
  };
}
async function fetchAllianceRoster(kingdom, tag) {
  if (!/^\d{1,10}$/.test(kingdom) || !/^[A-Za-z0-9_-]{1,20}$/.test(tag)) throw Error("Invalid alliance selection.");
  const response = await fetchMightPulse("https://api.mightpulse.com/v1/alliances/" + encodeURIComponent(kingdom) + "/" + encodeURIComponent(tag) + "?include=info,roster",
    { headers: { Accept: "application/json" } }, { timeoutMs: 20000 });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(response.status === 429 ? "MightPulse is rate-limiting roster requests. Please try again shortly." : "The alliance roster is temporarily unavailable.");
  if (data?.fresh === false || data?.stale === true) throw Error("MightPulse returned a stale roster. Please try again later.");
  const root = data?.data && typeof data.data === "object" ? data.data : data;
  const alliance = root.alliance || root;
  const rows = Array.isArray(root.members) ? root.members : Array.isArray(root.roster) ? root.roster : Array.isArray(alliance.members) ? alliance.members : [];
  const byId = new Map();
  for (const row of rows) {
    const id = String(row?.governor_id ?? row?.fid ?? "").trim();
    const kid = String(row?.kid ?? kingdom);
    if (!/^\d{5,20}$/.test(id) || kid !== kingdom || byId.has(id)) continue;
    byId.set(id, { id, name: safe(row?.nick_name || row?.name || row?.nickname, "Governor").slice(0, 80), power: row?.power == null ? "" : formatPower(row.power) });
  }
  const members = [...byId.values()];
  const count = Number(alliance.member_count ?? alliance.memberCount ?? alliance.count ?? rows.length);
  if (!members.length || !Number.isFinite(count) || members.length < Math.min(count, 5) || members.length / Math.max(count, 1) < 0.95) {
    throw Error("The roster could not be fully verified. No partial roster will be shown.");
  }
  const canonicalTag = String(alliance.abbr ?? alliance.tag ?? tag).trim();
  if (canonicalTag !== tag) throw Error("The alliance tag did not match the requested alliance.");
  return { name: safe(alliance.name || alliance.alliance_name || tag), tag: canonicalTag, members };
}
async function editOriginal(token, body) {
  const response = await fetch(DISCORD_API + "/webhooks/" + (await getApplicationId()) + "/" + token + "/messages/@original", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw Error("Discord could not update this response.");
  return { delivered: true };
}
function registrationEmbed(data) {
  const already = data.status === "ALREADY REGISTERED";
  return {
    color: already ? 0x64748B : 0x36A878,
    author: { name: BRAND.name, ...(BRAND.icon ? { icon_url: BRAND.icon } : {}) },
    title: data.status === "ALREADY REGISTERED" ? "Already enrolled" : "Player registered successfully",
    description: data.status === "ALREADY REGISTERED" ? "**" + safe(data.governor, "Kingshot player") + "** is already enrolled in automatic gift-code redemption. No changes were needed." : "**" + safe(data.governor, "Kingshot player") + "** has been added to automatic gift-code redemption. Future eligible codes will be processed automatically.",
    fields: [
      field("KINGDOM", data.kingdom),
      field("PLAYER ID", "`" + data.playerId + "`")
    ],
    footer: { text: already ? "AUTO REDEEM • EXISTING REGISTRATION" : "AUTO REDEEM • REGISTRATION CONFIRMED" },
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
  const fullName = playerDisplayName(player, "Unknown player");
  const tagMatch = fullName.match(/^\[([^\]]+)\]\s*(.*)$/);
  return {
    governor: tagMatch ? tagMatch[2] : fullName,
    tag: tagMatch ? tagMatch[1] : "",
    kingdom: safe(player.kid),
    power: safe(formatPower(player.power)),
    townCenter: safe(formatTownCenterLevel(player.town_center_level ?? player.town_center)),
    vip: safe(player.vip), alliance: safe(allianceDisplayName(player)),
    rank: safe(alliance.rank_label || alliance.rank), kills: safe(formatPower(player.kills)),
    coordinates: player.x != null && player.y != null ? String(player.x) + " / " + player.y : "—",
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

async function handleComponent(interaction) {
  const token = interaction.token;
  const parts = String(interaction.data?.custom_id || "").split("|");
  const action = parts[0], kingdom = parts[1], tag = parts[2];
  const offset = Number(parts[3] || 0);
  if (!["roster", "select", "back"].includes(action) || !/^\d{1,10}$/.test(kingdom || "") ||
      !/^[A-Za-z0-9_-]{1,20}$/.test(tag || "") || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000 || offset % 25 !== 0) {
    return { content: "This roster control is invalid or expired. Run /player again.", flags: 64 };
  }
  await interactionCallback(interaction.id, token, { type: 6 });
  try {
    const roster = await fetchAllianceRoster(kingdom, tag);
    if (action === "select") {
      const id = String(interaction.data?.values?.[0] || "");
      if (!/^\d{5,20}$/.test(id) || !roster.members.some(member => member.id === id)) {
        return editOriginal(token, { content: "That governor is no longer in the verified roster. Refresh and try again.", embeds: [], components: [] });
      }
      const player = await fetchPlayer(id);
      if (!player) return editOriginal(token, { content: "That player profile is no longer available.", embeds: [], components: [] });
      const data = playerCardData(player, id);
      data.allianceTag = tag;
      return editOriginal(token, { content: "", embeds: [playerProfileEmbed(data)], components: [{
        type: 1, components: [{ type: 2, style: 2, label: "Back to alliance roster", custom_id: "back|" + kingdom + "|" + tag + "|" + offset }]
      }], allowed_mentions: { parse: [] } });
    }
    return editOriginal(token, { content: "", embeds: [rosterEmbed(roster, kingdom, offset)],
      components: rosterComponents(roster, kingdom, tag, offset), allowed_mentions: { parse: [] } });
  } catch (error) {
    return editOriginal(token, { content: safe(error.message, "The alliance roster could not be loaded."), embeds: [], components: [] });
  }
}

async function handleCommand(req, interaction, res) {
  const name = String(interaction.data?.name || "");
  const options = interaction.data?.options || [];
  if (name === "player") {
    const id = String(option(options, "id") || "").trim();
    if (!/^\d{5,20}$/.test(id)) return { content: "Please enter a valid Kingshot Player ID.", flags: 64 };
    // Acknowledge through the incoming HTTP interaction response immediately.
    // Discord allows roughly 3 seconds; avoid another outbound REST round-trip first.
    res.status(200).json({ type: 5, data: {} });
    try {
      const player = await fetchPlayer(id);
      if (!player) return followup(interaction.token, { content: "No player was found for that ID." });
      const data = playerCardData(player, id);
      data.allianceTag = allianceDetails(player).tag;
      return followup(interaction.token, {
        embeds: [playerProfileEmbed(data)],
        components: rosterButton(data),
        allowed_mentions: { parse: [] }
      });
    } catch (error) {
      return followup(interaction.token, { content: safe(error.message, "Player lookup failed.") });
    }
  }
  if (name === "register") {
    const id = String(option(options, "player_id") || "").trim();
    if (!/^\d{5,20}$/.test(id)) return { content: "Please enter a valid Kingshot Player ID.", flags: 64 };
    // Defer through the incoming HTTP response before profile or registration work.
    res.status(200).json({ type: 5, data: {} });
    try {
      let player = null;
      try { player = await fetchPlayer(id); } catch { /* Optional profile data must not block registration. */ }
      const result = await registerPlayer(req, id, player);
      const data = registrationCardData(result, id, player);
      return followup(interaction.token, {
        embeds: [registrationEmbed(data)],
        allowed_mentions: { parse: [] }
      });
    } catch (error) {
      return followup(interaction.token, {
        embeds: [brandedEmbed({ title: "Registration could not be completed",
          description: safe(error.message, "Please try again later.") })]
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
  if (interaction.type !== 2 && interaction.type !== 3) return res.status(400).json({ error: "Unsupported interaction" });
  try {
    const result = interaction.type === 3 ? await handleComponent(interaction) : await handleCommand(req, interaction, res);
    // Commands needing I/O have already returned a type-5 deferred response.
    if (res.headersSent) return;
    if (result?.delivered) return res.status(200).end();
    if (result?.content || result?.embeds) return res.status(200).json({ type: 4, data: result });
    return res.status(200).end();
  } catch (error) {
    if (res.headersSent) return;
    try {
      await interactionCallback(interaction.id, interaction.token, {
        type: 4, data: { content: safe(error.message, "Something went wrong."), flags: 64 }
      });
    } catch {}
    return res.status(200).end();
  }
}
