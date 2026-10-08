import { rateLimit } from "../lib/request-rate-limit.js";
import { normalizeRegistrationInput, registerPlayer } from "../internal/kingshot/register.js";
interface RequestLike { method?: string; body?: Record<string, unknown>; headers?: Record<string, unknown>; }
interface ResponseLike { status(code: number): ResponseLike; json(body: unknown): ResponseLike; }
export default async function handler(req: RequestLike, res: ResponseLike): Promise<void> {
 if (req.method !== "POST") return void res.status(405).json({ error: "Method not allowed" });
 if (!rateLimit(req, res, "register", 60, 60000)) return;
 const input = normalizeRegistrationInput(req.body || {});
 if (!/^\d{5,20}$/.test(input.playerId)) return void res.status(400).json({ error: "Invalid player ID." });
 if (input.kingdomId && !/^\d{1,10}$/.test(input.kingdomId)) return void res.status(400).json({ error: "Invalid kingdom ID." });
 try { return void res.status(200).json(await registerPlayer(input)); }
 catch (error) { const message = error instanceof Error ? error.message : "Registration service timed out."; return void res.status(504).json({ error: message === "Could not register this player." ? message : "Registration service timed out." }); }
}
