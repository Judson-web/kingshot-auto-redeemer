import crypto from "node:crypto";
import { waitUntil } from "@vercel/functions";
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
const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co").replace(/\/$/, "");
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();

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
    field("PLAYER ID", "`" + data.playerId + "`"),
    field("KINGDOM · ALLIANCE", data.kingdom + " · " + data.alliance, true),
    field("POWER · TC · VIP", data.power + " · " + data.townCenter + " · " + data.vip, true),
    field("KILLS · RANK", data.kills + " · " + data.rank, true),
    field("LOCATION · STATUS", data.coordinates + " · " + data.online, true)
  ];
  return {
    ...brandedEmbed({
      title: data.governor,
      description: data.tag ? "**[" + data.tag + "]**" : "Kingshot player",
      fields,
      thumbnail: avatar,
      color: 0xC99B45
    }),
    footer: { text: "MIGHTPULSE • PLAYER PROFILE" }
  };
}


async function fetchVerifiedGiftCodes() {
  if (!SUPABASE_KEY) throw Error("Gift-code verification data is unavailable.");
  const recentSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/discord_list_verified_gift_codes", {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ p_since: recentSince }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw Error("Could not load verified gift codes and recent redemption history.");
  const rows = await response.json().catch(() => null);
  if (!Array.isArray(rows)) throw Error("Gift-code verification returned an invalid response.");
  return {
    codes: rows.filter(row => row && row.code).map(row => ({
      code: String(row.code),
      recentSuccesses: Math.max(0, Number(row.recent_successes) || 0),
      validatedAt: row.validated_at || null
    })),
    recentSince,
    checkedAt: new Date().toISOString()
  };
}
function giftCodesEmbed(data, page) {
  const pageSize = 10, totalPages = Math.max(1, Math.ceil(data.codes.length / pageSize));
  const rows = data.codes.slice(page * pageSize, page * pageSize + pageSize);
  return brandedEmbed({ title: "Verified active gift codes", description: "Only active, unsuppressed codes marked verified are shown. Recent success counts cover the last 7 days. Page " + (page + 1) + " of " + totalPages + " · " + data.codes.length + " codes.", color: 0x36A878, fields: rows.map((row, index) => field(String(page * pageSize + index + 1).padStart(2, "0") + " · " + row.code, "Recent successful redemptions: **" + row.recentSuccesses + "**", false)) });
}
function giftCodeComponents(page, totalPages) { const buttons = []; if (page > 0) buttons.push({ type: 2, style: 2, custom_id: "ks:codes-page:" + (page - 1), label: "Previous" }); if (page + 1 < totalPages) buttons.push({ type: 2, style: 2, custom_id: "ks:codes-page:" + (page + 1), label: "Next" }); return buttons.length ? [{ type: 1, components: buttons }] : []; }
function alliancePageEmbed(kingdomId, alliances, page) {
  const pages = Math.max(1, Math.ceil(alliances.length / 25));
  const rows = alliances.slice(page * 25, page * 25 + 25);
  return brandedEmbed({ title: "Kingdom " + kingdomId + " alliances", description: "Found " + alliances.length + " alliances · choose one below to open its roster. Page " + (page + 1) + " of " + pages + ".", fields: rows.map(a => field("[" + a.tag + "] " + a.name, "Power " + (a.power == null ? "—" : formatPower(a.power)) + " · " + (a.memberCount ?? "—") + " members")) });
}

function allianceEmbed(data) {
  const a = data.alliance;
  return brandedEmbed({
    title: "[" + safe(a.tag) + "] " + safe(a.name),
    description: "Kingdom **" + safe(a.kingdomId) + "** · " + (data.stale ? "Cached roster data" : "Alliance overview"),
    color: 0xC99B45,
    fields: [
      field("ALLIANCE POWER", a.power == null ? "—" : formatPower(a.power)),
      field("MEMBERS", String(a.memberCount ?? data.members.length)),
      field("LEADER", a.leaderName),
      field("ROSTER PAGE", String(data.page + 1))
    ]
  });
}
function rosterComponents(kingdomId, tag, members, page, totalPages) {
  const pageSize = 10;
  const start = page * pageSize;
  const pageMembers = members.slice(start, start + pageSize);
  const components = [];
  if (pageMembers.length) {
    components.push({
      type: 1,
      components: [{
        type: 3,
        custom_id: "ks:member:" + kingdomId + ":" + tag + ":" + page,
        placeholder: "Choose a governor to view their profile",
        min_values: 1,
        max_values: 1,
        options: pageMembers.map(member => ({
          label: safe(member.name, "Kingshot Player").slice(0, 100),
          description: ("Power " + (member.power == null ? "unknown" : formatPower(member.power)) + " · ID " + member.playerId).slice(0, 100),
          value: member.playerId,
          ...(member.avatarUrl && safeAvatar(member.avatarUrl) ? { emoji: { name: "👤" } } : {})
        }))
      }]
    });
  }
  const buttons = [];
  if (page > 0) buttons.push({ type: 2, style: 2, custom_id: "ks:page:" + kingdomId + ":" + tag + ":" + (page - 1), label: "Previous" });
  if (page + 1 < totalPages) buttons.push({ type: 2, style: 2, custom_id: "ks:page:" + kingdomId + ":" + tag + ":" + (page + 1), label: "Next" });
  buttons.push({ type: 2, style: 2, custom_id: "ks:alliances:" + kingdomId, label: "Back to alliances" });
  if (buttons.length) components.push({ type: 1, components: buttons.slice(0, 5) });
  return components;
}
function allianceSearchComponents(kingdomId, alliances, page = 0, totalPages = 1, query = "") {
  const pageItems = alliances.slice(page * 25, page * 25 + 25);
  const options = pageItems.map(a => ({
    label: ("[" + a.tag + "] " + a.name).slice(0, 100),
    description: ("Power " + (a.power == null ? "unknown" : formatPower(a.power)) + " · " + (a.memberCount ?? "—") + " members").slice(0, 100),
    value: a.tag
  }));
  const components = [{
    type: 1,
    components: [{
      type: 3,
      custom_id: "ks:alliance:" + kingdomId,
      placeholder: "Choose an alliance to open its roster",
      min_values: 1, max_values: 1, options
    }]
  }];
  const buttons = [];
  if (page > 0) buttons.push({ type: 2, style: 2, custom_id: "ks:alliance-page:" + kingdomId + ":" + (page - 1) + ":" + encodeURIComponent(query).slice(0, 40), label: "Previous" });
  if (page + 1 < totalPages) buttons.push({ type: 2, style: 2, custom_id: "ks:alliance-page:" + kingdomId + ":" + (page + 1) + ":" + encodeURIComponent(query).slice(0, 40), label: "Next" });
  if (buttons.length) components.push({ type: 1, components: buttons });
  return components;
}
function rosterEmbed(data, page) {
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(data.members.length / pageSize));
  const reportedCount = Number(data.alliance.memberCount);
  const countMismatch = Number.isFinite(reportedCount) && reportedCount > data.members.length;
  return brandedEmbed({
    title: "[" + safe(data.alliance.tag) + "] " + safe(data.alliance.name) + " roster",
    description: [
      "**Kingdom " + safe(data.alliance.kingdomId) + "** · " + data.members.length + " players loaded" +
        (Number.isFinite(reportedCount) && reportedCount > 0 ? " · " + reportedCount + " reported" : ""),
      "Choose a governor below to open their profile.",
      "Page " + (page + 1) + " of " + totalPages + " · " + Math.min(pageSize, Math.max(0, data.members.length - page * pageSize)) + " shown",
      countMismatch ? "⚠️ Provider returned fewer members than the alliance's reported count. This roster may be incomplete." : "",
      data.stale ? "⚠️ Provider data may be cached." : ""
    ].filter(Boolean).join("\n"),
    fields: data.members.slice(page * pageSize, page * pageSize + pageSize).map((member, index) =>
      field(String(page * pageSize + index + 1).padStart(2, "0") + " · " + safe(member.name, "Governor"),
        "Power: " + (member.power == null ? "—" : formatPower(member.power)) + " · TC " + safe(member.townCenterLevel), false)
    )
  });
}
async function fetchAllianceApi(req, params) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  if (!host) throw Error("Alliance lookup service is unavailable.");
  const query = new URLSearchParams({ ...params, discordFastPath: "1" });
  const startedAt = Date.now();
  const response = await fetch(proto + "://" + host + "/api/kingshot-player?developer=alliance-lookup&" + query.toString(), {
    headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000)
  });
  console.info("Discord alliance lookup completed", { durationMs: Date.now() - startedAt, status: response.status });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(body.error || "Alliance data is temporarily unavailable.");
  return body;
}

function registrationEmbed(data) {
  const avatar = safeAvatar(data.avatar);
  const already = data.status === "ALREADY REGISTERED";
  return brandedEmbed({
    color: already ? 0x64748B : 0x36A878,
    title: already ? "Already enrolled" : "Player registered successfully",
    description: already
      ? "**" + safe(data.governor, "Kingshot player") + "** is already enrolled in automatic gift-code redemption. No changes were needed."
      : "**" + safe(data.governor, "Kingshot player") + "** has been added to automatic gift-code redemption. Future eligible codes will be processed automatically.",
    thumbnail: avatar,
    fields: [field("KINGDOM", data.kingdom), field("PLAYER ID", "`" + data.playerId + "`")],
  });
}
function playerComponents(id, registered = false) {
  const row = [{
    type: 2, style: 2, custom_id: "ks:refresh:" + id, label: "Refresh profile", emoji: { name: "🔄" }
  }];
  if (!registered) row.push({
    type: 2, style: 3, custom_id: "ks:register:" + id, label: "Register", emoji: { name: "🎁" }
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
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("Discord original interaction response rejected", {
      status: response.status,
      detail: safe(detail, "").slice(0, 180)
    });
    throw Error("Discord could not update the original interaction response.");
  }
  return response.json().catch(() => ({}));
}
async function completeDeferred(token, body, label) {
  const startedAt = Date.now();
  try {
    const result = await editOriginal(token, body);
    console.info("Discord deferred response completed", { label, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    console.error("Discord deferred response completion failed", {
      label,
      durationMs: Date.now() - startedAt,
      message: safe(error?.message, "Delivery failed.").slice(0, 180)
    });
    throw error;
  }
}
async function editSourceMessage(interaction, body) {
  const channelId = String(interaction.channel_id || "");
  const messageId = String(interaction.message?.id || "");
  if (!/^[0-9]{5,25}$/.test(channelId) || !/^[0-9]{5,25}$/.test(messageId)) {
    throw Error("Discord could not identify the profile message.");
  }
  const response = await discordRequest("/channels/" + channelId + "/messages/" + messageId, "PATCH", body);
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
        {}, { timeoutMs: 8000, fastPath: true, maxAttempts: 2, totalTimeoutMs: 18_000 });
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
    status: result.alreadyRegistered ? "ALREADY REGISTERED" : "REGISTRATION SUCCESSFUL",
    avatar: player?.avatar_url || result.player?.avatar_url || result.player?.avatarUrl || ""
  };
}
function acknowledge(res, body) {
  res.status(200).json(body);
}

function retainAfterAcknowledgement(promise, interaction, label) {
  const task = Promise.resolve(promise).catch(error => {
    console.error("Discord background interaction failed", {
      label,
      interactionId: safe(interaction?.id, "").slice(0, 24),
      command: safe(interaction?.data?.name, "component"),
      durationContext: "after_acknowledgement",
      message: safe(error?.message, "Background task failed.").slice(0, 180)
    });
  });

  // Discord has already received its 3-second acknowledgement. Keep the
  // remaining provider/API work alive for the Vercel request lifecycle.
  // waitUntil is a no-op outside Vercel request context; the task still runs.
  try {
    waitUntil(task);
  } catch (error) {
    console.error("Could not register Discord work with Vercel waitUntil", {
      label,
      message: safe(error?.message, "waitUntil unavailable.").slice(0, 180)
    });
  }
}
async function handleCommand(req, interaction, res) {
  const name = String(interaction.data?.name || "");
  const options = interaction.data?.options || [];
  if (name === "codes") {
    acknowledge(res, { type: 5, data: {} });
    try {
      const data = await fetchVerifiedGiftCodes();
      if (!data.codes.length) return completeDeferred(interaction.token, { embeds: [brandedEmbed({ title: "No verified active gift codes", description: "There are no active codes currently marked verified. Check again later." })] }, "codes");
      const page = 0;
      const pages = Math.max(1, Math.ceil(data.codes.length / 10));
      return completeDeferred(interaction.token, { embeds: [giftCodesEmbed(data, page)], components: giftCodeComponents(page, pages), allowed_mentions: { parse: [] } }, "codes");
    } catch (error) { return completeDeferred(interaction.token, { content: safe(error.message, "Could not load verified gift codes.") }, "codes"); }
  }
  if (name === "player") {
    const id = String(option(options, "id") || "").trim();
    if (!/^\d{5,20}$/.test(id)) return { content: "Please enter a valid Kingshot Player ID.", flags: 64 };
    acknowledge(res, { type: 5, data: {} });
    console.info("Discord command deferred", { command: name, interactionId: String(interaction.id || "").slice(0, 20) });
    try {
      const lookupStartedAt = Date.now();
      const player = await fetchPlayer(id);
      console.info("Discord player command lookup completed", { durationMs: Date.now() - lookupStartedAt, found: Boolean(player) });
      if (!player) return completeDeferred(interaction.token, { content: "No player was found for that ID." }, "player");
      const data = playerCardData(player, id);
      return completeDeferred(interaction.token, {
        embeds: [playerProfileEmbed(data)],
        components: playerComponents(id),
        allowed_mentions: { parse: [] }
      }, "player");
    } catch (error) {
      return completeDeferred(interaction.token, { content: safe(error.message, "Player lookup failed.") }, "player");
    }
  }
  if (name === "alliance") {
    const kingdomId = String(option(options, "kingdom") || "").trim();
    const query = String(option(options, "search") || "").trim();
    if (!/^[0-9]{1,10}$/.test(kingdomId)) return { content: "Enter a numeric kingdom ID.", flags: 64 };
    acknowledge(res, { type: 5, data: {} });
    try {
      const result = await fetchAllianceApi(req, { mode: "search", kingdomId, q: query });
      const alliances = Array.isArray(result.alliances) ? result.alliances : [];
      if (!alliances.length) return completeDeferred(interaction.token, { content: "No alliances matched that search in kingdom " + kingdomId + "." }, "alliance");
      const pages = Math.max(1, Math.ceil(alliances.length / 25));
      return completeDeferred(interaction.token, { embeds: [alliancePageEmbed(kingdomId, alliances, 0)], components: allianceSearchComponents(kingdomId, alliances, 0, pages, query), allowed_mentions: { parse: [] } }, "alliance");
    } catch (error) { return completeDeferred(interaction.token, { content: safe(error.message, "Alliance lookup failed.") }, "alliance"); }
  }
  if (name === "register") {
    const id = String(option(options, "player_id") || "").trim();
    if (!/^\d{5,20}$/.test(id)) return { content: "Please enter a valid Kingshot Player ID.", flags: 64 };
    acknowledge(res, { type: 5, data: {} });
    try {
      let player = null;
      try { player = await fetchPlayer(id); } catch { /* Optional profile data must not block registration. */ }
      const registrationStartedAt = Date.now();
      const result = await registerPlayer(req, id, player);
      console.info("Discord registration completed", { durationMs: Date.now() - registrationStartedAt, alreadyRegistered: Boolean(result.alreadyRegistered) });
      return completeDeferred(interaction.token, {
        embeds: [registrationEmbed(registrationCardData(result, id, player))],
        allowed_mentions: { parse: [] }
      }, "register");
    } catch (error) {
      return completeDeferred(interaction.token, {
        embeds: [brandedEmbed({ title: "Registration could not be completed", description: safe(error.message, "Please try again later.") })],
      }, "register");
    }
  }
  return { content: "That command is not available.", flags: 64 };
}

async function handleComponent(req, interaction, res) {
  const customId = String(interaction.data?.custom_id || "");
  if (customId.startsWith("ks:")) {
    const parts = customId.split(":");
    const action = parts[1];
    if (action === "alliance-page" && /^[0-9]{1,10}$/.test(parts[2] || "") && /^[0-9]{1,3}$/.test(parts[3] || "")) {
      acknowledge(res, { type: 6 });
      try {
        const kingdomId = parts[2], page = Number(parts[3]);
        const query = parts[4] ? decodeURIComponent(parts[4]) : "";
        const result = await fetchAllianceApi(req, { mode: "search", kingdomId, q: query });
        const alliances = Array.isArray(result.alliances) ? result.alliances : [];
        const pages = Math.max(1, Math.ceil(alliances.length / 25));
        const selected = Math.min(page, pages - 1);
        return editSourceMessage(interaction, { embeds: [alliancePageEmbed(kingdomId, alliances, selected)], components: allianceSearchComponents(kingdomId, alliances, selected, pages, query), allowed_mentions: { parse: [] } });
      } catch (error) { return followup(interaction.token, { content: safe(error.message, "Could not load alliance page."), flags: 64 }); }
    }
    if (action === "codes-page" && /^[0-9]{1,3}$/.test(parts[2] || "")) {
      acknowledge(res, { type: 6 });
      try {
        const data = await fetchVerifiedGiftCodes();
        const pages = Math.max(1, Math.ceil(data.codes.length / 10));
        const page = Math.min(Number(parts[2]), pages - 1);
        return editSourceMessage(interaction, { embeds: [giftCodesEmbed(data, page)], components: giftCodeComponents(page, pages), allowed_mentions: { parse: [] } });
      } catch (error) { return followup(interaction.token, { content: safe(error.message, "Could not refresh verified codes."), flags: 64 }); }
    }
    if (action === "alliance" && /^[0-9]{1,10}$/.test(parts[2] || "")) {
      acknowledge(res, { type: 6 });
      try {
        const kingdomId = parts[2];
        const tag = String(interaction.data?.values?.[0] || "");
        if (!/^[A-Za-z0-9_-]{1,20}$/.test(tag)) throw Error("Choose a valid alliance.");
        const data = await fetchAllianceApi(req, { kingdomId, tag });
        const totalPages = Math.max(1, Math.ceil(data.members.length / 10));
        const page = 0;
        return editSourceMessage(interaction, {
          embeds: [rosterEmbed(data, page)],
          components: rosterComponents(kingdomId, tag, data.members, page, totalPages),
          allowed_mentions: { parse: [] }
        });
      } catch (error) {
        return followup(interaction.token, { content: safe(error.message, "Could not load this alliance roster."), flags: 64 });
      }
    }
    if (action === "page" && /^[0-9]{1,10}$/.test(parts[2] || "") && /^[A-Za-z0-9_-]{1,20}$/.test(parts[3] || "") && /^[0-9]{1,3}$/.test(parts[4] || "")) {
      acknowledge(res, { type: 6 });
      try {
        const kingdomId = parts[2], tag = parts[3];
        const data = await fetchAllianceApi(req, { kingdomId, tag });
        const totalPages = Math.max(1, Math.ceil(data.members.length / 10));
        const page = Math.min(Number(parts[4]), totalPages - 1);
        return editSourceMessage(interaction, {
          embeds: [rosterEmbed(data, page)],
          components: rosterComponents(kingdomId, tag, data.members, page, totalPages),
          allowed_mentions: { parse: [] }
        });
      } catch (error) {
        return followup(interaction.token, { content: safe(error.message, "Could not load this roster page."), flags: 64 });
      }
    }
    if (action === "alliances" && /^[0-9]{1,10}$/.test(parts[2] || "")) {
      acknowledge(res, { type: 6 });
      try {
        const kingdomId = parts[2];
        const result = await fetchAllianceApi(req, { mode: "search", kingdomId });
        const alliances = Array.isArray(result.alliances) ? result.alliances : [];
        if (!alliances.length) return editSourceMessage(interaction, { content: "No alliances are currently available.", embeds: [], components: [] });
        return editSourceMessage(interaction, {
          embeds: [brandedEmbed({ title: "Kingdom " + kingdomId + " alliances", description: "Choose an alliance to open its roster.", fields: alliances.slice(0, 10).map(a => field("[" + a.tag + "] " + a.name, "Power " + (a.power == null ? "—" : formatPower(a.power)) + " · " + (a.memberCount ?? "—") + " members")) })],
          components: allianceSearchComponents(kingdomId, alliances, 0, Math.max(1, Math.ceil(alliances.length / 25))),
          allowed_mentions: { parse: [] }
        });
      } catch (error) {
        return followup(interaction.token, { content: safe(error.message, "Could not return to alliance search."), flags: 64 });
      }
    }
    if (action === "member" && /^[0-9]{1,10}$/.test(parts[2] || "") && /^[A-Za-z0-9_-]{1,20}$/.test(parts[3] || "") && /^[0-9]{1,3}$/.test(parts[4] || "")) {
      const kingdomId = parts[2], tag = parts[3], page = Number(parts[4]);
      const playerId = String(interaction.data?.values?.[0] || "");
      if (!/^[0-9]{5,20}$/.test(playerId)) return acknowledge(res, { type: 4, data: { content: "Choose a valid roster member.", flags: 64 } });
      acknowledge(res, { type: 6 });
      try {
        const player = await fetchPlayer(playerId);
        if (!player) throw Error("This governor could not be found.");
        const data = playerCardData(player, playerId);
        const components = playerComponents(playerId);
        components.push({ type: 1, components: [{ type: 2, style: 2, custom_id: "ks:back:" + kingdomId + ":" + tag + ":" + page, label: "Back to roster", emoji: { name: "↩️" } }] });
        return editSourceMessage(interaction, { embeds: [playerProfileEmbed(data)], components, allowed_mentions: { parse: [] } });
      } catch (error) {
        return followup(interaction.token, { content: safe(error.message, "Could not load this governor profile."), flags: 64 });
      }
    }
    if (action === "back" && /^[0-9]{1,10}$/.test(parts[2] || "") && /^[A-Za-z0-9_-]{1,20}$/.test(parts[3] || "") && /^[0-9]{1,3}$/.test(parts[4] || "")) {
      acknowledge(res, { type: 6 });
      try {
        const kingdomId = parts[2], tag = parts[3], page = Number(parts[4]);
        const data = await fetchAllianceApi(req, { kingdomId, tag });
        const totalPages = Math.max(1, Math.ceil(data.members.length / 10));
        const selectedPage = Math.min(page, totalPages - 1);
        return editSourceMessage(interaction, {
          embeds: [rosterEmbed(data, selectedPage)],
          components: rosterComponents(kingdomId, tag, data.members, selectedPage, totalPages),
          allowed_mentions: { parse: [] }
        });
      } catch (error) {
        return followup(interaction.token, { content: safe(error.message, "Could not return to the roster."), flags: 64 });
      }
    }
  }
  const [prefix, action, id] = customId.split(":");
  if (prefix !== "ks" || !/^[0-9]{5,20}$/.test(id || "")) {
    return acknowledge(res, { type: 4, data: { content: "This action is invalid or has expired.", flags: 64 } });
  }
  if (action === "refresh") {
    acknowledge(res, { type: 6 });
    try {
      const player = await fetchPlayer(id, true);
      if (!player) return editSourceMessage(interaction, { content: "No player was found for this ID.", embeds: [], components: [] });
      return editSourceMessage(interaction, { embeds: [playerProfileEmbed(playerCardData(player, id))], components: playerComponents(id), allowed_mentions: { parse: [] } });
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
      await completeDeferred(interaction.token, {
        embeds: [registrationEmbed(registrationCardData(result, id, player))],
        allowed_mentions: { parse: [] }
      }, "register-button");
      if (!result.alreadyRegistered) await editSourceMessage(interaction, { components: playerComponents(id, true) }).catch(() => {});
      return { delivered: true };
    } catch (error) {
      return completeDeferred(interaction.token, { embeds: [brandedEmbed({ title: "Registration could not be completed", description: safe(error.message, "Please try again later.") })], }, "register-button");
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
  const applicationId = String(interaction.application_id || "");
  if (/^[0-9]{5,25}$/.test(applicationId)) appIdCache = applicationId;
  if (interaction.type === 1) return res.status(200).json({ type: 1 });
  try {
    if (interaction.type === 2) {
      // handleCommand sends the type-5 defer synchronously, before its first
      // awaited lookup. Once headers are sent, hand the remaining promise to
      // Vercel waitUntil rather than keeping it as a detached serverless task.
      const commandTask = handleCommand(req, interaction, res);
      if (res.headersSent) {
        retainAfterAcknowledgement(commandTask, interaction, "slash-command");
        return;
      }
      const result = await commandTask;
      if (res.headersSent) return;
      if (result?.delivered) return res.status(200).end();
      if (result?.content || result?.embeds) return res.status(200).json({ type: 4, data: result });
      return res.status(200).end();
    }
    if (interaction.type === 3) {
      // Buttons/select menus also acknowledge synchronously before I/O.
      const componentTask = handleComponent(req, interaction, res);
      if (res.headersSent) {
        retainAfterAcknowledgement(componentTask, interaction, "message-component");
        return;
      }
      await componentTask;
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
