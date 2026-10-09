/**
 * Best-effort per-instance request limiter.
 *
 * This deliberately avoids persistent storage; it bounds memory and fails closed
 * for new client keys when an instance is at capacity. It is not a distributed
 * quota system, so sensitive operations must also enforce server-side controls.
 */
interface RateLimitRequest {
  headers: Record<string, string | string[] | undefined>;
}
interface RateLimitResponse {
  setHeader(name: string, value: string): unknown;
}
interface RateLimitBucket {
  count: number;
  resetAt: number;
}
type RateLimitGlobal = typeof globalThis & {
  __ksRateLimitBuckets?: Map<string, RateLimitBucket>;
};

const MAX_BUCKETS = 5000;

export function rateLimit(
  req: RateLimitRequest,
  res: RateLimitResponse,
  scope: string,
  limit = 20,
  windowMs = 60000,
): boolean {
  const now = Date.now();
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || String(req.headers["x-real-ip"] || "").trim() || "unknown";
  const key = scope + ":" + ip;
  const state = globalThis as RateLimitGlobal;
  const buckets = state.__ksRateLimitBuckets ?? (state.__ksRateLimitBuckets = new Map<string, RateLimitBucket>());

  let bucket = buckets.get(key);
  if (!bucket && buckets.size >= MAX_BUCKETS) {
    for (const [entryKey, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(entryKey);
    }
    if (buckets.size >= MAX_BUCKETS) {
      const earliestReset = Math.min(...Array.from(buckets.values(), value => value.resetAt));
      res.setHeader("X-RateLimit-Limit", String(limit));
      res.setHeader("X-RateLimit-Remaining", "0");
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((earliestReset - now) / 1000))));
      res.setHeader("Cache-Control", "no-store");
      return false;
    }
  }

  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
  bucket.count++;
  buckets.set(key, bucket);

  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - bucket.count)));
  if (bucket.count > limit) {
    const retry = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retry));
    res.setHeader("Cache-Control", "no-store");
    return false;
  }
  return true;
}
