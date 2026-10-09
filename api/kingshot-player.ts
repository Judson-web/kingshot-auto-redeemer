import { rateLimit } from "../lib/request-rate-limit.ts";
import { isValidPlayerId, lookupPlayer, normalizePlayerId, PlayerLookupError } from "../internal/kingshot/player.ts";
interface RequestLike { url?: string; method?: string; query?: Record<string, unknown>; headers: Record<string, string | string[] | undefined>; }
interface ResponseLike { status(code: number): ResponseLike; json(body: unknown): ResponseLike; setHeader(name: string, value: string): void; }
export default async function handler(req: RequestLike, res: ResponseLike): Promise<void> {
 if (req.method !== "GET") return void res.status(405).json({ error: "Method not allowed" });
 if (!rateLimit(req, res, "player-lookup", 30, 60000)) return;
 const id = normalizePlayerId(new URL(req.url || "/", "http://localhost").searchParams.get("id"));
 if (!isValidPlayerId(id)) return void res.status(400).json({ error: "Invalid player ID." });
 try { const player = await lookupPlayer(id); res.status(200).json({ player }); }
 catch (error) { const typed = error as PlayerLookupError;
  if (typed.status === 404) return void res.status(404).json({ error: typed.message || "MightPulse could not find this player." });
  if (/timed out|abort/i.test(typed.message || "")) return void res.status(504).json({ error: "MightPulse request timed out." });
  res.status(502).json({ error: typed.message || "MightPulse request failed." });
 }
}
