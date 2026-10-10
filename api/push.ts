import { rateLimit } from "../lib/request-rate-limit.js";
import { getVapidPublicKey, removePushSubscription, savePushSubscription } from "../internal/push-notifications.js";

type RequestLike = { method?: string; body?: Record<string, unknown>; headers: Record<string, string | string[] | undefined> };
type ResponseLike = { setHeader(name: string, value: string): void; status(code: number): ResponseLike; json(body: unknown): unknown };

export default async function handler(req: RequestLike, res: ResponseLike) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  try {
    const body = req.body || {};
    const action = String(body.action || "").toUpperCase();
    if (action === "PUBLIC_KEY") {
      const publicKey = getVapidPublicKey();
      if (!publicKey) return res.status(503).json({ error: "Browser notifications are not configured yet." });
      return res.status(200).json({ publicKey });
    }
    if (action === "SUBSCRIBE") {
      if (!rateLimit(req as never, res as never, "push-subscribe", 10, 60 * 60 * 1000)) return res.status(429).json({ error: "Too many subscription changes. Try again later." });
      const subscription = body.subscription as PushSubscriptionJSON | undefined;
      const endpoint = String(subscription?.endpoint || "");
      let host = "";
      try { host = new URL(endpoint).hostname.toLowerCase(); } catch { /* validated below */ }
      const allowedHost = host === "fcm.googleapis.com" || host.endsWith(".push.services.mozilla.com") || host === "updates.push.services.mozilla.com" || host.endsWith(".notify.windows.com") || host.endsWith(".push.apple.com") || host === "web.push.apple.com";
      if (!allowedHost) return res.status(400).json({ error: "Unsupported browser push endpoint." });
      await savePushSubscription(subscription!, String(req.headers["user-agent"] || ""));
      return res.status(200).json({ ok: true });
    }
    if (action === "UNSUBSCRIBE") {
      if (!rateLimit(req as never, res as never, "push-unsubscribe", 20, 60 * 60 * 1000)) return res.status(429).json({ error: "Too many subscription changes. Try again later." });
      const endpoint = String(body.endpoint || "");
      let host = "";
      try { host = new URL(endpoint).hostname.toLowerCase(); } catch { /* validated below */ }
      const allowedHost = host === "fcm.googleapis.com" || host.endsWith(".push.services.mozilla.com") || host === "updates.push.services.mozilla.com" || host.endsWith(".notify.windows.com") || host.endsWith(".push.apple.com") || host === "web.push.apple.com";
      if (!allowedHost) return res.status(400).json({ error: "Unsupported browser push endpoint." });
      await removePushSubscription(endpoint);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "Invalid push action." });
  } catch (error) {
    console.error("Browser push subscription request failed:", error instanceof Error ? error.message : "unknown error");
    return res.status(502).json({ error: error instanceof Error ? error.message : "Browser notification service unavailable." });
  }
}
