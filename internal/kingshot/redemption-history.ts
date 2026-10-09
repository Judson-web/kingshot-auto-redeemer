// Keep the worker's durable-history interpretation in one testable place.
export const HANDLED_REDEMPTION_STATUSES = new Set([
  "SUCCESS",
  "RECEIVED",
  "SAME TYPE EXCHANGE",
  "TIME_ERROR",
  "CDK_NOT_FOUND",
  "USAGE_LIMIT",
  // Player-specific profile/eligibility failures must not block every later code.
  "STOVE_LV ERROR",
  "USER INFO ERROR"
]);

export function getHandledGiftCodes(history: unknown): Set<string> {
  if (!Array.isArray(history)) return new Set();
  return new Set(
    history
      .filter((row) => HANDLED_REDEMPTION_STATUSES.has(String(row?.status ?? "").trim().toUpperCase()))
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
