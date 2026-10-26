/**
 * Safe, bounded retry helpers for idempotent provider reads only.
 * Do not use these helpers for redemptions or other non-repeatable writes.
 */
export function shouldRetryProviderRead(error) {
  const status = Number(error?.status);
  if (Number.isFinite(status) && status > 0) {
    if (status === 404 || status === 400 || status === 401 || status === 403 || status === 429 || status === 501) return false;
    return status === 408 || status === 425 || (status >= 500 && status !== 501);
  }
  const message = String(error?.message || "").toLowerCase();
  if (/not configured|missing api key|invalid api key|credential/.test(message)) return false;
  return true;
}
export async function withBoundedProviderReadRetry(operation, options = {}) {
  const maxAttempts = Number.isInteger(options.maxAttempts) ? Math.max(1, Math.min(2, options.maxAttempts)) : 2;
  const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, Math.min(500, options.delayMs)) : 150;
  const shouldRetry = typeof options.shouldRetry === "function" ? options.shouldRetry : shouldRetryProviderRead;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try { return await operation(attempt); }
    catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error)) throw error;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
