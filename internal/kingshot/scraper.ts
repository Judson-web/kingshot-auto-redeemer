import { extractPageCodes, extractPublicSourceCodes, normalizeCodes, isLikelyGiftCode, type GiftCodeRow } from "./gift-codes.js";

export interface ScraperResult {
  source: string;
  codes: any[];
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
  data?: unknown;
  html?: string;
}

function extractAggregatorCodes(data: unknown): GiftCodeRow[] {
  const rows = Array.isArray((data as { codes?: unknown[] })?.codes) ? (data as { codes: unknown[] }).codes : [];
  return rows.map((row): GiftCodeRow | null => {
    const value = typeof row === "string" ? row : (row as { code?: unknown })?.code;
    const code = String(value ?? "").trim();
    if (!isLikelyGiftCode(code)) return null;
    return { code, expiresAt: null, createdAt: 0, source: "whiteout-bot-aggregator" };
  }).filter((row): row is GiftCodeRow => row !== null);
}

interface Rpc {
  (name: string, body: Record<string, unknown>): Promise<any>;
}

type CachedResult = { expiresAt: number; result: ScraperResult };
const sourceCache = new Map<string, CachedResult>();
const sourceInFlight = new Map<string, Promise<ScraperResult>>();
const sourceCooldowns = new Map<string, number>();
const SOURCE_CACHE_TTL_MS = 90_000;
const PAGE_CACHE_TTL_MS = 180_000;
const STALE_IF_THROTTLED_MS = 6 * 60 * 60_000;

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

function emptyResult(source: string, apiLike: boolean, status: number | null, message: string): ScraperResult {
  return { source, codes: [], ok: false, httpStatus: status, error: message, ...(apiLike ? { data: null } : { html: "" }) };
}

export function classifyScraperError(error: unknown): string {
  const message = String((error as { message?: unknown })?.message || error || "").toLowerCase();
  if (/timeout|timed out|abort/.test(message)) return "TIMEOUT";
  if (/unauthorized|forbidden|401|403/.test(message)) return "AUTH";
  if (/429|rate limit|too frequent/.test(message)) return "RATE_LIMIT";
  if (/404|not found/.test(message)) return "NOT_FOUND";
  if (/parse|json|invalid api response|no active gift codes/.test(message)) return "PARSE";
  if (/supabase|database|rpc/.test(message)) return "DATABASE";
  if (/mightpulse|player/.test(message)) return "UPSTREAM_PLAYER";
  if (/kingshot|gift|redemption/.test(message)) return "UPSTREAM_REDEMPTION";
  return "UNKNOWN";
}

async function updateHealth(rpc: Rpc, source: string, codeCount: number, error: string | null = null) {
  try {
    await rpc("record_kingshot_scraper_health", { p_source: source, p_code_count: codeCount, p_error: error });
  } catch (failure) {
    console.error("Scraper health update failed:", source, (failure as { message?: string })?.message || failure);
  }
}

async function recordRun(rpc: Rpc, source: string, httpStatus: number | null, codes: any[], parseOk: boolean, error: unknown) {
  await rpc("kingshot_record_scraper_run", {
    p_source: source,
    p_http_status: httpStatus,
    p_code_count: Array.isArray(codes) ? codes.length : 0,
    p_codes: Array.isArray(codes) ? codes.map(x => x.code) : [],
    p_parse_ok: Boolean(parseOk),
    p_error_category: error ? classifyScraperError(error) : null,
    p_error_message: (error as { message?: unknown })?.message || error || null
  }).catch(() => {});
}

async function fetchSourceUncached(rpc: Rpc, url: string, kind: string, source: string, apiLike: boolean, stale: CachedResult | undefined): Promise<ScraperResult> {
  // The process-local map is fast, while Supabase coordinates cooldowns across
  // separate serverless instances and scheduled invocations.
  let cooldownUntil = sourceCooldowns.get(url) || 0;
  try {
    const sharedUntil = await rpc("kingshot_get_source_cooldown", { p_source_url: url });
    const parsed = Date.parse(String(sharedUntil || ""));
    if (Number.isFinite(parsed) && parsed > cooldownUntil) cooldownUntil = parsed;
    if (cooldownUntil > Date.now()) sourceCooldowns.set(url, cooldownUntil);
  } catch (error) {
    // Keep the gateway operational during migration rollout or temporary RPC issues.
    console.warn("Shared source cooldown lookup unavailable:", source, (error as { message?: string })?.message || error);
  }
  if (cooldownUntil > Date.now()) {
    const waitSeconds = Math.ceil((cooldownUntil - Date.now()) / 1000);
    const error = Error("HTTP 429 cooldown active; retry in " + waitSeconds + "s");
    await recordRun(rpc, source, 429, [], false, error);
    await updateHealth(rpc, source, 0, error.message);
    if (stale && Date.now() - stale.expiresAt <= STALE_IF_THROTTLED_MS) {
      return { ...stale.result, codes: [...stale.result.codes], error: "Upstream cooldown active; serving bounded stale cache", ok: true };
    }
    return emptyResult(source, apiLike, 429, error.message);
  }

  try {
    let response: Response | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetch(url, {
          headers: apiLike
            ? { accept: "application/json", "user-agent": "Nex-Kingshot-Redeemer/1.1", ...(kind === "aggregator" ? { "X-API-Key": String(process.env.KINGSHOT_AGGREGATOR_API_KEY || "") } : {}) }
            : { accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9", "user-agent": "Mozilla/5.0 (compatible; Nex-Kingshot-Redeemer/1.1; +https://kingshot-autoredeemer.vercel.app/)" },
          signal: AbortSignal.timeout(15000)
        });
        if (response.status === 429) {
          const requestedWait = retryAfterMs(response);
          // When no Retry-After is supplied, apply a conservative local cooldown.
          const cooldownMs = requestedWait ?? 60_000;
          const cooldownSeconds = Math.max(1, Math.ceil(cooldownMs / 1000));
          sourceCooldowns.set(url, Date.now() + cooldownMs);
          // Persist the provider's requested wait so another serverless instance
          // cannot immediately hit the same throttled source.
          await rpc("kingshot_set_source_cooldown", {
            p_source_url: url,
            p_cooldown_seconds: cooldownSeconds,
            p_http_status: 429
          }).catch(error => console.warn("Shared source cooldown write failed:", source, (error as { message?: string })?.message || error));
          break; // Never immediately retry a rate-limited upstream.
        }
        if (response.ok || ![408, 425, 500, 502, 503, 504].includes(response.status)) break;
        lastError = Error("HTTP " + response.status);
      } catch (error) {
        lastError = error;
      }
      if (attempt < 2) {
        const jitter = Math.floor(Math.random() * 250);
        await new Promise(resolve => setTimeout(resolve, Math.min(5000, 700 * (2 ** attempt) + jitter)));
      }
    }

    if (!response) {
      const message = (lastError as { message?: string })?.message || "Source request failed";
      await recordRun(rpc, source, null, [], false, lastError || Error(message));
      await updateHealth(rpc, source, 0, message);
      return emptyResult(source, apiLike, null, message);
    }

    if (response.status === 429) {
      const error = Error("HTTP 429; upstream cooldown applied");
      await recordRun(rpc, source, 429, [], false, error);
      await updateHealth(rpc, source, 0, error.message);
      // Preserve service continuity with a bounded stale snapshot, but never relabel it as a fresh fetch.
      if (stale && Date.now() - stale.expiresAt <= STALE_IF_THROTTLED_MS) {
        return { ...stale.result, codes: [...stale.result.codes], error: "Upstream rate-limited; serving bounded stale cache", ok: true };
      }
      return emptyResult(source, apiLike, 429, error.message);
    }

    const body = await response.text();
    if (!response.ok) {
      const error = Error("HTTP " + response.status);
      await recordRun(rpc, source, response.status, [], false, error);
      await updateHealth(rpc, source, 0, error.message);
      return emptyResult(source, apiLike, response.status, error.message);
    }

    let result: ScraperResult;
    if (apiLike) {
      let data: any = null;
      try { data = JSON.parse(body); } catch {}
      const valid = Boolean(data && (kind === "api" ? data?.status === "success" : Array.isArray(data?.codes)));
      const codes = valid ? (kind === "api" ? normalizeCodes(data) : extractAggregatorCodes(data)) : [];
      const parseError = valid ? null : Error("Invalid API response");
      result = { source, data, codes, ok: valid, httpStatus: response.status, error: parseError?.message || null };
      await updateHealth(rpc, source, codes.length, parseError?.message || null);
      await recordRun(rpc, source, response.status, codes, valid, parseError);
    } else {
      const codes = kind === "page" ? extractPageCodes(body) : extractPublicSourceCodes(body, source);
      const parseError = codes.length ? null : Error("No active gift codes parsed");
      result = { source, html: body, codes, ok: !parseError, httpStatus: response.status, error: parseError?.message || null };
      await updateHealth(rpc, source, codes.length, parseError?.message || null);
      await recordRun(rpc, source, response.status, codes, !parseError, parseError);
    }

    // Cache only successfully parsed responses. Never cache errors, empty parses, or 429s.
    if (result.ok) {
      const ttl = apiLike ? SOURCE_CACHE_TTL_MS : PAGE_CACHE_TTL_MS;
      sourceCache.set(url, { result, expiresAt: Date.now() + ttl });
      if (sourceCache.size > 100) {
        const now = Date.now();
        for (const [key, value] of sourceCache) if (value.expiresAt <= now) sourceCache.delete(key);
        while (sourceCache.size > 100) sourceCache.delete(sourceCache.keys().next().value as string);
      }
    }
    return result;
  } catch (error) {
    const message = (error as { message?: string })?.message || "Source request failed";
    await updateHealth(rpc, source, 0, message);
    await recordRun(rpc, source, null, [], false, error);
    return emptyResult(source, apiLike, null, message);
  }
}

export async function fetchSource(rpc: Rpc, url: string, kind: string): Promise<ScraperResult> {
  const source = kind === "api" ? "kingshot-api" : kind === "page" ? "kingshot-page" : kind === "aggregator" ? "whiteout-bot-aggregator" : kind.slice(7);
  const apiLike = kind === "api" || kind === "aggregator";
  const cached = sourceCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.result, codes: [...cached.result.codes] };

  // Concurrent callers in one warm serverless instance share one upstream request.
  const existing = sourceInFlight.get(url);
  if (existing) return existing.then(result => ({ ...result, codes: [...result.codes] }));

  const pending = fetchSourceUncached(rpc, url, kind, source, apiLike, cached);
  sourceInFlight.set(url, pending);
  try {
    return await pending;
  } finally {
    if (sourceInFlight.get(url) === pending) sourceInFlight.delete(url);
  }
}
