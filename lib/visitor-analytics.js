import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const COOKIE = "__Host-ks_admin_session";
const FALLBACK_COOKIE = "ks_admin_session";

function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function getCookie(req) {
  const parts = String(req.headers.cookie || "").split(";").map(x => x.trim());
  for (const name of [COOKIE, FALLBACK_COOKIE]) {
    const part = parts.find(x => x.startsWith(name + "="));
    if (part) { try { return decodeURIComponent(part.slice(name.length + 1)); } catch { return ""; } }
  }
  return "";
}
async function rpc(name, body) {
  const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(7000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Error(data?.message || "Analytics service unavailable.");
  return data;
}
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
  if (!SUPABASE_KEY) return res.status(503).json({ error: "Analytics service is not configured." });
  try {
    const session = getCookie(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    const valid = await rpc("kingshot_admin_validate_session", { p_token_hash: hash(session) });
    if (!valid) return res.status(401).json({ error: "Unauthorized" });
    const url = new URL(req.url || "/", "http://localhost");
    const rawDays = Number(url.searchParams.get("days") || 7);
    const days = Number.isInteger(rawDays) ? Math.max(1, Math.min(30, rawDays)) : 7;
    const analytics = await rpc("kingshot_visitor_analytics", { p_days: days });
    return res.status(200).json(analytics && typeof analytics === "object" ? analytics : {});
  } catch (error) {
    console.error("Private visitor analytics failed:", error?.message || error);
    return res.status(502).json({ error: "Could not load visitor analytics." });
  }
}
