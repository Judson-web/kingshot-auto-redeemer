import { rateLimit } from "../lib/request-rate-limit.js";

interface RequestLike {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}
interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): ResponseLike;
  setHeader(name: string, value: string): void;
}
interface SupportTicket {
  player_id?: unknown;
  status?: unknown;
  reason?: unknown;
  [key: string]: unknown;
}
const SUPABASE_URL = process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_KINGSHOT_WEBHOOK_URL || process.env.DISCORD_SCRAPER_WEBHOOK_URL;

async function notifySupport(ticket: SupportTicket | null | undefined): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) return;
  const payload = {
    username: "Kingshot Auto Redeem",
    allowed_mentions: { parse: [] as string[] },
    embeds: [{
      title: "🎫 New support request",
      description: "A new support ticket is waiting for review.",
      color: 0x5865F2,
      fields: [
        { name: "Player ID", value: String(ticket?.player_id || "Unknown"), inline: true },
        { name: "Status", value: String(ticket?.status || "PENDING"), inline: true },
        { name: "Reason", value: String(ticket?.reason || "No reason").slice(0, 900), inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: "Kingshot Support" },
    }],
  };
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(7000),
    });
  } catch (error: unknown) {
    console.error("Support Discord notification failed:", error instanceof Error ? error.message : error);
  }
}

export default async function handler(req: RequestLike, res: ResponseLike): Promise<unknown> {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!rateLimit(req, res, "support", 6, 60000)) {
    return res.status(429).json({ error: "Too many support requests. Please try again shortly." });
  }

  try {
    const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const playerId = String(body.playerId || "").trim();
    const reason = String(body.reason || "").trim().slice(0, 1000);
    if (!/^[0-9]{5,20}$/.test(playerId)) {
      return res.status(400).json({ error: "Enter a valid Player ID." });
    }
    if (reason.length < 5) {
      return res.status(400).json({ error: "Please provide a little more detail about the request." });
    }
    const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/submit_kingshot_support_ticket", {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY || "",
        authorization: "Bearer " + (SUPABASE_KEY || ""),
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_player_id: playerId, p_reason: reason }),
      signal: AbortSignal.timeout(8000),
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = data && typeof data === "object" && "message" in data && typeof data.message === "string"
        ? data.message
        : "Could not submit the support request.";
      return res.status(400).json({ error: message });
    }
    const ticket = (Array.isArray(data) ? data[0] : data) as SupportTicket | null | undefined;
    await notifySupport(ticket);
    return res.status(200).json({ ok: true, ticket });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Support service unavailable.";
    return res.status(502).json({ error: message || "Support service unavailable." });
  }
}
