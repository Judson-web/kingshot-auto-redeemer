const decodeEntities = value => String(value || "")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#0*39;/gi, "'")
  .replace(/&#x0*27;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&nbsp;/gi, " ");

function readAttribute(tag, name) {
  const pattern = "(?:^|\\s)" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))";
  const match = new RegExp(pattern, "i").exec(tag);
  return decodeEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

export function validateFrameAssetId(value) {
  const assetId = String(value ?? "");
  return /^\d{6,12}$/.test(assetId) ? assetId : null;
}

/**
 * Extract only MightPulse's known equipped-avatar-frame element.
 * Untrusted HTML is reduced to a validated numeric asset ID and plain label.
 */
export function extractMightPulseAvatarFrame(html) {
  if (typeof html !== "string" || !html || html.length > 2_000_000) return null;
  const tag = html.match(/<img\b[^>]*\bid\s*=\s*["']profileAvatarFrame["'][^>]*>/i)?.[0];
  if (!tag) return null;

  const rawSource = readAttribute(tag, "src").trim();
  if (!rawSource) return null;

  let source;
  try {
    source = new URL(rawSource, "https://www.mightpulse.com");
  } catch {
    return null;
  }

  if (
    source.protocol !== "https:" ||
    source.hostname !== "www.mightpulse.com" ||
    source.port ||
    source.username ||
    source.password ||
    source.search ||
    source.hash
  ) return null;

  const assetMatch = /^\/assets\/icons\/skin_icon_(\d{6,12})\.png$/i.exec(source.pathname);
  if (!assetMatch) return null;

  const label = (readAttribute(tag, "title") || readAttribute(tag, "alt") || "Avatar Frame")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  return { assetId: assetMatch[1], name: label || "Avatar Frame" };
}

/**
 * Resolve MightPulse's internal profile UID from its public search response.
 * The website profile route is keyed by UID, not the in-game governor/FID.
 */
export function resolveMightPulseProfileUid(payload, governorId) {
  const requested = String(governorId ?? "").trim();
  if (!/^\d{5,20}$/.test(requested) || !payload || typeof payload !== "object") return null;

  // The authenticated API may wrap the player record at different levels.
  // Only trust a candidate UID when the same record's governor ID matches exactly.
  const records = [
    payload,
    payload.player,
    payload.data,
    payload.data?.player,
    payload.data?.data,
    payload.data?.data?.player,
  ];
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) continue;
    const recordGovernorId = String(
      record.fid ?? record.governor_id ?? record.governorId ?? record.player_id ?? ""
    ).trim();
    const recordUid = String(
      record.uid ?? record.profile_uid ?? record.profile_id ?? record.internal_uid ?? record.id ?? ""
    ).trim();
    if (recordGovernorId === requested && /^\d{1,20}$/.test(recordUid)) return recordUid;
  }

  // Public site search returns { results: [{ uid, fid, ... }] }.
  const resultLists = [payload.results, payload.data?.results, payload.players, payload.data?.players];
  for (const results of resultLists) {
    if (!Array.isArray(results)) continue;
    const match = results.find((player) =>
      String(player?.fid ?? player?.governor_id ?? player?.governorId ?? player?.player_id ?? "").trim() === requested
    );
    const uid = String(match?.uid ?? match?.profile_uid ?? match?.profile_id ?? match?.id ?? "").trim();
    if (/^\d{1,20}$/.test(uid)) return uid;
  }
  return null;
}


/**
 * Extract an equipped avatar frame from MightPulse's public player JSON.
 * The website selects equipped skins where skintype === 4 and an icon is present.
 */
export function extractMightPulseAvatarFrameFromPlayerData(payload) {
  if (!payload || typeof payload !== "object") return null;
  const player = payload.player && typeof payload.player === "object" ? payload.player : payload;
  if (!Array.isArray(player.skins)) return null;

  const skin = player.skins.find((item) => Number(item?.skintype) === 4 && item?.icon);
  if (!skin) return null;

  const label = String(skin.name || "Avatar Frame")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Avatar Frame";

  const id = validateFrameAssetId(skin.id);
  if (id === "6080010" || label.toLowerCase().includes("starter")) return null;

  let source;
  try {
    source = new URL(String(skin.icon).trim(), "https://www.mightpulse.com");
  } catch {
    return null;
  }

  if (
    source.protocol !== "https:" ||
    source.hostname !== "www.mightpulse.com" ||
    source.port ||
    source.username ||
    source.password ||
    source.search ||
    source.hash
  ) return null;

  const assetMatch = /^\/assets\/icons\/skin_icon_(\d{6,12})\.png$/i.exec(source.pathname);
  if (!assetMatch || (id && id !== assetMatch[1])) return null;

  return { assetId: assetMatch[1], name: label };
}
