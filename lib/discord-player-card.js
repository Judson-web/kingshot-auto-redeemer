import { renderPlayerCardPng } from "./discord-player-card-png.js";

function clean(value, max = 100) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

export default function playerCard(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  try {
    const encoded = clean(req.query?.data, 6000);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return res.status(400).end();
    const data = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data) || !/^\d{5,20}$/.test(clean(data.playerId, 20))) {
      return res.status(400).end();
    }
    const card = {
      governor: clean(data.governor, 48) || "KINGSHOT PLAYER",
      tag: clean(data.tag, 12),
      playerId: clean(data.playerId, 20),
      kingdom: clean(data.kingdom, 12),
      alliance: clean(data.alliance, 36),
      rank: clean(data.rank, 16),
      power: clean(data.power, 16),
      kills: clean(data.kills, 16),
      townCenter: clean(data.townCenter, 16),
      vip: clean(data.vip, 8),
      coordinates: clean(data.coordinates, 24),
      online: clean(data.online, 12)
    };
    const png = renderPlayerCardPng(card);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", String(png.length));
    return res.status(200).send(png);
  } catch {
    return res.status(400).end();
  }
}
