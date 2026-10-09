type QueryValue = string | string[] | undefined;

interface RequestLike {
  method?: string;
  query: Record<string, QueryValue>;
}

interface ResponseLike {
  setHeader(name: string, value: string): this;
  status(code: number): this;
  json(body: unknown): this;
}

interface DiscordUserPayload {
  id?: string;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function isDiscordUserPayload(value: unknown): value is DiscordUserPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default async function handler(req: RequestLike, res: ResponseLike): Promise<unknown> {
  res.setHeader("Allow", "GET");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  const id = String(req.query.id || "").trim();
  if (!/^\d{15,22}$/.test(id)) {
    return res.status(400).json({ error: "Enter a valid Discord user ID." });
  }

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return res.status(503).json({ error: "Discord API access is not configured." });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch("https://discord.com/api/v10/users/" + id, {
      headers: { Authorization: "Bot " + token, Accept: "application/json" },
      signal: controller.signal,
    });
    const raw: unknown = await response.json().catch(() => ({}));
    const data: DiscordUserPayload = isDiscordUserPayload(raw) ? raw : {};

    if (!response.ok) {
      if (response.status === 404) return res.status(404).json({ error: "Discord user not found." });
      if (response.status === 429) {
        res.setHeader("Retry-After", response.headers.get("retry-after") || "1");
        return res.status(429).json({ error: "Discord rate limit reached. Try again shortly." });
      }
      return res.status(502).json({ error: "Discord API request failed." });
    }

    if (typeof data.avatar !== "string" || !data.avatar) {
      return res.status(404).json({ error: "This user does not have a custom avatar." });
    }

    const animated = data.avatar.startsWith("a_");
    const format = animated ? "gif" : "png";
    const avatarUrl = `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.${format}?size=1024`;
    return res.status(200).json({
      id: data.id,
      username: data.username,
      globalName: data.global_name || null,
      avatar: data.avatar,
      animated,
      format,
      avatarUrl,
    });
  } catch (error: unknown) {
    console.error("discord-user", error);
    return res.status(isAbortError(error) ? 504 : 502).json({
      error: isAbortError(error)
        ? "Discord took too long to respond. Please try again."
        : "Could not reach Discord right now.",
    });
  } finally {
    clearTimeout(timeout);
  }
}
