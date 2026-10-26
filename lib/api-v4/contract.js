import crypto from "node:crypto";
import { withDevMetadata } from "../developer-contact.js";

const asRecord = value =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
const text = value => typeof value === "string" ? value : "";

/** Isolate V4 idempotency records from V1/V3 records even when callers reuse the same key. */
export function namespaceV4IdempotencyKey(key) {
  return "v4_" + crypto.createHash("sha256").update(key, "utf8").digest("hex");
}

/**
 * V4 response contract:
 * - success is the HTTP/API request outcome, not the in-game redemption result;
 * - data is always present (null on API errors);
 * - error is always present (null on success);
 * - meta always contains apiVersion, requestId, and timestamp.
 */
export function normalizeV4Response(bodyValue, status, fallbackId, now = new Date().toISOString()) {
  const body = asRecord(bodyValue);
  const previousMeta = asRecord(body.meta);
  const id = text(previousMeta.requestId) || fallbackId;
  const time = text(previousMeta.timestamp) || now;
  const { apiVersion: _oldVersion, requestId: _oldId, timestamp: _oldTime, ...metaExtras } = previousMeta;
  const meta = { ...metaExtras, apiVersion: "4", requestId: id, timestamp: time };
  const succeeded = status >= 200 && status < 300 && Object.prototype.hasOwnProperty.call(body, "data") && body.error == null;
  if (succeeded) {
    return withDevMetadata({ success: true, data: body.data, error: null, meta });
  }
  const originalError = asRecord(body.error);
  const code = text(originalError.code) || text(body.code) || "request_failed";
  const message = text(originalError.message) || text(body.message) || "The request could not be completed.";
  return withDevMetadata({
    success: false,
    data: null,
    error: { code, message },
    meta
  }) as JsonRecord;
}
