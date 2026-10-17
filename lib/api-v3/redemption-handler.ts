import { redeemKingshot } from "../../internal/kingshot/redeem.js";
import { validateV3RedemptionBody } from "../developer-api-v3-validation.js";
import type { V3AuthorizationContext, V3Request, V3Response } from "./types.js";
import { sendError, timestamp } from "./http.js";
export async function handleV3Redemption(req: V3Request, res: V3Response, id: string, auth: V3AuthorizationContext): Promise<void> {
  const validation = validateV3RedemptionBody(req.body);
  if (validation.valid === false) {
    sendError(res, 400, validation.code, validation.message, id, { rateLimit: auth.rateLimit });
    return;
  }
  try {
    const result = await redeemKingshot(validation.value);
    if (result.httpStatus === 504 || result.errorCategory === "TIMEOUT") {
      sendError(res, 504, "upstream_timeout", "The redemption provider timed out. Check the outcome before submitting another attempt.", id, { rateLimit: auth.rateLimit });
      return;
    }
    if (result.httpStatus >= 500) {
      if (/not configured/i.test(String(result.error || ""))) {
        sendError(res, 503, "upstream_not_configured", "The redemption provider is not configured on the server.", id, { rateLimit: auth.rateLimit });
      } else {
        sendError(res, 502, "upstream_unavailable", "The redemption provider is temporarily unavailable. Do not automatically retry an ambiguous outcome.", id, { rateLimit: auth.rateLimit });
      }
      return;
    }
    res.status(200).json({
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
    console.error("[developer-api-v3] redemption failed", { requestId: id, status: (error as { status?: number } | null)?.status });
    sendError(res, 502, "upstream_unavailable", "The redemption provider is temporarily unavailable. Do not automatically retry an ambiguous outcome.", id, { rateLimit: auth.rateLimit });
  }
}
