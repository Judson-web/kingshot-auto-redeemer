import {isIP} from "node:net";
import {rateLimit} from "./request-rate-limit.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const SITE_HOST = "kingshot-autoredeemer.vercel.app";
function clean(value, max = 180) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) || null : null;
}
function classifyAgent(ua) {
  const value = ua || "";
  let browser = "Other";
  if (/Edg\//i.test(value)) browser = "Edge";
  else if (/OPR\//i.test(value)) browser = "Opera";
  else if (/SamsungBrowser\//i.test(value)) browser = "Samsung Internet";
  else if (/Firefox\//i.test(value)) browser = "Firefox";
  else if (/CriOS\//i.test(value)) browser = "Chrome (iOS)";
  else if (/Chrome\//i.test(value)) browser = "Chrome";
  else if (/FxiOS\//i.test(value)) browser = "Firefox (iOS)";
  else if (/Safari\//i.test(value) && !/Chrome\//i.test(value)) browser = "Safari";
  let os = "Other";
  if (/Android/i.test(value)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(value)) os = "iOS";
  else if (/Windows/i.test(value)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(value)) os = "macOS";
  else if (/Linux/i.test(value)) os = "Linux";
  const device = /bot|crawler|spider|slurp|headless/i.test(value) ? "bot" :
    /iPad|Tablet/i.test(value) ? "tablet" :
    /Mobile|Android|iPhone|iPod/i.test(value) ? "mobile" : "desktop";
  return {browser, operating_system: os, device_type: device};
}
function requestIp(req) {
  const platformIp = String(req.headers["x-real-ip"] || "").trim();
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",").map(value => value.trim()).filter(Boolean);
  const candidate = platformIp || forwarded[forwarded.length - 1] || "";
  return isIP(candidate) ? candidate : null;
}
export default async function visitorTelemetry(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "GET") {
    res.setHeader("Vary", "x-vercel-ip-country");
    // Lightweight locale lookup reuses this existing function, staying within
    // Vercel Hobby's serverless-function limit. Return country only, never IP.
    const headers = req.headers && typeof req.headers === "object" ? req.headers : {};
    const rawCountry = headers["x-vercel-ip-country"];
    const country = typeof rawCountry === "string" ? rawCountry.trim().toUpperCase() : "";
    const countryCode = /^[A-Z]{2}$/.test(country) ? country : null;
    return res.status(200).json({countryCode});
  }
  res.setHeader("Vary", "Origin");
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({error: "Method not allowed"}); }
  const origin = String(req.headers.origin || "");
  let originHost = "";
  try { originHost = new URL(origin).host.toLowerCase(); } catch {}
  const requestHost = String(req.headers.host || "").toLowerCase();
  if (!originHost || originHost !== requestHost || ![SITE_HOST, "localhost:3000", "localhost:5173"].includes(originHost)) return res.status(403).json({error: "Origin not allowed"});
  if (!rateLimit(req, res, "visitor-telemetry", 12, 60000)) return res.status(429).json({error: "Too many telemetry requests"});
  if (!SUPABASE_KEY) return res.status(503).json({error: "Telemetry storage is not configured"});
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const path = clean(body.path, 180);
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("?") || path.includes("#")) return res.status(400).json({error: "Invalid page path"});
  const ua = clean(req.headers["user-agent"], 500);
  const agent = classifyAgent(ua);
  const event = {
    ip_address: requestIp(req), country_code: clean(req.headers["x-vercel-ip-country"], 8),
    region: clean(req.headers["x-vercel-ip-country-region"], 100), city: clean(req.headers["x-vercel-ip-city"], 100),
    timezone: clean(req.headers["x-vercel-ip-timezone"], 80), path,
    referrer_host: clean(body.referrerHost, 180), user_agent: ua,
    browser: agent.browser, operating_system: agent.operating_system, device_type: agent.device_type,
    language: clean(req.headers["accept-language"], 160),
    screen_class: ["small", "medium", "large", "unknown"].includes(body.screenClass) ? body.screenClass : "unknown"
  };
  try {
    const response = await fetch(SUPABASE_URL + "/rest/v1/kingshot_visitor_events", {
      method: "POST",
      headers: {apikey: SUPABASE_KEY, authorization: "Bearer " + SUPABASE_KEY, "content-type": "application/json", Prefer: "return=minimal"},
      body: JSON.stringify(event), signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) { console.error("Visitor telemetry insert failed", response.status); return res.status(503).json({error: "Telemetry temporarily unavailable"}); }
    return res.status(204).end();
  } catch (error) {
    console.error("Visitor telemetry request failed", error?.message || error);
    return res.status(503).json({error: "Telemetry temporarily unavailable"});
  }
}
