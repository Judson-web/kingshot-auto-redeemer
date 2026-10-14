import crypto from "node:crypto";
import { rateLimit } from "./request-rate-limit.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const COOKIE = "__Host-ks_developer_session";
const hash = (value: string) => crypto.createHash("sha256").update(String(value ?? "").normalize("NFKC").replace(/\s+/g, ""), "utf8").digest("hex");
const token = () => crypto.randomBytes(32).toString("hex");
function getCookie(req: RequestLike): string {
  const raw = String(req.headers.cookie || "");
  const part = raw.split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE + "="));
  if (!part) return "";
  try { return decodeURIComponent(part.slice(COOKIE.length + 1)); } catch { return ""; }
}
function setCookie(res: ResponseLike, value: string, maxAge: number): void {
  res.setHeader("Set-Cookie", COOKIE + "=" + encodeURIComponent(value) + "; Max-Age=" + maxAge + "; Path=/; HttpOnly; Secure; SameSite=Strict");
}
function clearCookie(res: ResponseLike): void {
  res.setHeader("Set-Cookie", COOKIE + "=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict");
}
async function rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
  if (!SUPABASE_KEY) throw new Error("Developer authentication is not configured.");
  const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, authorization: "Bearer " + SUPABASE_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  });
  const data: any = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || "Developer authentication service unavailable.");
  return data;
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!["POST", "DELETE", "GET"].includes(String(req.method))) { res.status(405).json({ error: "Method not allowed." }); return; }
  try {
    if (req.method === "GET") {
      const session = getCookie(req);
      if (!session) { res.status(401).json({ authenticated: false }); return; }
      const keys = await rpc("kingshot_developer_list_keys", { p_admin_token_hash: hash(session) });
      res.status(200).json({ authenticated: true, keys: Array.isArray(keys) ? keys : [] });
      return;
    }
    if (req.method === "DELETE") {
      const session = getCookie(req);
      if (session) await rpc("kingshot_developer_logout", { p_token_hash: hash(session) }).catch(() => {});
      clearCookie(res);
      res.status(200).json({ ok: true });
      return;
    }
    if (!rateLimit(req, res, "developer-login", 5, 900000)) { res.status(429).json({ error: "Too many developer login attempts. Try again later." }); return; }
    const accessKey = String(req.body?.accessKey || "").normalize("NFKC").replace(/\s+/g, "");
    if (!accessKey) { res.status(400).json({ error: "Developer passkey is required." }); return; }
    const session = token();
    const ok = await rpc("kingshot_developer_create_session_with_key", { p_key_hash: hash(accessKey), p_token_hash: hash(session) });
    if (ok !== true) { res.status(401).json({ error: "Invalid developer passkey." }); return; }
    setCookie(res, session, 43200);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[developer-login] authentication request failed", error instanceof Error ? error.message : "unknown error");
    res.status(502).json({ error: "Developer authentication service is unavailable." });
  }
}
