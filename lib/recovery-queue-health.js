export const RECOVERY_QUEUE_LIMITS = Object.freeze({
  pendingRecordSeconds: 15 * 60,
  inFlightSeconds: 10 * 60
});

/**
 * Return operational issues for recovery items that should already have moved.
 * Rows in needs_review deliberately do not fail the watchdog: those require
 * human review and must not be replayed automatically.
 */
export function findStalledRecoveryQueue(queue, limits = RECOVERY_QUEUE_LIMITS) {
  if (!queue || typeof queue !== "object") {
    return ["Redemption recovery queue metrics are missing from diagnostics."];
  }

  const checks = [
    ["pendingRecord", "pending_record", Number(limits.pendingRecordSeconds)],
    ["inFlight", "in_flight", Number(limits.inFlightSeconds)]
  ];
  const issues = [];

  for (const [key, state, maxAgeSeconds] of checks) {
    const entry = queue[key];
    if (!entry || typeof entry !== "object" || entry.count == null) {
      issues.push(state + " recovery queue metrics are missing.");
      continue;
    }

    const count = Number(entry.count);
    if (!Number.isSafeInteger(count) || count < 0) {
      issues.push(state + " recovery queue count is invalid.");
      continue;
    }
    if (count === 0) continue;

    if (entry.oldestAgeSeconds == null) {
      issues.push(state + " recovery queue age is unavailable (count " + count + ").");
      continue;
    }

    const ageSeconds = Number(entry.oldestAgeSeconds);
    if (!Number.isFinite(ageSeconds) || ageSeconds < 0) {
      issues.push(state + " recovery queue age is invalid (count " + count + ").");
      continue;
    }

    if (ageSeconds > maxAgeSeconds) {
      issues.push(
        state + " recovery backlog is " + Math.round(ageSeconds) +
        "s old (count " + count + ", limit " + maxAgeSeconds + "s)."
      );
    }
  }

  return issues;
}
