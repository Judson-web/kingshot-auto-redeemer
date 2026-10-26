/** Verify the current profile cookie and promote it to an owner cookie only when the server confirms owner identity. */
export async function ensureAdminWorkspaceSession(fetchImpl = fetch) {
  const response = await fetchImpl("/api/kingshot-player?developer=account-auth", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "dev-check" })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data?.error || "Could not verify the administrator session."), { status: response.status });
  }
  if (data?.authenticated !== true) {
    throw Object.assign(new Error("Administrator access could not be established for this Discord session. Sign in with the configured owner account."), { status: 401 });
  }
  return data;
}
