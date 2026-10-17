import type { JsonRecord, V3AuthorizationContext, V3Request, V3Response } from "./types.js";
import { sendError, queryValue, timestamp } from "./http.js";
import { normalizeV3PlayerData, normalizeV3ProviderMetadata } from "./contracts.js";
import { normalizeV3PlayerId } from "../developer-api-v3-validation.js";
import { lookupPlayerSnapshotV3 } from "./player-service.js";
function isTimeout(error: unknown): boolean {
  const candidate = error as { message?: string; name?: string } | null;
  return /timed out|timeout|abort/i.test(String(candidate?.message || "")) ||
    candidate?.name === "TimeoutError" || candidate?.name === "AbortError";
}
export async function handleV3PlayerLookup(req: V3Request, res: V3Response, id: string, auth: V3AuthorizationContext): Promise<void> {
  const playerId = normalizeV3PlayerId(queryValue(req, "id"));
  if (!playerId) {
    sendError(res, 400, "invalid_player_id", "The playerId path parameter must contain 5–20 digits.", id, { rateLimit: auth.rateLimit });
    return;
  }
  try {
    const snapshot = await lookupPlayerSnapshotV3(playerId);
    let data: JsonRecord;
    try { data = normalizeV3PlayerData(snapshot.player, playerId); }
    catch (error) {
      console.error("[developer-api-v3] provider returned invalid player data", {
        requestId: id,
        code: (error as { code?: string } | null)?.code || "invalid_provider_payload"
      });
      sendError(res, 502, "upstream_invalid_response", "The player lookup provider returned an invalid response.", id, { rateLimit: auth.rateLimit });
      return;
    }
    res.status(200).json({
      data,
      meta: {
        apiVersion: "3",
        requestId: id,
        timestamp: timestamp(),
        ...normalizeV3ProviderMetadata(snapshot),
        source: "mightpulse",
        rateLimit: auth.rateLimit
      }
    });
  } catch (error) {
    const typed = error as { status?: number; message?: string } | null;
    const status = typed?.status;
    if (status === 404) {
      sendError(res, 404, "player_not_found", "The player lookup provider could not find this player.", id, { rateLimit: auth.rateLimit });
    } else if (status === 429) {
      sendError(res, 503, "upstream_rate_limited", "The player lookup provider is temporarily rate-limited. Try again shortly.", id, { rateLimit: auth.rateLimit });
    } else if (status === 401 || status === 403) {
      console.error("[developer-api-v3] provider authorization failed", { requestId: id, status });
      sendError(res, 503, "upstream_authentication_failed", "The player lookup provider is temporarily unavailable.", id, { rateLimit: auth.rateLimit });
    } else if (isTimeout(error)) {
      sendError(res, 504, "upstream_timeout", "The player lookup provider timed out after a bounded retry.", id, { rateLimit: auth.rateLimit });
    } else {
      console.error("[developer-api-v3] player lookup failed", { requestId: id, status });
      sendError(res, 502, "upstream_unavailable", "The player lookup provider is temporarily unavailable.", id, { rateLimit: auth.rateLimit });
    }
  }
}
