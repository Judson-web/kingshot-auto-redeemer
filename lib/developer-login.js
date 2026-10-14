import crypto from "node:crypto";
import { rateLimit } from "./request-rate-limit.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const COOKIE = "__Host-ks_developer_session";
const hash = value => crypto.createHash("sha256").update(String(value ?? "").normalize("NFKC").replace(/\s+/g, ""), "utf8").digest("hex");
const token = () => crypto.randomBytes(32).toString("hex");
function getCookie(req) {
  const raw = String(req.headers.cookie || "");
  const part = raw.split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE + "="));
  if (!part) return "";
  try { return decodeURIComponent(part.slice(COOKIE.length + 1)); } catch { return ""; }
}
function setCookie(res, value, maxAge) {
  res.setHeader("Set-Cookie", COOKIE + "=" + encodeURIComponent(value) + "; Max-Age=" + maxAge + "; Path=/; HttpOnly; Secure; SameSite=Strict");
}
function clearCookie(res) {
  res.setHeader("Set-Cookie", COOKIE + "=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict");
}
async function rpc(name, body) {
  if (!SUPABASE_KEY) throw new Error("Developer authentication is not configured.");
  const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, authorization: "Bearer " + SUPABASE_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || "Developer authentication service unavailable.");
  return data;
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!["POST", "DELETE", "GET"].includes(req.method)) return res.status(405).json({ error: "Method not allowed." });
  try {
    if (req.method === "GET") {
      const session = getCookie(req);
      if (!session) return res.status(401).json({ authenticated: false });
      const ok = await rpc("kingshot_developer_list_keys", { p_admin_token_hash: hash(session) });
      return res.status(200).json({ authenticated: true, keys: Array.isArray(ok) ? ok : [] });
    }
    if (req.method === "DELETE") {
      const session = getCookie(req);
      if (session) await rpc("kingshot_developer_logout", { p_token_hash: hash(session) }).catch(() => {});
      clearCookie(res);
      return res.status(200).json({ ok: true });
    }
    if (!rateLimit(req, res, "developer-login", 5, 900000)) return res.status(429).json({ error: "Too many developer login attempts. Try again later." });
    const accessKey = String(req.body?.accessKey || "").normalize("NFKC").replace(/\s+/g, "");
    if (!accessKey) return res.status(400).json({ error: "Developer passkey is required." });
    const session = token();
    const ok = await rpc("kingshot_developer_create_session_with_key", { p_key_hash: hash(accessKey), p_token_hash: hash(session) });
    if (!ok) return res.status(401).json({ error: "Invalid developer passkey." });
    setCookie(res, session, 43200);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("[developer-login] authentication request failed", error instanceof Error ? error.message : "unknown error");
    return res.status(502).json({ error: "Developer authentication service is unavailable." });
  }
}
