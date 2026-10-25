const DISCORD_API = "https://discord.com/api/v10";
const USER_ID_RE = /^\d{15,22}$/;

function fail(status, message, retryAfter) {
 const error = new Error(message);
 error.status = status;
 if (retryAfter) error.retryAfter = retryAfter;
 return error;
}

/**
 * Fetch the live Discord account profile using the same bot-authenticated
 * extractor used by /api/discord-user. Never falls back to stale metadata here;
 * callers decide whether to use their cached Supabase profile.
 */
export async function fetchDiscordUser(id) {
 const userId = String(id || "").trim();
 if (!USER_ID_RE.test(userId)) throw fail(400, "Enter a valid Discord user ID.");
 const token = process.env.DISCORD_BOT_TOKEN;
 if (!token) throw fail(503, "Discord API access is not configured.");

 const controller = new AbortController();
 const timeout = setTimeout(() => controller.abort(), 8000);
 let response;
 try {
  response = await fetch(DISCORD_API + "/users/" + userId, {
   headers: { Authorization: "Bot " + token, Accept: "application/json" },
   signal: controller.signal,
  });
 } catch (error) {
  if (error?.name === "AbortError") throw fail(504, "Discord took too long to respond. Please try again.");
  throw fail(502, "Could not reach Discord right now.");
 } finally {
  clearTimeout(timeout);
 }

 const body = await response.json().catch(() => ({}));
 if (!response.ok) {
  if (response.status === 404) throw fail(404, "Discord user not found.");
  if (response.status === 429) throw fail(429, "Discord rate limit reached. Try again shortly.", response.headers.get("retry-after") || "1");
  throw fail(502, "Discord API request failed.");
 }

 const avatar = typeof body.avatar === "string" && body.avatar ? body.avatar : null;
 const animated = Boolean(avatar && avatar.startsWith("a_"));
 // Discord's current default avatar is derived from the user's snowflake ID.
 const defaultAvatarIndex = Number((BigInt(String(body.id || userId)) >> 22n) % 6n);
 const format = animated ? "gif" : "png";
 const avatarUrl = avatar
  ? `https://cdn.discordapp.com/avatars/${body.id}/${avatar}.${format}?size=1024`
  : `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex}.png?size=1024`;

 return {
  id: String(body.id || userId),
  username: typeof body.username === "string" ? body.username : "",
  globalName: typeof body.global_name === "string" && body.global_name ? body.global_name : null,
  avatar,
  animated,
  format,
  avatarUrl,
  fetchedAt: new Date().toISOString(),
 };
}

export default async function handler(req, res) {
 res.setHeader("Allow", "GET");
 res.setHeader("Cache-Control", "no-store, max-age=0");
 if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
 const id = String(req.query.id || "").trim();
 try {
  const profile = await fetchDiscordUser(id);
  return res.status(200).json(profile);
 } catch (error) {
  const status = Number(error?.status) || 502;
  if (status === 429) res.setHeader("Retry-After", String(error?.retryAfter || "1"));
  return res.status(status).json({ error: error?.message || "Could not reach Discord right now." });
 }
}
