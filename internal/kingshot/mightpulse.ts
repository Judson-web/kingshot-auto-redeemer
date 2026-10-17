const MIGHTPULSE_BASE_URL = "https://api.mightpulse.com/v1/players/";

export interface KingshotPlayer {
  player_id?: string;
  fid?: string;
  kid?: string | number;
  kingdom_id?: string | number;
  nick_name?: string;
  name?: string;
  nickname?: string;
  avatar_url?: string;
  avatar?: string;
  avatarUrl?: string;
  [key: string]: unknown;
}

export interface KingdomVerification {
  notFound?: boolean;
  kingdomId?: string;
  name?: string | null;
  avatarUrl?: string | null;
}

interface ApiError extends Error {
  status?: number;
}

function getKey(): string {
  const key = process.env.MIGHTPULSE_API_KEY || process.env.KSS_API_KEY;
  if (!key) throw new Error("MightPulse API key is not configured on the server.");
  return key;
}

async function fetchPlayer(playerId: string) {
  const key = getKey();
  const response = await fetch(
    MIGHTPULSE_BASE_URL + encodeURIComponent(playerId) + "?include=base",
    {
      headers: { Authorization: "Bearer " + key },
      signal: AbortSignal.timeout(15000)
    }
  );
  const data = (await response.json().catch(() => ({}))) as {
    player?: KingshotPlayer;
    fresh?: boolean;
    cached_at?: string | null;
    age_seconds?: number | null;
    message?: string;
    error?: string;
    [key: string]: unknown;
  };
  return { response, data };
}

export interface MightPulsePlayerSnapshot {
  player: KingshotPlayer;
  fresh: boolean | null;
  cached_at: string | null;
  age_seconds: number | null;
}

export async function getPlayerSnapshot(playerId: string): Promise<MightPulsePlayerSnapshot> {
  const { response, data } = await fetchPlayer(playerId);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || "MightPulse could not find this player.") as ApiError;
    error.status = response.status;
    throw error;
  }
  return {
    player: data.player || (data as KingshotPlayer),
    fresh: typeof data.fresh === "boolean" ? data.fresh : null,
    cached_at: typeof data.cached_at === "string" ? data.cached_at : null,
    age_seconds: typeof data.age_seconds === "number" ? data.age_seconds : null
  };
}

export async function getPlayer(playerId: string): Promise<KingshotPlayer> {
  const { response, data } = await fetchPlayer(playerId);
  if (!response.ok) {
    const error = new Error(
      data?.message || data?.error || "MightPulse could not find this player."
    ) as ApiError;
    error.status = response.status;
    throw error;
  }
  return data.player || (data as KingshotPlayer);
}

export async function verifyKingdom(playerId: string): Promise<KingdomVerification> {
  const { response, data } = await fetchPlayer(playerId);
  if (response.status === 404) return { notFound: true };
  if (!response.ok) {
    throw new Error(
      data?.message || data?.error || "Could not verify the player kingdom."
    );
  }
  const player = data.player || (data as KingshotPlayer);
  const kingdomId = String(player.kid ?? player.kingdom_id ?? "").replace(/\D/g, "");
  if (!kingdomId) throw new Error("Kingdom verification returned no kingdom.");
  return {
    kingdomId,
    name: player.nick_name || player.name || player.nickname || null,
    avatarUrl: player.avatar_url || player.avatar || player.avatarUrl || null
  };
}
