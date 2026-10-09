import { handleRedemptionRequest } from "../internal/kingshot/redeem-handler.ts";
import { rateLimit } from "../lib/request-rate-limit.ts";

export default async function handler(req, res) {
  return handleRedemptionRequest(req, res, { rateLimit });
}
