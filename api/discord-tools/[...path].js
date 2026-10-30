import avatar from "../../lib/discord-avatar.js";
import user from "../../lib/discord-user.js";
import interactions from "../../lib/discord-interactions.js";
import playerCard from "../../lib/discord-player-card.js";

export const config = { api: { bodyParser: false } };

function endpointFromRequest(req) {
 const raw = req.query?.path;
 const candidate = Array.isArray(raw) ? raw.join("/") : String(raw || "");
 if (["avatar", "user", "interactions", "player-card"].includes(candidate)) return candidate;

 // Vercel rewrites can preserve the original URL without populating the catch-all
 // route parameter. Resolve both the rewritten pathname and the legacy aliases.
 let pathname = "";
 try { pathname = new URL(req.url || "/", "http://localhost").pathname; } catch {}
 const aliases = {
  "/api/discord-user": "user",
  "/api/discord-tools/user": "user",
  "/api/discord-avatar": "avatar",
  "/api/discord-tools/avatar": "avatar",
  "/api/discord-interactions": "interactions",
  "/api/discord-tools/interactions": "interactions",
  "/api/discord-player-card": "player-card",
  "/api/discord-tools/player-card": "player-card",
  "/api/discord-player-card": "player-card",
  "/api/discord-tools/player-card": "player-card",
 };
 if (aliases[pathname]) return aliases[pathname];
 const match = pathname.match(/\/discord-tools\/(avatar|user|interactions)\/?$/);
 return match?.[1] || "";
}


function xml(value, max = 90) {
 const text = String(value ?? "—").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) || "—";
 return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function renderPlayerCard(d) {
 const stats = [["KINGDOM",d.kingdom],["POWER",d.power],["TOWN CENTER",d.townCenter],["VIP",d.vip],["ALLIANCE",d.alliance],["ALLIANCE RANK",d.rank],["KILLS",d.kills],["COORDINATES",d.coordinates],["STATUS",d.online]];
 const cells = stats.map((item,i)=>{const x=54+(i%3)*370,y=330+Math.floor(i/3)*100;return '<rect x="'+x+'" y="'+y+'" width="344" height="78" rx="14" fill="#242630" stroke="#45434a"/><text x="'+(x+18)+'" y="'+(y+26)+'" fill="#c7a45b" font-size="13" font-weight="700" letter-spacing="1.5">'+xml(item[0],24)+'</text><text x="'+(x+18)+'" y="'+(y+55)+'" fill="#f4f1e9" font-size="22" font-weight="650">'+xml(item[1],34)+'</text>';}).join("");
 const avatar = /^https:\/\/(got-global-avatar\.akamaized\.net|got-global-avatar\.chosenonegames\.com|cdn\.mightpulse\.com|www\.mightpulse\.com)\//i.test(String(d.avatar||"")) ? '<clipPath id="avatarClip"><circle cx="1080" cy="174" r="72"/></clipPath><image href="'+xml(d.avatar,500)+'" x="1008" y="102" width="144" height="144" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>' : '<circle cx="1080" cy="174" r="72" fill="#3a3942"/><text x="1080" y="194" text-anchor="middle" fill="#d6a84f" font-size="58" font-weight="800">'+xml(String(d.governor||"K").slice(0,1),1)+'</text>';
 return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="675" viewBox="0 0 1200 675"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#171922"/><stop offset="1" stop-color="#30303a"/></linearGradient><linearGradient id="gold"><stop stop-color="#e5c16f"/><stop offset="1" stop-color="#a77b32"/></linearGradient></defs><rect width="1200" height="675" rx="30" fill="url(#bg)"/><rect x="0" y="0" width="14" height="675" rx="7" fill="url(#gold)"/><text x="54" y="60" fill="#d6b66b" font-size="17" font-weight="800" letter-spacing="3">KINGSHOT AUTO REDEEMER</text><text x="54" y="122" fill="#f7f3ea" font-size="40" font-weight="800">PLAYER INTELLIGENCE</text><text x="54" y="174" fill="#aeb0ba" font-size="15" letter-spacing="2">LIVE GOVERNOR PROFILE</text>'+avatar+'<text x="54" y="254" fill="#ffffff" font-size="35" font-weight="750">'+xml(d.governor,42)+'</text><text x="54" y="288" fill="#c8c8d0" font-size="17">PLAYER ID  '+xml(d.playerId,20)+'</text>'+cells+'<text x="54" y="648" fill="#858792" font-size="13" letter-spacing="1.5">COMMUNITY TOOLS  •  LIVE DATA FROM MIGHTPULSE</text></svg>';
}
function renderRegistrationCard(d) {
 return '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="360" viewBox="0 0 1000 360"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#171922"/><stop offset="1" stop-color="#30303a"/></linearGradient><linearGradient id="gold"><stop stop-color="#e5c16f"/><stop offset="1" stop-color="#a77b32"/></linearGradient></defs><rect width="1000" height="360" rx="28" fill="url(#bg)"/><rect width="12" height="360" rx="6" fill="url(#gold)"/><circle cx="112" cy="116" r="48" fill="#244b3b" stroke="#65c99a" stroke-width="2"/><path d="M86 116l18 18 36-39" fill="none" stroke="#8be0b4" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><text x="190" y="70" fill="#d6b66b" font-size="15" font-weight="800" letter-spacing="3">KINGSHOT AUTO REDEEMER</text><text x="190" y="124" fill="#f7f3ea" font-size="34" font-weight="800">'+xml(d.status,32)+'</text><text x="190" y="168" fill="#c8c8d0" font-size="23">'+xml(d.governor,42)+'</text><text x="190" y="216" fill="#aeb0ba" font-size="17">KINGDOM  '+xml(d.kingdom,18)+'   •   PLAYER ID  '+xml(d.playerId,22)+'</text><rect x="190" y="258" width="310" height="42" rx="12" fill="#244b3b"/><text x="345" y="285" text-anchor="middle" fill="#9be6bd" font-size="15" font-weight="800" letter-spacing="1">AUTO REDEMPTION ENROLLED</text></svg>';
}
async function playerCard(req,res) {
 res.setHeader("Cache-Control","public, max-age=60, s-maxage=300");
 res.setHeader("X-Content-Type-Options","nosniff");
 res.setHeader("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'; img-src https:");
 if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).end();}
 try {
  const kind=String(req.query.kind||"");
  const encoded=String(req.query.data||"");
  if(!["player","registration"].includes(kind)||encoded.length>7000||!/^[A-Za-z0-9_-]+$/.test(encoded)) return res.status(400).end();
  const data=JSON.parse(Buffer.from(encoded,"base64url").toString("utf8"));
  if(!data||typeof data!=="object"||!/^\\d{5,20}$/.test(String(data.playerId||""))) return res.status(400).end();
  const svg=kind==="player"?renderPlayerCard(data):renderRegistrationCard(data);
  res.setHeader("Content-Type","image/svg+xml; charset=utf-8");
  res.setHeader("Content-Length",String(Buffer.byteLength(svg)));
  return res.status(200).send(svg);
 } catch { return res.status(400).end(); }
}

export default async function handler(req, res) {
 const endpoint = endpointFromRequest(req);
 if (endpoint === "avatar") return avatar(req, res);
 if (endpoint === "user") return user(req, res);
 if (endpoint === "interactions") return interactions(req, res);
 if (endpoint === "player-card") return playerCard(req, res);
 if (endpoint === "player-card") return playerCard(req, res);
 return res.status(404).json({ error: "Discord endpoint not found." });
}
