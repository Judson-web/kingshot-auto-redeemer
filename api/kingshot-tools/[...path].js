import player from "../../internal/kingshot/player.js";
import register from "../../internal/kingshot/register.js";
import developerApi from "../../lib/developer-api.js";

function routePath(req) {
  const q = req.query?.path;
  if (Array.isArray(q) && q.length) return q.join("/").replace(/^\/+|\/+$/g, "");
  if (typeof q === "string" && q) return q.replace(/^\/+|\/+$/g, "");
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  const marker = "/api/kingshot-tools/";
  if (pathname.startsWith(marker)) return pathname.slice(marker.length).replace(/^\/+|\/+$/g, "");
  return "";
}

export default async function handler(req, res) {
  const path = routePath(req);
  if (path === "player") return player(req, res);
  if (path === "register") return register(req, res);
  if (path === "developer" || path.startsWith("developer/")) {
    return developerApi(req, res, path.replace(/^developer\/?/, ""));
  }
  return res.status(404).json({ error: "Kingshot endpoint not found.", route: path || null });
}
