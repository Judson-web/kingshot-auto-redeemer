import crypto from "node:crypto";
import type { JsonRecord, V3AuthorizationContext, V3Request, V3Response } from "./types.js";
import { apiKeyFromRequest, quotaMetadata, sendError, setRateLimitHeaders, trustedClientIp } from "./http.js";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const AUTHORIZATION_TIMEOUT_MS = 1800;
const sha256 = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");
async function authorizeKeyRpc(keyHash: string, ipHash: string): Promise<JsonRecord> {
  if (!SUPABASE_KEY) throw new Error("Developer API authorization is not configured.");
  const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/kingshot_developer_authorize_key", {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, authorization: "Bearer " + SUPABASE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ p_key_hash: keyHash, p_ip_hash: ipHash }),
    signal: AbortSignal.timeout(AUTHORIZATION_TIMEOUT_MS)
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== "object" || Array.isArray(data)) {
    const error = new Error("Developer authorization service is unavailable.") as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return data as JsonRecord;
}
export async function authorizeDeveloperKey(req: V3Request, res: V3Response, id: string): Promise<V3AuthorizationContext | null> {
  const key = apiKeyFromRequest(req);
  if (!key) {
    res.setHeader("WWW-Authenticate", "Bearer");
    sendError(res, 401, "missing_api_key", "A valid developer Bearer API key is required.", id);
    return null;
  }
  const ip = trustedClientIp(req);
  if (!ip) {
    sendError(res, 503, "client_ip_unavailable", "The trusted client IP is unavailable; the request cannot be authorized safely.", id);
    return null;
  }
  if (!SUPABASE_KEY) {
    sendError(res, 503, "service_not_configured", "The developer API is not configured on the server.", id);
    return null;
  }
  let result: JsonRecord;
  try {
    result = await authorizeKeyRpc(sha256(key), sha256(ip));
  } catch (error) {
    console.error("[developer-api-v3] authorization service failed", { status: (error as { status?: number } | null)?.status });
    sendError(res, 503, "authorization_unavailable", "The developer authorization service is temporarily unavailable.", id);
    return null;
  }
  setRateLimitHeaders(res, result);
  if (result.allowed !== true) {
    const reason = String(result.reason || "");
    if (reason === "invalid_api_key") {
      res.setHeader("WWW-Authenticate", "Bearer");
      sendError(res, 401, "invalid_api_key", "The API key is invalid or has been revoked.", id);
      return null;
    }
    if (reason === "client_ip_unavailable") {
      sendError(res, 503, "client_ip_unavailable", "The trusted client IP is unavailable.", id);
      return null;
    }
    const resetAt = typeof result.reset_at === "string" ? result.reset_at : undefined;
    sendError(res, 429, "rate_limit_exceeded", "The per-key or per-IP request limit has been reached.", id, {
      reason: reason || "quota_exceeded",
      rateLimit: quotaMetadata(result),
      ...(resetAt ? { resetAt } : {})
    });
    return null;
  }
  return { ...result, rateLimit: quotaMetadata(result) };
}
