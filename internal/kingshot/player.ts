import { getPlayer, getPlayerSnapshot, type KingshotPlayer } from "./mightpulse.js";
import { allianceDetails, playerPower } from "../../lib/player-display.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

export class PlayerLookupError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); this.name = "PlayerLookupError"; }
}
export function normalizePlayerId(value: unknown): string { return String(value || "").trim(); }
export function isValidPlayerId(value: string): boolean { return /^\d{5,20}$/.test(value); }

async function syncRegisteredPlayerProfile(playerId: string, player: KingshotPlayer): Promise<void> {
  if (!SUPABASE_KEY) return;
  const kingdomId = String(player.kid ?? player.kingdom_id ?? "").replace(/\D/g, "");
  const playerName = String(player.nick_name || player.name || player.nickname || "").trim().slice(0, 120);
  const avatarUrl = String(player.avatar_url || player.avatar || player.avatarUrl || "").trim().slice(0, 500);
  const { name: allianceName, tag: allianceTag } = allianceDetails(player);
  const power = playerPower(player);
  const rawTownCenterLevel = player.town_center_level ?? player.tc_level ?? player.townCenterLevel ?? player.town_center;
  const townCenterLevel = rawTownCenterLevel == null ? "" : String(rawTownCenterLevel).trim();
  const payload: Record<string, string> = { updated_at: new Date().toISOString() };
  if (kingdomId) payload.kingdom_id = kingdomId;
  if (playerName) payload.player_name = playerName;
  if (avatarUrl) payload.avatar_url = avatarUrl;
  if (power !== null) payload.player_power = String(power);
  // The provider uses a numeric progression value. Ignore unknown text formats so
  // an unexpected upstream value cannot make the whole profile PATCH fail.
  if (/^\\d{1,3}$/.test(townCenterLevel)) payload.town_center_level = townCenterLevel;
  if (allianceName) payload.alliance_name = allianceName;
  if (allianceTag) payload.alliance_tag = allianceTag;
  if (Object.keys(payload).length === 1) return;

  const response = await fetch(
    SUPABASE_URL + "/rest/v1/kingshot_autoredeem?player_id=eq." + encodeURIComponent(playerId),
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        authorization: "Bearer " + SUPABASE_KEY,
        "content-type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000)
    }
  );
  if (!response.ok) throw new Error("Could not refresh the stored player profile.");
}

export async function lookupPlayerWithMetadata(playerId: string) {
  try {
    const snapshot = await getPlayerSnapshot(playerId);
    try { await syncRegisteredPlayerProfile(playerId, snapshot.player); } catch {}
    return { ...snapshot, refreshed_at: new Date().toISOString() };
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