import { rateLimit } from "../lib/request-rate-limit.js";
import { normalizeRegistrationInput, registerPlayer } from "../internal/kingshot/register.js";
import { attachDevMetadata } from "../lib/developer-contact.js";
import { isAuthenticatedProfileRequest } from "../lib/developer-auth.js";
interface RequestLike { method?: string; body?: Record<string, unknown>; headers: Record<string, string | string[] | undefined>; }
interface ResponseLike { status(code: number): ResponseLike; json(body: unknown): ResponseLike; setHeader(name: string, value: string): void; }
export default async function handler(req: RequestLike, res: ResponseLike): Promise<void> {
 attachDevMetadata(res);
 if (req.method !== "POST") return void res.status(405).json({ error: "Method not allowed" });
 if (String(req.headers["x-alliance-registration"] || "") === "1" && !(await isAuthenticatedProfileRequest(req))) return void res.status(401).json({ error: "Sign in with Discord to register alliance members.", code: "authentication_required" });
 if (!rateLimit(req, res, "register", 60, 60000)) return void res.status(429).json({ error: "Too many registration requests. Retry after the indicated delay.", code: "rate_limit_exceeded" });
 const input = normalizeRegistrationInput(req.body || {});
 if (!/^\d{5,20}$/.test(input.playerId)) return void res.status(400).json({ error: "Use the numeric Player ID shown in Kingshot under Profile → Info. It must contain 5–20 digits; your kingdom number is different.", code: "invalid_player_id" });
 if (input.kingdomId && !/^\d{1,10}$/.test(input.kingdomId)) return void res.status(400).json({ error: "Kingdom ID must contain 1–10 digits.", code: "invalid_kingdom_id" });
 try { return void res.status(200).json(await registerPlayer(input)); }
 catch (error) { const typed=error as {message?:string;status?:number;code?:string;banned?:boolean;ban?:unknown}; if(typed.code==="player_banned")return void res.status(403).json({error:typed.message||"This Player ID is blocked from registration.",code:"player_banned",banned:true,ban:typed.ban||null}); if(typed.status===403)return void res.status(403).json({error:typed.message||"Registration is not permitted."}); const message = error instanceof Error ? error.message : "Registration service timed out."; return void res.status(504).json({ error: message === "Could not register this player." ? message : "Registration service timed out." }); }
}
