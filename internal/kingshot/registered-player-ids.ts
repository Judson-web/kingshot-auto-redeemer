const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co").replace(/\/$/, "");
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();

/**
 * Read-only reconciliation against Supabase, the authoritative player registry.
 * Any failure throws so the caller can fail closed instead of risking duplicate work.
 */
export async function getRegisteredPlayerIds(playerIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(playerIds.map(value => String(value).trim()))];
  if (!ids.length) return new Set<string>();
  if (ids.some(id => !/^\d{5,20}$/.test(id))) throw new Error("Invalid player ID in registration reconciliation.");
  if (!SUPABASE_KEY) throw new Error("Supabase registration status is not configured.");
  const registered = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const query = new URLSearchParams({ select: "player_id", player_id: "in.(" + batch.join(",") + ")" });
    const response = await fetch(SUPABASE_URL + "/rest/v1/kingshot_autoredeem?" + query.toString(), {
      method: "GET",
      headers: { apikey: SUPABASE_KEY, authorization: "Bearer " + SUPABASE_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error("Could not reconcile alliance members with Supabase.");
    const rows: unknown = await response.json().catch(() => null);
    if (!Array.isArray(rows)) throw new Error("Supabase returned an invalid registration-status response.");
    for (const row of rows) {
      const id = String((row as { player_id?: unknown })?.player_id ?? "");
      if (batch.includes(id)) registered.add(id);
    }
  }
  return registered;
}


/**
 * Read-only batch lookup of restricted player IDs.
 * Fails closed so an unavailable ban check never causes unnecessary registration attempts.
 */
export async function getBannedPlayerIds(playerIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(playerIds.map(value => String(value).trim()))];
  if (!ids.length) return new Set<string>();
  if (ids.some(id => !/^\\d{5,20}$/.test(id))) throw new Error("Invalid player ID in ban reconciliation.");
  if (!SUPABASE_KEY) throw new Error("Supabase ban status is not configured.");
  const banned = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const query = new URLSearchParams({ select: "player_id", player_id: "in.(" + batch.join(",") + ")" });
    const response = await fetch(SUPABASE_URL + "/rest/v1/kingshot_player_bans?" + query.toString(), {
      method: "GET",
      headers: { apikey: SUPABASE_KEY, authorization: "Bearer " + SUPABASE_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error("Could not reconcile alliance members with the player-ban registry.");
    const rows: unknown = await response.json().catch(() => null);
    if (!Array.isArray(rows)) throw new Error("Supabase returned an invalid player-ban response.");
    for (const row of rows) {
      const id = String((row as { player_id?: unknown })?.player_id ?? "");
      if (batch.includes(id)) banned.add(id);
    }
  }
  return banned;
}
