import crypto from "node:crypto";
import { rateLimit } from "../../lib/request-rate-limit.js";

interface RequestLike {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ResponseLike {
  setHeader(name: string, value: string | string[]): this;
  status(code: number): this;
  json(body: unknown): this;
}

type JsonRecord = Record<string, unknown>;

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const COOKIE = "__Host-ks_admin_session";

// Admin auth v2: normalize copied keys server-side before hashing.
function hash(value: unknown): string {
  const normalized = String(value ?? "").normalize("NFKC").replace(/\s+/g, "");
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

function token(): string {
  return crypto.randomBytes(32).toString("hex");
}

function getCookie(req: RequestLike): string {
  const raw = String(req.headers.cookie || "");
  const part = raw
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(COOKIE + "="));
  if (!part) return "";
  try {
    return decodeURIComponent(part.slice(COOKIE.length + 1));
  } catch {
    // Ignore malformed client cookies so logout can still clear the session.
    return "";
  }
}

function setCookie(res: ResponseLike, value: string, maxAge: number): void {
  const encoded = encodeURIComponent(value);
  res.setHeader(
    "Set-Cookie",
    COOKIE +
      "=" +
      encoded +
      "; Max-Age=" +
      maxAge +
      "; Path=/; HttpOnly; Secure; SameSite=Strict",
  );
}

function clearCookie(res: ResponseLike): void {
  res.setHeader("Set-Cookie", [
    COOKIE + "=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict",
    "ks_admin_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
  ]);
}

async function rpc(name: string, body: JsonRecord): Promise<unknown> {
  if (!SUPABASE_KEY) throw new Error("Admin service is not configured.");
  const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "message" in data
        ? String(data.message)
        : "Admin service unavailable.";
    throw new Error(message || "Admin service unavailable.");
  }
  return data;
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default async function handler(
  req: RequestLike,
  res: ResponseLike,
): Promise<unknown> {
  res.setHeader("Cache-Control", "private, no-store");
  if (!["POST", "DELETE"].includes(req.method || "")) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (req.method === "DELETE") {
      const session = getCookie(req);
      if (session) {
        await rpc("kingshot_admin_logout", {
          p_token_hash: hash(session),
        }).catch(() => undefined);
      }
      clearCookie(res);
      return res.status(200).json({ ok: true });
    }

    if (!rateLimit(req, res, "admin-login", 5, 900000)) {
      return res
        .status(429)
        .json({ error: "Too many login attempts. Please try again later." });
    }

    const body = asRecord(req.body);
    const accessKey = String(body.accessKey || "").trim();
    if (!accessKey) {
      return res.status(400).json({ error: "Admin access key is required." });
    }

    const session = token();
    const ok = await rpc("kingshot_admin_create_session_with_key", {
      p_key_hash: hash(accessKey),
      p_token_hash: hash(session),
    });
    if (!ok) {
      return res.status(401).json({ error: "Invalid admin access key." });
    }

    setCookie(res, session, 43200);
    return res.status(200).json({ ok: true });
  } catch (error: unknown) {
    return res
      .status(502)
      .json({ error: errorMessage(error, "Admin authentication failed.") });
  }
}
