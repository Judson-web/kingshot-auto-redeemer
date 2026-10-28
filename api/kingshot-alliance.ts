import { rateLimit } from "../lib/request-rate-limit.js";
import { fetchMightPulse } from "../lib/mightpulse-key-pool.js";

interface RequestLike {
 method?: string;
 url?: string;
 query?: Record<string, unknown>;
 headers: Record<string, string | string[] | undefined>;
}
interface ResponseLike {
 status(code: number): ResponseLike;
 json(body: unknown): ResponseLike;
 setHeader(name: string, value: string): void;
}

function clean(value: unknown, max = 40): string {
 return String(value ?? "").trim().slice(0, max);
}

export default async function handler(req: RequestLike, res: ResponseLike): Promise<void> {
 res.setHeader("Cache-Control", "private, no-store");
 res.setHeader("X-Content-Type-Options", "nosniff");
 if (req.method !== "GET") {
  res.setHeader("Allow", "GET");
  res.status(405).json({ error: "Method not allowed." });
  return;
 }
 if (!rateLimit(req, res, "alliance-lookup", 20, 60_000)) return;
 const url = new URL(req.url || "/", "http://localhost");
 const kingdomId = clean(req.query?.kingdomId ?? url.searchParams.get("kingdomId"), 10);
 const tag = clean(req.query?.tag ?? url.searchParams.get("tag"), 20);
 if (!/^\d{1,10}$/.test(kingdomId)) {
  res.status(400).json({ error: "Enter a numeric kingdom ID.", code: "invalid_kingdom_id" });
  return;
 }
 if (!/^[A-Za-z0-9_-]{1,20}$/.test(tag)) {
  res.status(400).json({ error: "Enter the alliance tag/abbreviation shown in Kingshot.", code: "invalid_alliance_tag" });
  return;
 }
 const upstreamUrl = "https://api.mightpulse.com/v1/alliances/" + encodeURIComponent(kingdomId) + "/" + encodeURIComponent(tag) + "?include=info,roster";
 try {
  const upstream = await fetchMightPulse(upstreamUrl, { headers: { Accept: "application/json" } }, { timeoutMs: 20_000 });
  const body = await upstream.json().catch(() => ({})) as Record<string, any>;
  if (!upstream.ok) {
   if (upstream.status === 404) {
    res.status(404).json({ error: "No alliance was found for that kingdom and tag. Check both values and try again.", code: "alliance_not_found" });
    return;
   }
   if (upstream.status === 429) {
    res.status(429).json({ error: "The game data provider is busy. Please wait a moment and try again.", code: "provider_rate_limited" });
    return;
   }
   res.status(502).json({ error: "Alliance data is temporarily unavailable. Please try again shortly.", code: "provider_unavailable" });
   return;
  }
  const source = body.data && typeof body.data === "object" ? body.data : body;
  const alliance = source.alliance ?? source;
  const rawMembers = Array.isArray(source.members) ? source.members : Array.isArray(source.roster) ? source.roster : Array.isArray(alliance.members) ? alliance.members : [];
  const members = rawMembers.flatMap((member: Record<string, any>) => {
   const playerId = String(member.governor_id ?? member.fid ?? "").trim();
   if (!/^\d{5,20}$/.test(playerId)) return [];
   return [{
    playerId,
    name: clean(member.nick_name ?? member.name ?? member.nickname, 80) || "Kingshot Player",
    power: Number.isFinite(Number(member.power)) ? Number(member.power) : null,
    townCenterLevel: Number.isFinite(Number(member.town_center_level)) ? Number(member.town_center_level) : null,
    avatarUrl: typeof member.avatar_url === "string" && /^https:\/\//i.test(member.avatar_url) ? member.avatar_url : "",
    allianceRank: clean(member.alliance_rank_label ?? member.alliance_rank, 30),
    kingdomId: String(member.kid ?? kingdomId)
   }];
  });
  if (!members.length) {
   res.status(200).json({ alliance: { name: clean(alliance.name ?? alliance.alliance_name, 80) || tag, tag: clean(alliance.abbr ?? alliance.tag, 20) || tag, kingdomId }, members: [], stale: Boolean(body.meta?.stale), fetchedAt: body.meta?.fetchedAt ?? null });
   return;
  }
  res.status(200).json({
   alliance: {
    name: clean(alliance.name ?? alliance.alliance_name, 80) || tag,
    tag: clean(alliance.abbr ?? alliance.tag, 20) || tag,
    kingdomId,
    power: Number.isFinite(Number(alliance.power)) ? Number(alliance.power) : null,
    count: Number.isFinite(Number(alliance.count)) ? Number(alliance.count) : members.length,
    leaderName: clean(alliance.leader_name, 80)
   },
   members,
   stale: Boolean(body.meta?.stale),
   fetchedAt: body.meta?.fetchedAt ?? null
  });
 } catch {
  res.status(502).json({ error: "Could not reach the alliance data provider. Please try again shortly.", code: "provider_unavailable" });
 }
}
