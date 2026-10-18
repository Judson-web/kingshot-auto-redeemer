function clean(value, maxLength = 120) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

export function allianceDetails(player = {}) {
  const nested = player?.alliance && typeof player.alliance === "object" && !Array.isArray(player.alliance)
    ? player.alliance
    : {};
  const name = clean(player?.alliance_name)
    || clean(player?.allianceName)
    || clean(nested.name, 100)
    || (typeof player?.alliance === "string" ? clean(player.alliance, 100) : "")
    || clean(player?.guild_name, 100);
  const tag = (
    clean(player?.alliance_tag, 32)
    || clean(player?.allianceTag, 32)
    || clean(player?.alliance_abbr, 32)
    || clean(player?.allianceAbbr, 32)
    || clean(nested.abbr, 32)
    || clean(nested.tag, 32)
    || clean(nested.abbreviation, 32)
    || clean(nested.short_name, 32)
    || clean(nested.shortName, 32)
  ).replace(/^\[|\]$/g, "").trim().slice(0, 32);
  return { name, tag };
}

export function playerDisplayName(player = {}, fallback = "Kingshot Player") {
  const name = clean(player?.nick_name)
    || clean(player?.player_name)
    || clean(player?.name)
    || clean(player?.nickname);
  if (!name) return fallback;
  const { tag } = allianceDetails(player);
  return tag && !name.toLowerCase().includes("[" + tag.toLowerCase() + "]")
    ? name + " [" + tag + "]"
    : name;
}

export function allianceDisplayName(player = {}) {
  const { name, tag } = allianceDetails(player);
  if (name && tag && !name.toLowerCase().includes("[" + tag.toLowerCase() + "]")) return name + " [" + tag + "]";
  return name || (tag ? "[" + tag + "]" : "—");
}

export function playerPower(player = {}) {
  const raw = player?.power ?? player?.player_power;
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const value = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function formatPower(value) {
  if (value === null || value === undefined || String(value).trim() === "") return "—";
  const number = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(number) || number < 0) return "—";
  if (number >= 1e9) return (number / 1e9).toFixed(2) + "B";
  if (number >= 1e6) return (number / 1e6).toFixed(2) + "M";
  if (number >= 1e3) return (number / 1e3).toFixed(1) + "K";
  return Math.round(number).toLocaleString("en-US");
}
