import crypto from "node:crypto";

const DISCORD_API = "https://discord.com/api/v10";
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || process.env.DISCORD_APPLICATION_PUBLIC_KEY || "";
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "";
const MAX_BODY_BYTES = 1_000_000;
const MAX_TIMESTAMP_AGE_SECONDS = 5 * 60;
const APP_BASE_URL = (process.env.APP_BASE_URL || "https://kingshot-autoredeemer.vercel.app").replace(/\/+$/, "");

interface RequestLike {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: "data", listener: (chunk: Buffer | string) => void): this;
  on(event: "end", listener: () => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

interface ResponseLike {
  status(code: number): this;
  json(body: unknown): this;
  send(body: string): this;
  end(): this;
}

type JsonRecord = Record<string, unknown>;
interface CommandOption {
  name: string;
  value?: unknown;
}
interface DiscordInteraction {
  id: string;
  token: string;
  type: number;
  data?: {
    name?: string;
    options?: CommandOption[];
  };
}
interface PlayerRecord extends JsonRecord {
  alliance?: JsonRecord | null;
}
interface EmbedField {
  name: string;
  value: string;
  inline: boolean;
}
interface PlayerEmbed {
  title: string;
  description: string;
  color: number;
  thumbnail?: { url: string };
  fields: EmbedField[];
  footer: { text: string };
}
type InteractionResult = Response | {
  content?: string;
  embeds?: unknown[];
  flags?: number;
  status?: number;
  ok?: boolean;
};

class RequestBodyTooLargeError extends Error {
  readonly statusCode = 413;
  constructor() {
    super("Interaction request body is too large.");
    this.name = "RequestBodyTooLargeError";
  }
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function getRawBody(req: RequestLike): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    req.on("data", (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        chunks.length = 0;
        reject(new RequestBodyTooLargeError());
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function isFreshTimestamp(timestamp: string, nowMs = Date.now()): boolean {
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds)) return false;
  return Math.abs(Math.floor(nowMs / 1000) - seconds) <= MAX_TIMESTAMP_AGE_SECONDS;
}

function verifySignature(timestamp: string, raw: string, signature: string): boolean {
  if (!PUBLIC_KEY || !timestamp || !signature || !/^[a-f\d]{128}$/i.test(signature)) return false;
  try {
    const keyBytes = Buffer.from(PUBLIC_KEY, "hex");
    if (keyBytes.length !== 32) return false;
    const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), keyBytes]);
    return crypto.verify(
      null,
      Buffer.from(timestamp + raw),
      crypto.createPublicKey({ key: der, format: "der", type: "spki" }),
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}

function option(options: CommandOption[] | undefined, name: string): unknown {
  return options?.find((item) => item.name === name)?.value;
}

function field(name: string, value: unknown, inline = true): EmbedField {
  return { name, value: String(value ?? "—").slice(0, 1024), inline };
}

function safe(value: unknown, fallback = "—"): string {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function formatPower(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return safe(value);
  if (number >= 1e9) return (number / 1e9).toFixed(2) + "B";
  if (number >= 1e6) return (number / 1e6).toFixed(2) + "M";
  if (number >= 1e3) return (number / 1e3).toFixed(1) + "K";
  return String(number);
}

async function discordRequest(path: string, method = "POST", body?: unknown): Promise<Response> {
  if (!BOT_TOKEN) throw new Error("Discord bot is not configured.");
  return fetch(DISCORD_API + path, {
    method,
    headers: { Authorization: "Bot " + BOT_TOKEN, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
}

async function interactionCallback(id: string, token: string, body: unknown): Promise<Response> {
  return fetch(DISCORD_API + "/interactions/" + encodeURIComponent(id) + "/" + encodeURIComponent(token) + "/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
}

let appIdCache: string | null = null;
async function getApplicationId(): Promise<string> {
  if (appIdCache) return appIdCache;
  const response = await discordRequest("/users/@me", "GET");
  if (!response.ok) throw new Error("Discord bot authentication failed.");
  const data = asRecord(await response.json());
  if (typeof data.id !== "string" && typeof data.id !== "number") {
    throw new Error("Discord bot identity response was invalid.");
  }
  appIdCache = String(data.id);
  return appIdCache;
}

async function followup(token: string, body: unknown): Promise<Response> {
  const applicationId = await getApplicationId();
  return fetch(DISCORD_API + "/webhooks/" + encodeURIComponent(applicationId) + "/" + encodeURIComponent(token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
}

async function fetchPlayer(id: string): Promise<PlayerRecord | null> {
  const key = process.env.MIGHTPULSE_API_KEY || process.env.KSS_API_KEY;
  if (!key) throw new Error("MightPulse API key is not configured.");
  const response = await fetch("https://api.mightpulse.com/v1/players/" + encodeURIComponent(id) + "?include=base", {
    headers: { Authorization: "Bearer " + key },
    signal: AbortSignal.timeout(15000),
  });
  const data = asRecord(await response.json().catch(() => null));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(safe(data.message || data.error, "MightPulse could not load this player."));
  return asRecord(data.player || data) as PlayerRecord;
}

async function registerPlayer(id: string): Promise<JsonRecord> {
  let target: URL;
  try {
    target = new URL("/api/kingshot-register", APP_BASE_URL);
  } catch {
    throw new Error("Registration service URL is not configured correctly.");
  }
  if (target.protocol !== "https:") throw new Error("Registration service must use HTTPS.");
  const response = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId: id }),
    signal: AbortSignal.timeout(20000),
  });
  const data = asRecord(await response.json().catch(() => null));
  if (!response.ok) throw new Error(safe(data.error, "Could not register this player."));
  return data;
}

function playerEmbed(player: PlayerRecord, privateView: boolean): PlayerEmbed {
  const alliance = asRecord(player.alliance);
  const id = safe(player.governor_id || player.fid || player.uid);
  const avatar = safe(player.avatar_url, "");
  let thumbnail: { url: string } | undefined;
  if (avatar) {
    try {
      const url = new URL(avatar);
      if (url.protocol === "https:") thumbnail = { url: url.toString() };
    } catch {
      // Ignore malformed avatar URLs; player details remain useful without an image.
    }
  }
  const embed: PlayerEmbed = {
    title: "👤 Kingshot Player",
    description: "MightPulse player lookup",
    color: 0x5865F2,
    ...(thumbnail ? { thumbnail } : {}),
    fields: [
      field("Name", safe(player.nick_name || player.name)),
      field("Kingdom", safe(player.kid)),
      field("Power", formatPower(player.power)),
      field("Town Center", safe(player.town_center_level)),
      field("VIP", safe(player.vip)),
      field("Alliance", alliance.name ? String(alliance.name) + " [" + safe(alliance.abbr) + "]" : "—"),
      field("Alliance Rank", safe(alliance.rank_label || alliance.rank)),
      field("Kills", formatPower(player.kills)),
      field("Coordinates", player.x != null && player.y != null ? String(player.x) + " / " + String(player.y) : "—"),
      field("Online", player.online ? "Yes" : "No"),
    ],
    footer: { text: "MightPulse data · Kingshot Auto Redeem" },
  };
  if (privateView) embed.fields.unshift(field("Player ID", id, false));
  return embed;
}

async function handleCommand(req: RequestLike, interaction: DiscordInteraction): Promise<InteractionResult> {
  const name = String(interaction.data?.name || "");
  const options = interaction.data?.options;
  if (name === "player") {
    const id = String(option(options, "id") || "").trim();
    if (!/^\d{5,20}$/.test(id)) return { content: "❌ Enter a valid Kingshot Player ID.", flags: 64 };
    await interactionCallback(interaction.id, interaction.token, { type: 5, data: {} });
    try {
      const player = await fetchPlayer(id);
      if (!player) return followup(interaction.token, { content: "❌ Player not found." });
      return followup(interaction.token, { embeds: [playerEmbed(player, false)] });
    } catch (error) {
      return followup(interaction.token, { content: "❌ " + safe(error instanceof Error ? error.message : error, "Player lookup failed.") });
    }
  }
  if (name === "register") {
    const id = String(option(options, "player_id") || "").trim();
    if (!/^\d{5,20}$/.test(id)) return { content: "❌ Enter a valid Kingshot Player ID.", flags: 64 };
    await interactionCallback(interaction.id, interaction.token, { type: 5, data: { flags: 64 } });
    try {
      const data = await registerPlayer(id);
      const player = asRecord(data.player);
      const kingdom = data.verifiedKingdomId || player.kingdom_id || player.kid;
      const status = data.registrationStatus || "REGISTERED";
      return followup(interaction.token, {
        content: "✅ **Auto-redeem enabled**\nRegistration: **" + safe(status) + "**\nKingdom: **" + safe(kingdom) + "**\n\nEligible gift codes will be processed automatically.",
        flags: 64,
      });
    } catch (error) {
      return followup(interaction.token, { content: "❌ " + safe(error instanceof Error ? error.message : error, "Registration failed."), flags: 64 });
    }
  }
  return { content: "Unknown command.", flags: 64 };
}

export const config = { api: { bodyParser: false } };

export default async function handler(req: RequestLike, res: ResponseLike): Promise<unknown> {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const timestamp = String(req.headers["x-signature-timestamp"] || "");
  const signature = String(req.headers["x-signature-ed25519"] || "");
  if (!isFreshTimestamp(timestamp)) return res.status(401).send("stale request timestamp");
  if (!PUBLIC_KEY || !signature) return res.status(401).send("invalid request signature");

  let raw: string;
  try {
    raw = await getRawBody(req);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return res.status(413).json({ error: error.message });
    return res.status(400).json({ error: "Could not read interaction request." });
  }

  if (!verifySignature(timestamp, raw, signature)) return res.status(401).send("invalid request signature");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }
  const interaction = asRecord(parsed) as DiscordInteraction;
  if (interaction.type === 1) return res.status(200).json({ type: 1 });
  if (interaction.type !== 2 || typeof interaction.id !== "string" || typeof interaction.token !== "string") {
    return res.status(400).json({ error: "Unsupported interaction" });
  }

  try {
    const result = await handleCommand(req, interaction);
    if (result instanceof Response) return res.status(200).end();
    if (result.ok === false) return res.status(500).end();
    if (result.content || result.embeds) return res.status(200).json({ type: 4, data: result });
    return res.status(200).end();
  } catch (error) {
    try {
      await interactionCallback(interaction.id, interaction.token, {
        type: 4,
        data: { content: "❌ " + safe(error instanceof Error ? error.message : error, "Something went wrong."), flags: 64 },
      });
    } catch {
      // The interaction token may already be expired; the original request still needs a response.
    }
    return res.status(200).end();
  }
}
