const normalizeStatus = (value: unknown): string =>
  String(value ?? "").trim().toUpperCase().replace(/_/g, " ").replace(/\s+/g, " ");

export interface GiftCodeValidationEvidence {
  status: "verified" | "invalid" | "expired" | "usage_limit";
  observed: Array<{ status: string; count: number }>;
}

/**
 * Resolve global code validity from actual redemption outcomes.
 * A positive result is authoritative and wins over conflicting negatives.
 * Player-specific failures and transport errors are intentionally ignored.
 */
export function resolveGiftCodeValidationStatus(
  codeCounts: Record<string, unknown>,
  code: string,
  currentStatus: unknown = "pending"
): GiftCodeValidationEvidence | null {
  const normalizedCode = String(code ?? "").trim().toUpperCase();
  if (!normalizedCode) return null;

  const current = String(currentStatus ?? "pending").trim().toLowerCase();
  const prefix = normalizedCode + "_STATUS_";
  const observed = Object.entries(codeCounts ?? {})
    .filter(([key, count]) => key.toUpperCase().startsWith(prefix) && Number(count) > 0)
    .map(([key, count]) => ({
      status: normalizeStatus(key.slice(prefix.length)),
      count: Number(count),
    }));

  if (!observed.length) return null;

  let status: GiftCodeValidationEvidence["status"] | null = null;
  if (observed.some((item) => ["SUCCESS", "RECEIVED", "SAME TYPE EXCHANGE"].includes(item.status))) {
    status = "verified";
  } else if (observed.some((item) => item.status === "USAGE LIMIT")) {
    status = "usage_limit";
  } else if (observed.some((item) => item.status === "CDK NOT FOUND")) {
    status = "invalid";
  } else if (observed.some((item) => item.status === "TIME ERROR")) {
    status = "expired";
  }

  if (!status) return null;
  if (status !== "verified" && !["pending", "indeterminate"].includes(current)) return null;
  return { status, observed };
}
