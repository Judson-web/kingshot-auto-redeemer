import type { V3Request, V3Response, JsonRecord } from "./api-v3/types.js";
import developerApiV3 from "./developer-api-v3.js";
import { isJsonRequest, requestId, timestamp } from "./api-v3/http.js";
import {
  createV4Error,
  normalizeV4Response,
  namespaceV4IdempotencyKey,
  readV4IdempotencyKey
} from "./api-v4/contract.js";
import { withDevMetadata } from "./developer-contact.js";

type Header = { name: string; value: string };

function sendV4Error(
  res: V3Response,
  status: number,
  code: string,
  message: string,
  id: string,
  extraMeta: JsonRecord = {},
  route = "",
  idempotencyKeyPresent = false
): void {
  const now = timestamp();
  const resetAt = typeof extraMeta.resetAt === "string" ? extraMeta.resetAt : "";
  if (status === 429 && resetAt) {
    const reset = Date.parse(resetAt);
    if (Number.isFinite(reset)) res.setHeader("Retry-After", String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))));
  }
  res.setHeader("X-Request-Id", id);
  res.setHeader("X-API-Version", "4");
  res.status(status).json(withDevMetadata({
    success: false,
    data: null,
    error: createV4Error(code, message, status, route, extraMeta, now, "", idempotencyKeyPresent),
    meta: { apiVersion: "4", requestId: id, timestamp: now, ...extraMeta }
  }));
}

function setV4Headers(res: V3Response, methods: string): void {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-API-Version", "4");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", methods + ", OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key");
  res.setHeader("Access-Control-Expose-Headers", "X-Request-Id, X-API-Version, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Daily-Limit, X-RateLimit-Daily-Remaining, Retry-After, Idempotency-Replayed");
  res.setHeader("Vary", "Origin");
}

/**
 * V4 preserves the hardened V3 authorization, quotas, validation and redemption
 * services while presenting one self-describing contract. V4 idempotency keys
 * are namespaced so a V3 replay cannot be mistaken for a V4 replay.
 */
export default async function developerApiV4(req: V3Request, res: V3Response, path: string): Promise<void> {
  const id = requestId();
  const route = path === "player" ? "player" : path === "redemptions" ? "redemptions" : "";
  const allowedMethod = route === "redemptions" ? "POST" : "GET";
  const method = String(req.method || "GET").toUpperCase();
  setV4Headers(res, allowedMethod);
  res.setHeader("X-Request-Id", id);

  if (method === "OPTIONS") {
    const response = res.status(204);
    if (typeof response.end === "function") response.end();
    else response.json({});
    return;
  }
  if (!route) {
    sendV4Error(res, 404, "route_not_found", "V4 API route not found.", id, { documentation: "/developer-v4.md" });
    return;
  }
  if (method !== allowedMethod) {
    res.setHeader("Allow", allowedMethod + ", OPTIONS");
    sendV4Error(res, 405, "method_not_allowed", "This method is not supported for the requested V4 route.", id, {}, route);
    return;
  }
  if (route === "redemptions" && !isJsonRequest(req)) {
    sendV4Error(res, 415, "unsupported_media_type", "Send the redemption request as application/json.", id, {}, route);
    return;
  }

  let adaptedRequest = req;
  let idempotencyKeyPresent = false;
  if (route === "redemptions") {
    const idempotency = readV4IdempotencyKey(req);
    if (!idempotency.valid) {
      sendV4Error(
        res, 400, "invalid_idempotency_key",
        "Send exactly one Idempotency-Key containing 8–128 letters, digits, periods, underscores, colons, or hyphens.",
        id, {}, route
      );
      return;
    }
    idempotencyKeyPresent = idempotency.present;
    if (idempotency.present) {
      // Remove alternate-case copies before injecting the namespaced header so
      // downstream runtimes cannot choose a different value.
      const headers = Object.fromEntries(
        Object.entries(req.headers || {}).filter(([name]) => name.toLowerCase() !== "idempotency-key")
      );
      headers["idempotency-key"] = namespaceV4IdempotencyKey(idempotency.key);
      adaptedRequest = { ...req, headers };
    }
  }

  let capturedStatus = 200;
  let capturedBody: unknown;
  const capturedHeaders = new Map<string, Header>();
  const sink: V3Response = {
    status(code: number) { capturedStatus = code; return sink; },
    json(body: unknown) { capturedBody = body; return sink; },
    setHeader(name: string, value: string) { capturedHeaders.set(name.toLowerCase(), { name, value }); },
    end() { return sink; }
  };

  try {
    await developerApiV3(adaptedRequest, sink, route);
  } catch (error) {
    console.error("[developer-api-v4] adapter failed", { requestId: id, message: error instanceof Error ? error.message : "unknown error" });
    sendV4Error(res, 502, "internal_error", "The API could not complete the request.", id, {}, route, idempotencyKeyPresent);
    return;
  }

  const responseId = capturedHeaders.get("x-request-id")?.value || id;
  for (const [key, value] of capturedHeaders) {
    if (key === "x-api-version" || key === "x-request-id") continue;
    res.setHeader(value.name, value.value);
  }
  res.setHeader("X-Request-Id", responseId);
  res.setHeader("X-API-Version", "4");
  res.status(capturedStatus).json(normalizeV4Response(capturedBody, capturedStatus, responseId, timestamp(), {
    route,
    retryAfterHeader: capturedHeaders.get("retry-after")?.value || "",
    idempotencyKeyPresent
  }));
}
