import type { V3Request, V3Response, JsonRecord } from "./api-v3/types.js";
import developerApiV3 from "./developer-api-v3.js";
import { isJsonRequest, requestId, timestamp } from "./api-v3/http.js";
import { readIdempotencyKey } from "./api-v3/idempotency.js";
import { normalizeV4Response, namespaceV4IdempotencyKey } from "./api-v4/contract.js";

type Header = { name: string; value: string };
function sendV4Error(res: V3Response, status: number, code: string, message: string, id: string, extraMeta: JsonRecord = {}): void {
  res.setHeader("X-Request-Id", id);
  res.setHeader("X-API-Version", "4");
  if (status === 429 && typeof extraMeta.resetAt === "string") {
    const reset = Date.parse(extraMeta.resetAt);
    if (Number.isFinite(reset)) res.setHeader("Retry-After", String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))));
  }
  res.status(status).json({
    success: false,
    data: null,
    error: { code, message },
    meta: { apiVersion: "4", requestId: id, timestamp: timestamp(), ...extraMeta },
    dev: { name: "Judson", discord: "@judson00713", url: "https://discord.com/users/871756466900598815" }
  });
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
 * services while adapting every result to a single, stable response envelope.
 * V4 idempotency keys are namespaced so a V3 replay cannot be mistaken for a V4 replay.
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
    sendV4Error(res, 404, "route_not_found", "V4 API route not found.", id, { documentation: "/developer" });
    return;
  }
  if (method !== allowedMethod) {
    res.setHeader("Allow", allowedMethod + ", OPTIONS");
    sendV4Error(res, 405, "method_not_allowed", "This method is not supported for the requested V4 route.", id);
    return;
  }
  if (route === "redemptions" && !isJsonRequest(req)) {
    sendV4Error(res, 415, "unsupported_media_type", "Send the redemption request as application/json.", id);
    return;
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

  let adaptedRequest = req;
  if (route === "redemptions") {
    const idempotency = readIdempotencyKey(req);
    if (idempotency.present && idempotency.valid) {
      const namespaced = namespaceV4IdempotencyKey(idempotency.key);
      adaptedRequest = { ...req, headers: { ...req.headers, "idempotency-key": namespaced } };
    }
  }

  try {
    await developerApiV3(adaptedRequest, sink, route);
  } catch (error) {
    console.error("[developer-api-v4] adapter failed", { requestId: id, message: error instanceof Error ? error.message : "unknown error" });
    sendV4Error(res, 502, "internal_error", "The API could not complete the request.", id);
    return;
  }

  const responseId = capturedHeaders.get("x-request-id")?.value || id;
  for (const [key, value] of capturedHeaders) {
    if (key === "x-api-version" || key === "x-request-id") continue;
    res.setHeader(value.name, value.value);
  }
  res.setHeader("X-Request-Id", responseId);
  res.setHeader("X-API-Version", "4");
  res.status(capturedStatus).json(normalizeV4Response(capturedBody, capturedStatus, responseId));
}
