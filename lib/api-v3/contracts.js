import { normalizeV3PlayerId } from "../developer-api-v3-validation.js";
import { allianceDetails } from "../player-display.js";
function finiteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
function safeHttpsUrl(value) {
  if (typeof value !== "string" || value.length > 1000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString().slice(0, 500) : null;
  } catch { return null; }
}
export function normalizeV3PlayerData(input, requestedPlayerId) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    const error = new Error("The player provider returned an invalid player record.");
    error.code = "invalid_provider_payload";
    throw error;
  }
  const player = input;
  const rawId = player.player_id ?? player.governor_id ?? player.fid ?? player.id;
  const rawIdText = rawId === undefined || rawId === null ? "" : String(rawId).trim();
  const providerId = rawIdText ? normalizeV3PlayerId(rawIdText) : null;
  if (rawIdText && !providerId) {
    const error = new Error("The player provider returned an invalid player ID.");
    error.code = "invalid_provider_payload";
    throw error;
  }
  if (providerId && providerId !== requestedPlayerId) {
    const error = new Error("The player provider returned a different player ID.");
    error.code = "provider_player_mismatch";
    throw error;
  }
  const rawName = player.nick_name ?? player.name ?? player.nickname;
  const name = typeof rawName === "string"
    ? rawName.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) || null
    : null;
  const rawKingdom = player.kid ?? player.kingdom_id;
  const kingdomText = rawKingdom === undefined || rawKingdom === null ? "" : String(rawKingdom).trim();
  const kingdomId = /^\d{1,10}$/.test(kingdomText) ? kingdomText : null;
  const alliance = allianceDetails(player);
  return {
    playerId: providerId || requestedPlayerId,
    name,
    kingdomId,
    power: finiteNumber(player.power),
    townCenterLevel: finiteNumber(player.town_center_level ?? player.tc_level ?? player.townCenterLevel),
    avatarUrl: safeHttpsUrl(player.avatar_url ?? player.avatar ?? player.avatarUrl),
    allianceName: alliance.name || null,
    allianceTag: alliance.tag || null
  };
}
export function normalizeV3ProviderMetadata(snapshot) {
  const fetchedAt = typeof snapshot.cached_at === "string" && Number.isFinite(Date.parse(snapshot.cached_at)) ? snapshot.cached_at : null;
  const age = finiteNumber(snapshot.age_seconds);
  return {
    fetchedAt,
    providerFresh: typeof snapshot.fresh === "boolean" ? snapshot.fresh : null,
    providerAgeSeconds: age !== null && age >= 0 ? Math.floor(age) : null,
    stale: typeof snapshot.fresh === "boolean" ? snapshot.fresh === false : null
  };
}
