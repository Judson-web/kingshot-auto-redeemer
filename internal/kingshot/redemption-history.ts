// Keep the worker's durable-history interpretation in one testable place.
// Normalize legacy enum spellings and persisted human-readable status labels to
// the same key. The upstream may return "STOVE_LV ERROR" while Postgres stores
// "STOVE LV ERROR"; both must suppress repeat attempts for that player/code.
const normalizeRedemptionStatus = (value: unknown): string =>
  String(value ?? "").trim().toUpperCase().replace(/_/g, " ").replace(/\s+/g, " ");

export const HANDLED_REDEMPTION_STATUSES = new Set([
  "SUCCESS",
  "RECEIVED",
  "SAME TYPE EXCHANGE",
  "TIME ERROR",
  "CDK NOT FOUND",
  "USAGE LIMIT",
  // Player-specific profile/eligibility failures must not block every later code.
  "STOVE LV ERROR",
  "USER INFO ERROR",
  // Concierge-service accounts may be ineligible for gift-code redemption.
  // Handle this for that player, but do not invalidate the code globally.
  "RECHARGE MONEY ERROR"
]);

export function getHandledGiftCodes(history: unknown): Set<string> {
  if (!Array.isArray(history)) return new Set();
  return new Set(
    history
      .filter((row) => {
        const status = normalizeRedemptionStatus(row?.status);
        const errCode = Number(row?.err_code);
        // Only the explicit Kingshot TOO FREQUENT response (40019) is safe to
        // retry after the shared cooldown. Network timeouts (40004), abandoned
        // PROCESSING claims, and unclassified ERROR rows are uncertain outcomes.
        if (status === "TIMEOUT RETRY") return errCode !== 40019;
        if (status === "PROCESSING" || status === "ERROR") return true;
        return HANDLED_REDEMPTION_STATUSES.has(status);
      })
      .map((row) => String(row?.gift_code ?? "").trim().toUpperCase())
      .filter(Boolean)
  );
}

export function selectNextOutstandingCode<T extends { code?: unknown }>(
  codes: T[],
  handledCodes: Set<string>
): T | undefined {
  if (!Array.isArray(codes)) return undefined;
  return codes.find((item) => {
    const code = String(item?.code ?? "").trim();
    return Boolean(code) && !handledCodes.has(code.toUpperCase());
  });
}
