type QueryValue = string | string[] | undefined;

interface RequestLike {
  method?: string;
  query: Record<string, QueryValue>;
}

interface ResponseLike {
  setHeader(name: string, value: string): this;
  status(code: number): this;
  json(body: unknown): this;
  send(body: Buffer | string): this;
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

export default async function handler(req: RequestLike, res: ResponseLike): Promise<unknown> {
  res.setHeader("Allow", "GET");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  const id = String(req.query.id || "").trim();
  const hash = String(req.query.hash || "").trim();
  const requestedFormat = String(req.query.format || "png").toLowerCase();
  const format = ["png", "jpg", "jpeg", "webp", "gif"].includes(requestedFormat)
    ? requestedFormat === "jpeg" ? "jpg" : requestedFormat
    : "png";
  const size = Number(req.query.size || 1024);
  const allowedSizes = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096];
  const hashIsValid = /^[a-zA-Z0-9_]{20,80}$/.test(hash);

  if (!/^\d{15,22}$/.test(id) || !hashIsValid || !allowedSizes.includes(size)) {
    return res.status(400).json({ error: "Invalid avatar request." });
  }

  const animated = hash.startsWith("a_");
  const allowedFormats = animated ? ["gif"] : ["png", "jpg", "webp"];
  if (!allowedFormats.includes(format)) {
    return res.status(400).json({
      error: animated
        ? "Animated avatars are only available as GIF."
        : "That format is not available for this avatar.",
    });
  }

  const url = `https://cdn.discordapp.com/avatars/${id}/${hash}.${format}?size=${size}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      headers: { Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return res.status(response.status === 404 ? 404 : 502).json({
        error: "Avatar image is unavailable in that format.",
      });
    }

    const contentType = response.headers.get("content-type") || `image/${format}`;
    const data = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800");
    res.setHeader("Content-Length", String(data.length));
    return res.status(200).send(data);
  } catch (error: unknown) {
    console.error("discord-avatar", error);
    return res.status(isAbortError(error) ? 504 : 502).json({
      error: isAbortError(error)
        ? "The avatar took too long to load. Please try again."
        : "Could not load the avatar right now.",
    });
  } finally {
    clearTimeout(timeout);
  }
}
