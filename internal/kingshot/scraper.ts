import { extractPageCodes, extractPublicSourceCodes, normalizeCodes, isLikelyGiftCode, type GiftCodeApiData, type GiftCodeRow } from "./gift-codes.js";

export interface ScraperResult {
  source: string;
  codes: GiftCodeRow[];
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
  data?: unknown;
  html?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractAggregatorCodes(data: unknown): GiftCodeRow[] {
  if (!isRecord(data) || !Array.isArray(data.codes)) return [];

  return data.codes.map((row): GiftCodeRow | null => {
    const value = typeof row === "string" ? row : isRecord(row) ? row.code : null;
    const code = typeof value === "string" ? value.trim() : "";
    if (!isLikelyGiftCode(code)) return null;
    return { code, expiresAt: null, createdAt: 0, source: "whiteout-bot-aggregator" };
  }).filter((row): row is GiftCodeRow => row !== null);
}

export type ScraperSourceKind = "api" | "page" | "aggregator" | `public:${string}`;

interface Rpc {
  (name: string, body: Record<string, unknown>): Promise<unknown>;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  if (typeof error === "string") return error;
  return "";
}

export function classifyScraperError(error: unknown): string {
  const message = (errorMessage(error) || String(error || "")).toLowerCase();
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
    console.error("Scraper health update failed:", source, errorMessage(failure) || failure);
  }
}

async function recordRun(rpc: Rpc, source: string, httpStatus: number | null, codes: GiftCodeRow[], parseOk: boolean, error: unknown) {
  await rpc("kingshot_record_scraper_run", {
    p_source: source,
    p_http_status: httpStatus,
    p_code_count: Array.isArray(codes) ? codes.length : 0,
    p_codes: Array.isArray(codes) ? codes.map(x => x.code) : [],
    p_parse_ok: Boolean(parseOk),
    p_error_category: error ? classifyScraperError(error) : null,
    p_error_message: errorMessage(error) || error || null
  }).catch(() => {});
}

export async function fetchSource(rpc: Rpc, url: string, kind: ScraperSourceKind): Promise<ScraperResult> {
  const source = kind === "api" ? "kingshot-api" : kind === "page" ? "kingshot-page" : kind === "aggregator" ? "whiteout-bot-aggregator" : kind.slice(7);
  const apiLike = kind === "api" || kind === "aggregator";
  try {
    let response: Response | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetch(url, {
          headers: apiLike
            ? { accept: "application/json", "user-agent": "Nex-Kingshot-Redeemer/1.1", ...(kind === "aggregator" ? { "X-API-Key": String(process.env.KINGSHOT_AGGREGATOR_API_KEY || "") } : {}) }
            : { accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9", "cache-control": "no-cache", "user-agent": "Mozilla/5.0 (compatible; Nex-Kingshot-Redeemer/1.1; +https://kingshot-autoredeemer.vercel.app/)" },
          signal: AbortSignal.timeout(15000)
        });
        if (response.ok || ![408,425,429,500,502,503,504].includes(response.status)) break;
        lastError = Error("HTTP " + response.status);
      } catch (error) {
        lastError = error;
      }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1)));
    }

    if (!response) {
      const message = (lastError as { message?: string })?.message || "Source request failed";
      await recordRun(rpc, source, null, [], false, lastError || Error(message));
      await updateHealth(rpc, source, 0, message);
      return { source, codes: [], ok: false, httpStatus: null, error: message, ...(apiLike ? { data: null } : { html: "" }) };
    }

    const body = await response.text();
    if (!response.ok) {
      const error = Error("HTTP " + response.status);
      await recordRun(rpc, source, response.status, [], false, error);
      await updateHealth(rpc, source, 0, error.message);
      return { source, codes: [], ok: false, httpStatus: response.status, error: error.message, ...(apiLike ? { data: null } : { html: "" }) };
    }

    if (apiLike) {
      let data: unknown = null;
      try { data = JSON.parse(body) as unknown; } catch {}
      const valid = isRecord(data) && (kind === "api" ? data.status === "success" : Array.isArray(data.codes));
      const codes = valid
        ? kind === "api"
          ? normalizeCodes(data as GiftCodeApiData)
          : extractAggregatorCodes(data)
        : [];
      const parseError = valid ? null : Error("Invalid API response");
      await updateHealth(rpc, source, codes.length, parseError?.message || null);
      await recordRun(rpc, source, response.status, codes, valid, parseError);
      return { source, data, codes, ok: valid, httpStatus: response.status, error: parseError?.message || null };
    }

    const codes = kind === "page" ? extractPageCodes(body) : extractPublicSourceCodes(body, source);
    const parseError = codes.length ? null : Error("No active gift codes parsed");
    await updateHealth(rpc, source, codes.length, parseError?.message || null);
    await recordRun(rpc, source, response.status, codes, !parseError, parseError);
    return {
      source,
      html: body,
      codes,
      ok: !parseError,
      httpStatus: response.status,
      error: parseError?.message || null
    };
  } catch (error) {
    const message = (error as { message?: string })?.message || "Source request failed";
    await updateHealth(rpc, source, 0, message);
    await recordRun(rpc, source, null, [], false, error);
    return { source, codes: [], ok: false, httpStatus: null, error: message, ...(apiLike ? { data: null } : { html: "" }) };
  }
}
