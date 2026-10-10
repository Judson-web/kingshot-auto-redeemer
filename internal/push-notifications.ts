import webpush from "web-push";

type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

const baseUrl = () => (process.env.SUPABASE_URL || "https://wocxvtptqapietlteshr.supabase.co").replace(/\/$/, "");
const serviceKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";

function configurePush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  const subject = process.env.VAPID_SUBJECT || "";
  if (!publicKey || !privateKey || !subject) throw new Error("Web Push is not configured. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT.");
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

async function database(path: string, options: RequestInit = {}) {
  const key = serviceKey();
  if (!key) throw new Error("Supabase service key is not configured.");
  const response = await fetch(baseUrl() + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: key,
      authorization: "Bearer " + key,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error((data as { message?: string } | null)?.message || "Push subscription database request failed.");
  return data;
}

export function getVapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY || "";
}

export async function savePushSubscription(subscription: PushSubscriptionJSON, userAgent: string) {
  const endpoint = String(subscription.endpoint || "");
  if (!endpoint.startsWith("https://") || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    throw new Error("Invalid browser push subscription.");
  }
  await database("kingshot_push_subscriptions?on_conflict=endpoint", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      endpoint,
      subscription,
      user_agent: userAgent.slice(0, 512),
      updated_at: new Date().toISOString(),
    }),
  });
}

export async function removePushSubscription(endpoint: string) {
  if (!endpoint.startsWith("https://")) throw new Error("Invalid subscription endpoint.");
  await database("kingshot_push_subscriptions?endpoint=eq." + encodeURIComponent(endpoint), { method: "DELETE" });
}

export async function sendPushToSubscribers(payload: PushPayload): Promise<{ sent: number; removed: number; failed: number }> {
  configurePush();
  const rows = await database("kingshot_push_subscriptions?select=endpoint,subscription");
  const subscriptions = Array.isArray(rows) ? rows as Array<{ endpoint: string; subscription: webpush.PushSubscription }> : [];
  let sent = 0, removed = 0, failed = 0;
  const safePayload = JSON.stringify({
    title: String(payload.title || "Kingshot Auto Redeem").slice(0, 120),
    body: String(payload.body || "").slice(0, 240),
    url: payload.url && payload.url.startsWith("/") && !payload.url.startsWith("//") ? payload.url : "/",
    tag: String(payload.tag || "kingshot-announcement").slice(0, 100),
  });
  // Keep concurrency bounded so a large subscriber list doesn't create a burst.
  for (let i = 0; i < subscriptions.length; i += 8) {
    const batch = subscriptions.slice(i, i + 8);
    const results = await Promise.all(batch.map(async row => {
      try {
        await webpush.sendNotification(row.subscription, safePayload, { TTL: 60 * 60 * 24 });
        sent++;
      } catch (error) {
        const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          try {
            await removePushSubscription(row.endpoint);
            removed++;
          } catch { failed++; }
        } else {
          failed++;
          console.warn("Browser push delivery failed:", statusCode || "unknown", error instanceof Error ? error.message : "unknown error");
        }
      }
    }));
    void results;
  }
  return { sent, removed, failed };
}
