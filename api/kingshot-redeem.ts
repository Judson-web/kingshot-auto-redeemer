import { handleRedemptionRequest } from "../internal/kingshot/redeem-handler.js";
import { rateLimit } from "../lib/request-rate-limit.js";

export default async function handler(req, res) {
  return handleRedemptionRequest(req, res, { rateLimit });
}
