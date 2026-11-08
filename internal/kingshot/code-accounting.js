export function summarizeCodeBreakdown(results) {
  const breakdownByCode = {};
  for (const result of Array.isArray(results) ? results : []) {
    for (const [code, count] of Object.entries(result?.handledCodeCounts || {})) {
      const breakdown = breakdownByCode[code] || (breakdownByCode[code] = {
        attempts: 0, successes: 0, alreadyReceived: 0, alreadyHandled: 0,
        queued: 0, failures: 0, statuses: {}
      });
      breakdown.alreadyHandled += Number(count || 0);
    }
    if (!result?.redemptionCode) continue;
    const code = String(result.redemptionCode);
    const status = String(result.redemptionStatus || "UNKNOWN").toUpperCase();
    const breakdown = breakdownByCode[code] || (breakdownByCode[code] = {
      attempts: 0, successes: 0, alreadyReceived: 0, alreadyHandled: 0,
      queued: 0, failures: 0, statuses: {}
    });
    breakdown.statuses[status] = (breakdown.statuses[status] || 0) + 1;
    if (status === "QUEUED") breakdown.queued++;
    else {
      breakdown.attempts++;
      if (status === "SUCCESS") breakdown.successes++;
      else if (status === "RECEIVED" || status === "SAME TYPE EXCHANGE") breakdown.alreadyReceived++;
      else breakdown.failures++;
    }
  }
  return breakdownByCode;
}
