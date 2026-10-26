/**
 * Classify admin API failures for the player database UI.
 * A failed/unauthenticated response must never be presented as a valid empty database.
 */
export function isAdminAccessDenied(error) {
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
  if (status === 401 || status === 403) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /(?:discord administrator sign-in required|administrator access required|unauthori[sz]ed|not authorized|access denied|administrator session (?:is )?(?:missing|expired)|session expired|sign in with the administrator)/i.test(message);
}
