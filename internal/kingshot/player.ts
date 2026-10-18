import { getPlayer, getPlayerSnapshot, type KingshotPlayer } from "./mightpulse.js";
import { allianceDetails, playerPower } from "../../lib/player-display.js";
import { normalizeTownCenterValue } from "../../lib/town-center-level.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

export class PlayerLookupError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); this.name = "PlayerLookupError"; }
}
export function normalizePlayerId(value: unknown): string { return String(value || "").trim(); }
export function isValidPlayerId(value: string): boolean { return /^\d{5,20}$/.test(value); }

export async function syncRegisteredPlayerProfile(playerId: string, player: KingshotPlayer): Promise<boolean> {
  if (!SUPABASE_KEY) return false;
  const kingdomId = String(player.kid ?? player.kingdom_id ?? "").replace(/\D/g, "");
  const playerName = String(player.nick_name || player.name || player.nickname || "").trim().slice(0, 120);
  const avatarUrl = String(player.avatar_url || player.avatar || player.avatarUrl || "").trim().slice(0, 500);
  const { name: allianceName, tag: allianceTag } = allianceDetails(player);
  const power = playerPower(player);
  const rawTownCenterLevel = player.town_center_level ?? player.tc_level ?? player.townCenterLevel ?? player.town_center;
  const townCenterLevel = normalizeTownCenterValue(rawTownCenterLevel);
  const payload: Record<string, string> = { updated_at: new Date().toISOString() };
  if (kingdomId) payload.kingdom_id = kingdomId;
  if (playerName) payload.player_name = playerName;
  if (avatarUrl) payload.avatar_url = avatarUrl;
  if (power !== null) payload.player_power = String(power);
  // The provider uses a numeric progression value. Ignore unknown text formats so
  // an unexpected upstream value cannot make the whole profile PATCH fail.
  if (townCenterLevel !== null) payload.town_center_level = townCenterLevel;
  if (allianceName) payload.alliance_name = allianceName;
  if (allianceTag) payload.alliance_tag = allianceTag;
  if (Object.keys(payload).length === 1) return false;

  const response = await fetch(
    SUPABASE_URL + "/rest/v1/kingshot_autoredeem?player_id=eq." + encodeURIComponent(playerId) + "&select=player_id",
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        authorization: "Bearer " + SUPABASE_KEY,
        "content-type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000)
    }
  );
  if (!response.ok) throw new Error("Could not save the refreshed player profile.");
  const updated = await response.json().catch(() => null);
  return Array.isArray(updated) && updated.length > 0;
}

export async function lookupPlayerWithMetadata(playerId: string) {
  try {
    const snapshot = await getPlayerSnapshot(playerId);
    let profileSynced = false;
    let profileSyncError: string | null = null;
    try { profileSynced = await syncRegisteredPlayerProfile(playerId, snapshot.player); }
    catch { profileSyncError = "The player profile could not be saved to the database."; }
    return { ...snapshot, profileSynced, profileSyncError, refreshed_at: new Date().toISOString() };
  }
  catch (error) { const typed = error as { message?: string; status?: number }; throw new PlayerLookupError(typed.message || "MightPulse request failed.", typed.status); }
}
export async function lookupPlayer(playerId: string): Promise<KingshotPlayer> {
  try {
    const player = await getPlayer(playerId);
    try { await syncRegisteredPlayerProfile(playerId, player); } catch {}
    return player;
  }
  catch (error) { const typed = error as { message?: string; status?: number }; throw new PlayerLookupError(typed.message || "MightPulse request failed.", typed.status); }
}