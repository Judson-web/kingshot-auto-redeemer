export interface RateLimitRequest {
  headers: Record<string, string | string[] | undefined>;
}
export interface RateLimitResponse {
  setHeader(name: string, value: string): void;
}
import { rateLimit as runtimeRateLimit } from "./request-rate-limit.js";
export function rateLimit(req: RateLimitRequest, res: RateLimitResponse, scope: string, limit = 20, windowMs = 60000): boolean {
  return runtimeRateLimit(req, res, scope, limit, windowMs);
}
