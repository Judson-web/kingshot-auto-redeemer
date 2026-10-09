import { verifyKingdom, type KingdomVerification } from "./mightpulse.ts";

export interface RegisterPlayerInput { playerId?: unknown; kingdomId?: unknown; playerName?: unknown; avatarUrl?: unknown; }
export interface RegisterPlayerResult { registered: boolean; alreadyRegistered: boolean; registrationStatus: string; kingdomVerified: boolean; verificationPending?: boolean; stale?: boolean; verifiedKingdomId?: string; player?: unknown; }

const SUPABASE_URL = process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_KEY) throw Error("Supabase service key is not configured on the server.");

async function rpc(name: string, body: Record<string, unknown>): Promise<any> {
 const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, { method: "POST", headers: { apikey: SUPABASE_KEY, authorization: "Bearer " + SUPABASE_KEY, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
 const d = await r.json().catch(() => null);
 if (!r.ok) throw Error(d?.message || "Supabase request failed.");
 return Array.isArray(d) ? d[0] : d;
}

export function normalizeRegistrationInput(body: RegisterPlayerInput) {
 const playerId = String(body.playerId ?? "").replace(/\D/g, "");
 const kingdomId = String(body.kingdomId ?? "").replace(/\D/g, "");
 const playerName = String(body.playerName ?? "").trim().slice(0, 120);
 const avatarUrl = String(body.avatarUrl ?? "").trim().slice(0, 500);
 return { playerId, kingdomId, playerName, avatarUrl };
}

export async function registerPlayer(input: ReturnType<typeof normalizeRegistrationInput>): Promise<RegisterPlayerResult> {
 const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/register_kingshot_player_v2", { method: "POST", headers: { apikey: SUPABASE_KEY, authorization: "Bearer " + SUPABASE_KEY, "content-type": "application/json" }, body: JSON.stringify({ p_player_id: input.playerId, p_kingdom_id: input.kingdomId || null, p_player_name: input.playerName || null, p_avatar_url: input.avatarUrl || null }), signal: AbortSignal.timeout(10000) });
 const d = await r.json().catch(() => null);
 if (!r.ok) throw Error(d?.message || d?.hint || "Could not register this player.");
 const result = Array.isArray(d) ? d[0] : d;
 try {
  const verified: KingdomVerification = await verifyKingdom(input.playerId);
  if (verified.notFound) {
   await rpc("mark_kingshot_player_stale", { p_player_id: input.playerId, p_reason: "MIGHTPULSE_PLAYER_NOT_FOUND" });
   return { registered: true, alreadyRegistered: Boolean(result?.already_registered), registrationStatus: result?.registration_status || (result?.already_registered ? "ALREADY_REGISTERED" : "NEW"), kingdomVerified: false, stale: true, player: result?.player || result };
  }
  await rpc("record_kingshot_kingdom_revalidation", { p_player_id: input.playerId, p_kingdom_id: verified.kingdomId, p_player_name: verified.name || input.playerName || null, p_avatar_url: verified.avatarUrl || input.avatarUrl || null });
  return { registered: true, alreadyRegistered: Boolean(result?.already_registered), registrationStatus: result?.registration_status || (result?.already_registered ? "ALREADY_REGISTERED" : "NEW"), kingdomVerified: true, verifiedKingdomId: verified.kingdomId, player: result?.player || result };
 } catch {
  return { registered: true, alreadyRegistered: Boolean(result?.already_registered), registrationStatus: result?.registration_status || (result?.already_registered ? "ALREADY_REGISTERED" : "NEW"), kingdomVerified: false, verificationPending: true, player: result?.player || result };
 }
}
