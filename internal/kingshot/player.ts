import { rateLimit } from "../../lib/request-rate-limit.js";
import { getPlayer } from "./mightpulse.js";

interface RequestLike {
  method?: string;
  query?: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): ResponseLike;
  setHeader(name: string, value: string): void;
}

interface PlayerApiError extends Error {
  status?: number;
}

export default async function handler(req: RequestLike, res: ResponseLike): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!rateLimit(req, res, "player-lookup", 30, 60000)) {
    res.status(429).json({ error: "Too many player lookups. Please try again shortly." });
    return;
  }

  const id = String(req.query?.id || "").trim();
  if (!/^\d{5,20}$/.test(id)) {
    res.status(400).json({ error: "Invalid player ID." });
    return;
  }

  try {
    const player = await getPlayer(id);
    res.status(200).json({ player });
  } catch (error) {
    const typedError = error as PlayerApiError;
    if (typedError.status === 404) {
      res.status(404).json({
        error: typedError.message || "MightPulse could not find this player."
      });
      return;
    }
    if (/timed out|abort/i.test(typedError.message || "")) {
      res.status(504).json({ error: "MightPulse request timed out." });
      return;
    }
    res.status(502).json({
      error: typedError.message || "MightPulse request failed."
    });
  }
}
