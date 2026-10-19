/**
 * Classifies provider failures for Kingdom Check.
 *
 * Quota exhaustion/cooldown is deferred work, not a player-validation error.
 * Credential/schema configuration failures deliberately remain errors so they
 * cannot silently mask a broken deployment.
 */
const DEFERRED_QUOTA_MESSAGE =
  /(?:all configured mightpulse keys are (?:(?:cooling down|in cooldown|rate limited)(?: or have no reserved request headroom)?)|mightpulse .*cooldown active|no reserved request headroom|daily request budget is exhausted|out of request headroom|rate[_ -]?limited|rate limit|too many requests)/i;

export function isKingdomValidationDeferred(error) {
  const status = Number(error?.status || 0);
  const message = String(error instanceof Error ? error.message : error ?? "");
  if (status === 429) return true;
  if (DEFERRED_QUOTA_MESSAGE.test(message)) return true;
  return false;
}

export function getKingdomValidationRetryAfterMs(error) {
  const value = Number(error?.retryAfterMs);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
