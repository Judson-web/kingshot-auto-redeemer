import { redeemKingshot } from "../../internal/kingshot/redeem.js";
import { validateV3RedemptionBody } from "../developer-api-v3-validation.js";
import type { JsonRecord, V3AuthorizationContext, V3Request, V3Response } from "./types.js";
import { sendError, timestamp } from "./http.js";
import { withDevMetadata } from "../developer-contact.js";
import {
  beginIdempotentRedemption,
  finishIdempotentRedemption,
  readIdempotencyKey,
  refreshIdempotentResponseMetadata
} from "./idempotency.js";

const errBody = (code: string, message: string, id: string, rateLimit: JsonRecord): JsonRecord => ({
  error: { code, message },
  meta: { apiVersion: "3", requestId: id, timestamp: timestamp(), rateLimit }
});

export async function handleV3Redemption(
  req: V3Request,
  res: V3Response,
  id: string,
  auth: V3AuthorizationContext
): Promise<void> {
  const validation = validateV3RedemptionBody(req.body);
  if (validation.valid === false) {
    sendError(res, 400, validation.code, validation.message, id, { rateLimit: auth.rateLimit });
    return;
  }

  const idempotency = readIdempotencyKey(req);
  if (!idempotency.valid) {
    sendError(res, 400, "invalid_idempotency_key", "Idempotency-Key must be one unambiguous value of 8–128 safe ASCII characters.", id, { rateLimit: auth.rateLimit });
    return;
  }

  const keyId = String(auth.key_id || "");
  let claimed = false;
  if (idempotency.present) {
    if (!/^[0-9a-f-]{36}$/i.test(keyId)) {
      sendError(res, 503, "idempotency_unavailable", "API key context cannot safely use idempotency.", id, { rateLimit: auth.rateLimit });
      return;
    }
    try {
      const claim = await beginIdempotentRedemption({
        keyId,
        key: idempotency.key,
        request: validation.value
      });
      if (claim.state === "conflict") {
        sendError(res, 409, "idempotency_key_reused", "This key was used with a different request body.", id, { rateLimit: auth.rateLimit });
        return;
      }
      if (claim.state === "in_progress") {
        sendError(res, 409, "idempotency_in_progress", "This keyed request is still processing; retry using the same key.", id, { rateLimit: auth.rateLimit });
        return;
      }
      if (claim.state === "replay" || claim.state === "unknown") {
        const replayBody = refreshIdempotentResponseMetadata(claim.response_body, {
          requestId: id,
          timestamp: timestamp(),
          rateLimit: auth.rateLimit
        });
        if (!replayBody) {
          sendError(res, 503, "idempotency_record_invalid", "The stored outcome could not be read safely. Do not submit this redemption with a new key; contact support with this request ID.", id, { rateLimit: auth.rateLimit });
          return;
        }
        res.setHeader("Idempotency-Replayed", "true");
        res.status(Number(claim.response_status) || 504).json(withDevMetadata(replayBody));
        return;
      }
      if (claim.state !== "started") throw new Error("Unexpected idempotency state");
      claimed = true;
    } catch (error) {
      console.error("[developer-api-v3] idempotency storage failed", {
        requestId: id,
        status: (error as { status?: number } | null)?.status
      });
      sendError(res, 503, "idempotency_unavailable", "Durable idempotency storage is unavailable; no redemption was submitted.", id, { rateLimit: auth.rateLimit });
      return;
    }
  }

  const send = async (status: number, body: JsonRecord, unknown = false): Promise<void> => {
    const responseBody = withDevMetadata(body) as JsonRecord;
    if (claimed) {
      try {
        await finishIdempotentRedemption({
          keyId,
          key: idempotency.key,
          status,
          body: responseBody,
          outcomeUnknown: unknown
        });
      } catch (error) {
        console.error("[developer-api-v3] idempotency outcome persistence failed", {
          requestId: id,
          status: (error as { status?: number } | null)?.status
        });
        sendError(res, 503, "outcome_persistence_failed", "Outcome may be ambiguous. Reuse the same Idempotency-Key; do not submit a new attempt.", id, { rateLimit: auth.rateLimit });
        return;
      }
    }
    res.status(status).json(responseBody);
  };

  try {
    const result = await redeemKingshot(validation.value);
    if (result.httpStatus === 504 || result.errorCategory === "TIMEOUT") {
      await send(504, errBody("upstream_timeout", "Provider timed out. Reuse the same key; do not submit a new attempt.", id, auth.rateLimit), true);
      return;
    }
    if (result.httpStatus >= 500) {
      const notConfigured = /not configured/i.test(String(result.error || ""));
      await send(
        notConfigured ? 503 : 502,
        errBody(
          notConfigured ? "upstream_not_configured" : "upstream_unavailable",
          notConfigured ? "Redemption provider is not configured." : "Provider unavailable; outcome may be ambiguous. Do not submit a new attempt.",
          id,
          auth.rateLimit
        ),
        !notConfigured
      );
      return;
    }
    await send(200, {
      data: {
        ok: Boolean(result.ok),
        status: result.status || "ERROR",
        statusLabel: result.statusLabel || null,
        message: result.message || result.error || "The redemption request completed.",
        errorCategory: result.errorCategory || null,
        errCode: result.errCode ?? null
      },
      meta: { apiVersion: "3", requestId: id, timestamp: timestamp(), rateLimit: auth.rateLimit }
    });
  } catch (error) {
    console.error("[developer-api-v3] redemption failed", {
      requestId: id,
      status: (error as { status?: number } | null)?.status
    });
    await send(502, errBody("upstream_unavailable", "Provider unavailable; outcome may be ambiguous. Do not submit a new attempt.", id, auth.rateLimit), true);
  }
}
