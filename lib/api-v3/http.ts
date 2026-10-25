import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { withDevMetadata } from "../developer-contact.js";
import type { JsonRecord, V3Request, V3Response } from "./types.js";
export const timestamp = (): string => new Date().toISOString();
export const requestId = (): string => randomUUID();
export function header(req: V3Request, name: string): string {
  const headers = req.headers || {};
  const lower = name.toLowerCase();
  const value = headers[lower] ?? headers[name] ?? headers[name.toUpperCase()];
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}
export function trustedClientIp(req: V3Request): string {
  const value = header(req, "x-vercel-forwarded-for").split(",")[0].trim();
  return value.length <= 64 && isIP(value) ? value : "";
}
export function apiKeyFromRequest(req: V3Request): string {
  const match = /^Bearer\s+(ks_live_[a-f0-9]{64})$/.exec(header(req, "authorization").trim());
  return match ? match[1] : "";
}
export function queryValue(req: V3Request, name: string): string {
  const value = req.query?.[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  try { return new URL(req.url || "/", "https://local.invalid").searchParams.get(name) || ""; }
  catch { return ""; }
}
export function isJsonRequest(req: V3Request): boolean {
  return /^application\/json(?:\s*;|\s*$)/i.test(header(req, "content-type").trim());
}
export function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
export function quotaMetadata(result: JsonRecord): JsonRecord {
  const reason = String(result.reason || "");
  const limit = finiteNumber(result.limit);
  const remaining = finiteNumber(result.remaining);
  const dailyRemaining = finiteNumber(result.daily_remaining);
  const value: JsonRecord = { perDayLimit: 1000 };
  if (reason === "daily_quota_exceeded") {
    value.perDayLimit = limit ?? 1000;
    value.perDayRemaining = 0;
  } else {
    value.perMinuteLimit = limit ?? 60;
    if (remaining !== null) value.perMinuteRemaining = remaining;
  }
  if (dailyRemaining !== null) value.perDayRemaining = dailyRemaining;
  if (typeof result.reset_at === "string") value.resetAt = result.reset_at;
  return value;
}
export function setRateLimitHeaders(res: V3Response, result: JsonRecord): void {
  const limit = finiteNumber(result.limit);
  const remaining = finiteNumber(result.remaining);
  const dailyRemaining = finiteNumber(result.daily_remaining);
  const reason = String(result.reason || "");
  if (limit !== null) res.setHeader("X-RateLimit-Limit", String(limit));
  if (remaining !== null) res.setHeader("X-RateLimit-Remaining", String(remaining));
  if (reason === "daily_quota_exceeded" && limit !== null) {
    res.setHeader("X-RateLimit-Daily-Limit", String(limit));
    res.setHeader("X-RateLimit-Daily-Remaining", "0");
  } else {
    res.setHeader("X-RateLimit-Daily-Limit", "1000");
    if (dailyRemaining !== null) res.setHeader("X-RateLimit-Daily-Remaining", String(dailyRemaining));
  }
  if (typeof result.reset_at === "string") {
    const reset = Date.parse(result.reset_at);
    if (Number.isFinite(reset)) res.setHeader("X-RateLimit-Reset", String(Math.ceil(reset / 1000)));
  }
}
export function sendError(res: V3Response, status: number, code: string, message: string, id: string, meta: JsonRecord = {}): void {
  res.setHeader("X-Request-Id", id);
  res.setHeader("X-API-Version", "3");
  if (status === 429 && typeof meta.resetAt === "string") {
    const reset = Date.parse(meta.resetAt);
    if (Number.isFinite(reset)) res.setHeader("Retry-After", String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))));
  }
  res.status(status).json(withDevMetadata({
    error: { code, message },
    meta: { apiVersion: "3", requestId: id, timestamp: timestamp(), ...meta }
  }));
}
export function setPublicHeaders(res: V3Response, methods: string): void {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-API-Version", "3");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", methods + ", OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key");
  res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, X-API-Version, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Daily-Limit, X-RateLimit-Daily-Remaining, Retry-After, Idempotency-Replayed");
  res.setHeader("Vary", "Origin");
}
