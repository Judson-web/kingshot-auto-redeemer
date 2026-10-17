import { rateLimit } from "../lib/request-rate-limit.js";
import developerApi from "../lib/developer-api.js";
import developerApiV3 from "../lib/developer-api-v3.js";
import developerAuth from "../lib/developer-auth.js";
import developerAccount from "../lib/developer-account.js";
import { isValidPlayerId, lookupPlayer, normalizePlayerId, PlayerLookupError } from "../internal/kingshot/player.js";
interface RequestLike { url?: string; method?: string; query?: Record<string, unknown>; headers: Record<string, string | string[] | undefined>; body?: Record<string, unknown>; }
interface ResponseLike { status(code: number): ResponseLike; json(body: unknown): ResponseLike; setHeader(name: string, value: string): void; }
function sendError(res: ResponseLike, status: number, code: string, message: string, requestId: string): void { res.setHeader("X-Request-Id", requestId); res.status(status).json({ error: message, code, meta: { requestId, timestamp: new Date().toISOString() } }); }
export default async function handler(req: RequestLike, res: ResponseLike): Promise<void> {
 const requestId = globalThis.crypto?.randomUUID?.() || `req-${Date.now().toString(36)}`;
 res.setHeader("X-Request-Id", requestId);
 const requestUrl = new URL(req.url || "/", "http://localhost");
 const developerPath = String(req.query?.developerPath || requestUrl.searchParams.get("developerPath") || req.query?.developer || requestUrl.searchParams.get("developer") || "").replace(/^\/+|\/+$/g, "");
 if (developerPath === "account-auth") return developerAuth(req, res);
 if (developerPath === "account-keys") return developerAccount(req, res);
 if (developerPath.startsWith("v3-")) return developerApiV3(req, res, developerPath.slice(3));
 if (developerPath) return developerApi(req, res, developerPath);
 if (req.method !== "GET") { res.setHeader("Allow", "GET"); return void sendError(res, 405, "method_not_allowed", "Method not allowed.", requestId); }
 if (!rateLimit(req, res, "player-lookup", 30, 60000)) return void sendError(res, 429, "rate_limit_exceeded", "Too many player lookups. Retry after the indicated delay.", requestId);
 const id = normalizePlayerId(new URL(req.url || "/", "http://localhost").searchParams.get("id"));
 if (!isValidPlayerId(id)) return void sendError(res, 400, "invalid_player_id", "Player ID must contain 5–20 digits.", requestId);
 try { const player = await lookupPlayer(id); res.status(200).json({ player, data: { player }, meta: { requestId, timestamp: new Date().toISOString(), fetchedAt: new Date().toISOString(), source: "mightpulse", stale: false } }); }
 catch (error) { const typed = error as PlayerLookupError;
  if (typed.status === 404) return void sendError(res, 404, "player_not_found", "MightPulse could not find this player.", requestId);
  if (/timed out|abort/i.test(typed.message || "")) return void sendError(res, 504, "upstream_timeout", "MightPulse request timed out.", requestId);
  sendError(res, typed.status === 503 ? 503 : 502, "upstream_unavailable", "Player lookup provider is unavailable.", requestId);
 }
}
