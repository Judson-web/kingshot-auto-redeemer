const IMAGE_API = "https://ogimagen.com/api/template/preview";

function clean(value, max = 80) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

/**
 * OGImagen's public profile preview endpoint returns a PNG URL directly.
 * Only compact, display-safe card fields are sent, never raw provider JSON,
 * the player ID, or an API credential.
 */
export function playerImageUrl(data = {}) {
  const params = new URLSearchParams({
    template: "profile",
    title: clean(data.governor, 48) || "Kingshot Player",
    subtitle: "KINGDOM " + clean(data.kingdom, 10) + "  •  " + clean(data.alliance, 28),
    theme: "dark",
    brandColor: "#8E3D78",
    siteName: "KINGSHOT AUTO REDEEMER",
    authorName: "POWER " + clean(data.power, 14),
    authorHandle: "TC " + clean(data.townCenter, 8) + "  •  VIP " + clean(data.vip, 6),
    statValue: clean(data.kills, 14),
    statTrend: "KILLS",
    location: clean(data.coordinates, 18),
    label: "LIVE GOVERNOR PROFILE",
    ...(data.avatar ? { avatarUrl: clean(data.avatar, 300) } : {})
  });
  return IMAGE_API + "?" + params.toString();
}
