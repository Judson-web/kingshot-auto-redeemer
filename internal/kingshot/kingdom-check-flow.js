const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 40;

function comparePlayerIds(leftValue, rightValue) {
  const left = String(leftValue ?? "").trim();
  const right = String(rightValue ?? "").trim();
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const leftBigInt = BigInt(left);
    const rightBigInt = BigInt(right);
    return leftBigInt < rightBigInt ? -1 : leftBigInt > rightBigInt ? 1 : 0;
  }
  return left.localeCompare(right);
}

export function normalizeKingdomCheckBatchOptions(options = {}) {
  const rawSize = Number(options.batchSize);
  const batchSize = Number.isFinite(rawSize) && rawSize > 0
    ? Math.min(MAX_BATCH_SIZE, Math.floor(rawSize))
    : DEFAULT_BATCH_SIZE;
  return {
    after: String(options.after ?? "").trim(),
    batchSize
  };
}

/**
 * Stable keyset pagination for manual kingdom checks.
 * Keyset cursors remain safe when earlier players are marked stale and removed
 * from the registration list between batch requests.
 */
export function selectKingdomCheckBatch(players, options = {}) {
  const normalized = normalizeKingdomCheckBatchOptions(options);
  const byId = new Map();

  for (const player of Array.isArray(players) ? players : []) {
    const id = String(player?.player_id ?? "").trim();
    if (id) byId.set(id, player);
  }

  const remaining = [...byId.entries()]
    .filter(([id]) => !normalized.after || comparePlayerIds(id, normalized.after) > 0)
    .sort(([left], [right]) => comparePlayerIds(left, right))
    .map(([, player]) => player);
  const batch = remaining.slice(0, normalized.batchSize);
  const lastPlayer = batch[batch.length - 1];

  return {
    players: batch,
    nextCursor: lastPlayer ? String(lastPlayer.player_id) : normalized.after || null,
    hasMore: remaining.length > batch.length,
    remainingCount: remaining.length,
    batchSize: normalized.batchSize,
    after: normalized.after || null
  };
}

export function summarizeKingdomCheckResults(results) {
  return (Array.isArray(results) ? results : []).reduce((summary, result) => {
    if (result?.deferred || result?.deadlineSkipped) summary.deferred++;
    if (result?.revalidationError) summary.errors++;
    if (result?.stale) summary.stale++;
    if (result?.revalidated) summary.checked++;
    if (result?.kingdomChanged) summary.changed++;
    if (result?.player?.kingdom_id) summary.validated++;
    return summary;
  }, { checked: 0, changed: 0, stale: 0, errors: 0, deferred: 0, validated: 0 });
}
