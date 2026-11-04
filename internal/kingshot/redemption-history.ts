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
      .filter((row) => HANDLED_REDEMPTION_STATUSES.has(normalizeRedemptionStatus(row?.status)))
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


// Pre-filter the roster using one bulk history snapshot before shard batching.
// Only terminal/handled player-code states are excluded; transient failures stay
// eligible for retry. The same snapshot is passed to the shard to avoid a second
// per-player history read and keep the decision consistent within the cycle.
export function filterPlayersWithOutstandingCodes(players, codes, historyRows) {
  const historiesByPlayer = new Map();
  for (const row of Array.isArray(historyRows) ? historyRows : []) {
    const id = String(row?.player_id ?? "").trim();
    if (!id) continue;
    if (!historiesByPlayer.has(id)) historiesByPlayer.set(id, []);
    const { player_id, ...history } = row;
    historiesByPlayer.get(id).push(history);
  }

  const eligiblePlayers = [];
  const alreadyHandledPlayers = [];
  for (const player of Array.isArray(players) ? players : []) {
    const id = String(player?.player_id ?? "").trim();
    const handled = getHandledGiftCodes(historiesByPlayer.get(id) || []);
    if (selectNextOutstandingCode(Array.isArray(codes) ? codes : [], handled)) eligiblePlayers.push(player);
    else alreadyHandledPlayers.push(player);
  }

  return { eligiblePlayers, alreadyHandledPlayers, historiesByPlayer };
}
