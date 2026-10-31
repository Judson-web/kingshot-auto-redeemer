import avatar from "../../lib/discord-avatar.js";
import user from "../../lib/discord-user.js";
import interactions from "../../lib/discord-interactions.js";

export const config = { api: { bodyParser: false } };

function endpointFromRequest(req) {
 const raw = req.query?.path;
 const candidate = Array.isArray(raw) ? raw.join("/") : String(raw || "");
 if (["avatar", "user", "interactions"].includes(candidate)) return candidate;
 let pathname = "";
 try { pathname = new URL(req.url || "/", "http://localhost").pathname; } catch {}
 const aliases = {
  "/api/discord-user": "user",
  "/api/discord-tools/user": "user",
  "/api/discord-avatar": "avatar",
  "/api/discord-tools/avatar": "avatar",
  "/api/discord-interactions": "interactions",
  "/api/discord-tools/interactions": "interactions"
 };
 if (aliases[pathname]) return aliases[pathname];
 for (const endpoint of ["avatar", "user", "interactions"]) {
  if (pathname.endsWith("/discord-tools/" + endpoint)) return endpoint;
 }
 return "";
}

export default async function handler(req, res) {
 const endpoint = endpointFromRequest(req);
 if (endpoint === "avatar") return avatar(req, res);
 if (endpoint === "user") return user(req, res);
 if (endpoint === "interactions") return interactions(req, res);
 return res.status(404).json({ error: "Discord endpoint not found." });
}
