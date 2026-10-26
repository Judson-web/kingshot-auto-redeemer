import crypto from "node:crypto";
import { withDevMetadata } from "../developer-contact.js";

const asRecord = value =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
const text = value => typeof value === "string" ? value : "";
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** Isolate V4 idempotency records from V1/V3 records even when callers reuse the same key. */
export function namespaceV4IdempotencyKey(key) {
  return "v4_" + crypto.createHash("sha256").update(key, "utf8").digest("hex");
}

/**
 * Accept exactly one unambiguous Idempotency-Key header. Some runtimes retain
 * repeated headers as arrays, while others combine them into a comma-separated
 * string; either representation must not silently select a different key.
 */
export function readV4IdempotencyKey(req) {
  const headers = req?.headers && typeof req.headers === "object" ? req.headers : {};
  const entries = Object.entries(headers).filter(([name]) => name.toLowerCase() === "idempotency-key");
  if (entries.length === 0) return { present: false, valid: true, key: "" };
  if (entries.length !== 1) return { present: true, valid: false, key: "" };

  const raw = entries[0][1];
  if (Array.isArray(raw) && raw.length !== 1) return { present: true, valid: false, key: "" };
  const key = String(Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").trim();
  return { present: true, valid: IDEMPOTENCY_PATTERN.test(key), key };
}

const NON_RETRYABLE_CODES = new Set([
  "invalid_player_id", "invalid_request_body", "unknown_fields", "invalid_gift_code",
  "invalid_kingdom_id", "invalid_idempotency_key", "idempotency_key_reused",
  "idempotency_record_invalid", "missing_api_key", "invalid_api_key",
  "player_not_found", "route_not_found", "method_not_allowed", "unsupported_media_type",
  "service_not_configured", "upstream_not_configured"
]);

function retryGuidance(status, code, route, meta, now, retryAfterHeader, idempotencyKeyPresent) {
  if (status === 429) {
    const headerValue = Number(retryAfterHeader);
    const resetAt = typeof meta.resetAt === "string" ? Date.parse(meta.resetAt) : Number.NaN;
    let retryAfterSeconds;
    if (Number.isFinite(headerValue) && headerValue > 0) {
      retryAfterSeconds = Math.max(1, Math.ceil(headerValue));
    } else if (Number.isFinite(resetAt)) {
      const nowMs = Date.parse(now);
      if (Number.isFinite(nowMs)) retryAfterSeconds = Math.max(1, Math.ceil((resetAt - nowMs) / 1000));
    }
    return {
      retryable: true,
      retryHint: retryAfterSeconds ? "honor_retry_after" : "bounded_backoff",
      ...(retryAfterSeconds ? { retryAfterSeconds } : {})
    };
  }

  if (status === 409 && code === "idempotency_in_progress") {
    return { retryable: true, retryHint: "same_idempotency_key" };
  }

  // A redemption may have reached the upstream game even if the response failed.
  // Retrying with the *same* key and request body is the only safe retry strategy.
  if (route === "redemptions" && status === 503 &&
      ["authorization_unavailable", "client_ip_unavailable"].includes(code)) {
    // Authorization failed before a redemption was submitted, so retrying the
    // request after bounded backoff is safe even if no idempotency key was used.
    return { retryable: true, retryHint: "bounded_backoff" };
  }

  if (route === "redemptions" && (
    status === 502 || status === 504 ||
    ["upstream_timeout", "upstream_unavailable", "outcome_persistence_failed", "idempotency_unavailable"].includes(code)
  )) {
    // Without a key on the original request, the server cannot promise a safe
    // replay of an ambiguous write. Do not encourage a second redemption attempt.
    return idempotencyKeyPresent
      ? { retryable: true, retryHint: "same_idempotency_key" }
      : { retryable: false, retryHint: "do_not_retry" };
  }

  if (route === "player" && [502, 503, 504].includes(status) &&
      !NON_RETRYABLE_CODES.has(code)) {
    return { retryable: true, retryHint: "bounded_backoff" };
  }

  if (status >= 500 && !NON_RETRYABLE_CODES.has(code) &&
      ["authorization_unavailable", "client_ip_unavailable"].includes(code)) {
    return { retryable: true, retryHint: "bounded_backoff" };
  }

  return { retryable: false, retryHint: "do_not_retry" };
}

/** Build the additive, machine-readable V4 retry contract for an API error. */
export function createV4Error(code, message, status, route = "", meta = {}, now = new Date().toISOString(), retryAfterHeader = "", idempotencyKeyPresent = false) {
  return {
    code,
    message,
    ...retryGuidance(status, code, route, meta, now, retryAfterHeader, idempotencyKeyPresent)
  };
}

/**
 * V4 response contract:
 * - success is the HTTP/API request outcome, not the in-game redemption result;
 * - data is always present (null on API errors);
 * - error is always present (null on success);
 * - meta always describes this HTTP attempt and includes apiVersion, requestId,
 *   and timestamp. In particular, a replay must not reuse an old request ID.
 */
export function normalizeV4Response(bodyValue, status, fallbackId, now = new Date().toISOString(), options = {}) {
  const body = asRecord(bodyValue);
  const previousMeta = asRecord(body.meta);
  const id = text(fallbackId) || text(previousMeta.requestId) || "unknown-request";
  const time = Number.isFinite(Date.parse(now)) ? now : new Date().toISOString();
  const { apiVersion: _oldVersion, requestId: _oldId, timestamp: _oldTime, ...metaExtras } = previousMeta;
  const meta = { ...metaExtras, apiVersion: "4", requestId: id, timestamp: time };
  const succeeded = status >= 200 && status < 300 &&
    Object.prototype.hasOwnProperty.call(body, "data") && body.error == null;

  if (succeeded) {
    return withDevMetadata({ success: true, data: body.data, error: null, meta });
  }

  const originalError = asRecord(body.error);
  const code = text(originalError.code) || text(body.code) || "request_failed";
  const message = text(originalError.message) || text(body.message) || "The request could not be completed.";
  return withDevMetadata({
    success: false,
    data: null,
    error: createV4Error(code, message, status, options.route || "", meta, time, options.retryAfterHeader || "", options.idempotencyKeyPresent === true),
    meta
  });
}
