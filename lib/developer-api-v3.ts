import type { V3Request, V3Response } from "./api-v3/types.js";
import { authorizeDeveloperKey } from "./api-v3/auth.js";
import { handleV3PlayerLookup } from "./api-v3/player-handler.js";
import { handleV3Redemption } from "./api-v3/redemption-handler.js";
import { requestId, sendError, isJsonRequest, setPublicHeaders } from "./api-v3/http.js";
export default async function developerApiV3(req: V3Request, res: V3Response, path: string): Promise<void> {
  const id = requestId();
  const method = String(req.method || "GET").toUpperCase();
  const route = path === "player" ? "player" : path === "redemptions" ? "redemptions" : "";
  const allowedMethod = route === "redemptions" ? "POST" : "GET";
  res.setHeader("X-Request-Id", id);
  res.setHeader("X-API-Version", "3");
  setPublicHeaders(res, allowedMethod);
  if (method === "OPTIONS") {
    const response = res.status(204);
    if (typeof response.end === "function") response.end();
    else response.json({});
    return;
  }
  if (!route) {
    sendError(res, 404, "route_not_found", "V3 API route not found.", id, { documentation: "/developer" });
    return;
  }
  if (method !== allowedMethod) {
    res.setHeader("Allow", allowedMethod + ", OPTIONS");
    sendError(res, 405, "method_not_allowed", "This method is not supported for the requested V3 route.", id);
    return;
  }
  if (route === "redemptions" && !isJsonRequest(req)) {
    sendError(res, 415, "unsupported_media_type", "Send the redemption request as application/json.", id);
    return;
  }
  const auth = await authorizeDeveloperKey(req, res, id);
  if (!auth) return;
  if (route === "player") {
    await handleV3PlayerLookup(req, res, id, auth);
    return;
  }
  await handleV3Redemption(req, res, id, auth);
}
