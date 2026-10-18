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

  // Official API responses put uid/governor_id at the wrapper level.
  const wrapperGovernorId = String(
    payload.governor_id ?? payload.player?.fid ?? payload.player?.governor_id ?? ""
  ).trim();
  const wrapperUid = String(payload.uid ?? "").trim();
  if (wrapperGovernorId === requested && /^\d{1,20}$/.test(wrapperUid)) return wrapperUid;

  // Public site search returns { results: [{ uid, fid, ... }] }.
  if (!Array.isArray(payload.results)) return null;
  const match = payload.results.find((player) =>
    String(player?.fid ?? player?.governor_id ?? player?.player_id ?? "").trim() === requested
  );
  const uid = String(match?.uid ?? "").trim();
  return /^\d{1,20}$/.test(uid) ? uid : null;
}
