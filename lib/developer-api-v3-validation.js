/**
 * Side-effect-free validation helpers for Developer API V3.
 * @param {unknown} input
 * @returns {string | null}
 */
export function normalizeV3PlayerId(input) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  return /^\d{5,20}$/.test(value) ? value : null;
}

/**
 * @param {unknown} input
 * @returns {{ valid: true, value: { playerId: string, code: string, kid: string } } | { valid: false, code: string, message: string }}
 */
export function validateV3RedemptionBody(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, code: "invalid_request_body", message: "Provide a JSON object containing playerId, code, and kid." };
  }
  const body = /** @type {Record<string, unknown>} */ (input);
  const allowed = new Set(["playerId", "code", "kid"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    return { valid: false, code: "unknown_fields", message: "The request body contains unsupported fields." };
  }
  const playerId = typeof body.playerId === "string" ? body.playerId.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const kid = typeof body.kid === "string" ? body.kid.trim() : "";
  if (!/^\d{5,20}$/.test(playerId)) return { valid: false, code: "invalid_player_id", message: "playerId must be a string containing 5–20 digits." };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(code)) return { valid: false, code: "invalid_gift_code", message: "code must contain 1–64 letters, digits, underscores, or hyphens." };
  if (!/^\d{1,10}$/.test(kid)) return { valid: false, code: "invalid_kingdom_id", message: "kid must be a string containing 1–10 digits." };
  return { valid: true, value: { playerId, code, kid } };
}
