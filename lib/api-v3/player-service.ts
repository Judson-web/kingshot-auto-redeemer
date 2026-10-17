import { getPlayerSnapshot } from "../../internal/kingshot/mightpulse.js";
import { withBoundedProviderReadRetry } from "./retry.js";
const PLAYER_LOOKUP_ATTEMPT_TIMEOUT_MS = 3400;
export async function lookupPlayerSnapshotV3(playerId: string) {
  return withBoundedProviderReadRetry(
    () => getPlayerSnapshot(playerId, { timeoutMs: PLAYER_LOOKUP_ATTEMPT_TIMEOUT_MS }),
    { maxAttempts: 2, delayMs: 150 }
  );
}
