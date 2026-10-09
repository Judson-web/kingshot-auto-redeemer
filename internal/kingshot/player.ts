import { getPlayer, type KingshotPlayer } from "./mightpulse.ts";

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
  const payload: Record<string, string> = { updated_at: new Date().toISOString() };
  if (kingdomId) payload.kingdom_id = kingdomId;
  if (playerName) payload.player_name = playerName;
  if (avatarUrl) payload.avatar_url = avatarUrl;
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

export async function lookupPlayer(playerId: string): Promise<KingshotPlayer> {
  try {
    const player = await getPlayer(playerId);
    try { await syncRegisteredPlayerProfile(playerId, player); } catch {}
    return player;
  }
  catch (error) { const typed = error as { message?: string; status?: number }; throw new PlayerLookupError(typed.message || "MightPulse request failed.", typed.status); }
}