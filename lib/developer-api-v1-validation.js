/** Side-effect-free input validation for the deprecated V1 developer API. */
export function isValidV1PlayerId(value) {
  return typeof value === "string" && /^\d{5,20}$/.test(value);
}
export function isValidV1RedemptionInput(playerId, code, kid) {
  return isValidV1PlayerId(playerId) &&
    typeof code === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(code) &&
    typeof kid === "string" && /^\d{1,10}$/.test(kid);
}
