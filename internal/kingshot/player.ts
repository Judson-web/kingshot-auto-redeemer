import { getPlayer, type KingshotPlayer } from "./mightpulse.js";

export class PlayerLookupError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); this.name = "PlayerLookupError"; }
}
export function normalizePlayerId(value: unknown): string { return String(value || "").trim(); }
export function isValidPlayerId(value: string): boolean { return /^\d{5,20}$/.test(value); }
export async function lookupPlayer(playerId: string): Promise<KingshotPlayer> {
  try { return await getPlayer(playerId); }
  catch (error) { const typed = error as { message?: string; status?: number }; throw new PlayerLookupError(typed.message || "MightPulse request failed.", typed.status); }
}
