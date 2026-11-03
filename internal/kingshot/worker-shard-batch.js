export function workerBucket(value, workerCount) {
  const input = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % workerCount;
}

export function selectWorkerShardBatch(players, slot, workerCount, cycleBucket, batchSize = 2) {
  const assigned = (Array.isArray(players) ? players : [])
    .filter(player => workerBucket(player?.player_id, workerCount) === slot)
    .slice()
    .sort((a, b) => {
      const left = String(a?.player_id || "");
      const right = String(b?.player_id || "");
      return left.length - right.length || left.localeCompare(right);
    });
  const size = Math.max(1, Math.min(10, Math.floor(Number(batchSize) || 2)));
  const batchCount = Math.max(1, Math.ceil(assigned.length / size));
  const safeBucket = Number.isSafeInteger(cycleBucket) && cycleBucket >= 0 ? cycleBucket : 0;
  const batchIndex = assigned.length ? safeBucket % batchCount : 0;
  const selected = assigned.slice(batchIndex * size, batchIndex * size + size);
  return { players: selected, deferredPlayers: assigned.length - selected.length, batchIndex, batchCount };
}
