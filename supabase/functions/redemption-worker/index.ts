import md5 from "npm:blueimp-md5@2.19.0";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "content-type": "application/json; charset=utf-8",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

function getSecretKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const parsed = JSON.parse(keys);
      if (parsed.default) return parsed.default;
    } catch { /* use legacy fallback error below */ }
  }
  throw new Error("Supabase server key is not configured");
}

const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = getSecretKey();

async function rpc(name: string, args: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`RPC ${name} failed (${response.status}): ${body.slice(0, 300)}`);
  if (!body) return null;
  try { return JSON.parse(body); } catch { return body; }
}

function normalizeStatus(raw: string, err: number | null, httpStatus: number) {
  let status = raw.trim().toUpperCase().replace(/[._-]+/g, " ");
  if (err === 40014 || ["CDK NOT FOUND", "GIFT CODE NOT FOUND", "CODE NOT FOUND", "INVALID CODE", "INVALID GIFT CODE"].includes(status)) status = "CDK_NOT_FOUND";
  if (err === 40005 && status === "USED") status = "USAGE_LIMIT";
  if (err === 40019 || ["TOO FREQUENT", "TIMEOUT RETRY"].includes(status) || httpStatus === 429) status = "TIMEOUT_RETRY";
  if (err === 40008 && status.includes("RECEIVED")) status = "RECEIVED";
  if (err === 40011 && status.includes("SAME TYPE")) status = "SAME TYPE EXCHANGE";
  if (err === 40007 || status === "TIME ERROR") status = "TIME_ERROR";
  if (["NOT LOGIN", "LOGIN EXPIRED MID PROCESS"].includes(status)) status = "LOGIN_EXPIRED_MID_PROCESS";
  if (status === "ROLE NOT EXIST" || (err === 40001 && status.includes("NOT EXIST"))) status = "ROLE_NOT_EXIST";
  if (status === "USER INFO ERROR" || err === 40020) status = "USER INFO ERROR";
  return status;
}

const terminalStatuses = new Set([
  "SUCCESS", "RECEIVED", "SAME TYPE EXCHANGE", "TIME_ERROR", "CDK_NOT_FOUND",
  "USAGE_LIMIT", "ROLE_NOT_EXIST", "STATE_MISMATCH", "SIGN_ERROR",
  "LOGIN_EXPIRED_MID_PROCESS", "USER INFO ERROR",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  let input: { secret?: string; limit?: number; slot?: number };
  try { input = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!input.secret || typeof input.secret !== "string") return json({ error: "Unauthorized" }, 401);

  try {
    const valid = await rpc("redemption_check_worker_secret", { p_secret: input.secret });
    if (valid !== true) return json({ error: "Unauthorized" }, 401);
  } catch (error) {
    return json({ error: "Worker authorization unavailable", detail: String(error).slice(0, 180) }, 503);
  }

  const limit = Math.max(1, Math.min(Number(input.limit ?? 50), 50));
  const slot = 0;
  const worker = `edge-redemption-single-${crypto.randomUUID()}`;
  const startedAt = Date.now();
  const softDeadlineMs = 100_000;
  const stats: {
    claimed: number;
    completed: number;
    uncertain: number;
    deferred: number;
    rate_limited: boolean;
    statuses: Record<string, number>;
  } = { claimed: 0, completed: 0, uncertain: 0, deferred: 0, rate_limited: false, statuses: {} };
  const countStatus = (status: string) => {
    stats.statuses[status] = (stats.statuses[status] ?? 0) + 1;
  };

  try {
    for (let i = 0; i < limit && Date.now() - startedAt < softDeadlineMs; i++) {
      const claimed = await rpc("redemption_claim_batch", {
        p_worker: worker, p_shard: 0, p_shards: 1, p_limit: 1, p_lease_seconds: 180,
      });
      const item = Array.isArray(claimed) ? claimed[0] : null;
      if (!item) break;
      stats.claimed++;

      const fid = String(item.player_id ?? "").replace(/[^0-9]/g, "");
      const kid = String(item.kingdom_id ?? "").replace(/[^0-9]/g, "");
      const code = String(item.gift_code ?? "").trim();
      if (!/^\d{5,20}$/.test(fid) || !/^\d{1,10}$/.test(kid) || !/^[A-Za-z0-9_-]{6,32}$/.test(code)) {
        await rpc("redemption_finalize_attempt", {
          p_queue_id: item.id, p_worker: worker, p_state: "dead", p_status: "INVALID_INPUT",
          p_err_code: null, p_message: "Invalid player, kingdom, or gift-code format",
          p_result: { status: "INVALID_INPUT" }, p_journal_state: "recorded",
        });
        countStatus("INVALID_INPUT");
        stats.completed++;
        continue;
      }

      const reserved = await rpc("redemption_reserve_request", {
        p_source: "century-gift-code", p_spacing_ms: 500,
      });
      if (!reserved) {
        await rpc("redemption_defer_claim", { p_queue_id: item.id, p_worker: worker, p_seconds: 90 });
        stats.deferred++;
        break;
      }
      const due = new Date(String(reserved)).getTime();
      const waitMs = due - Date.now();
      if (waitMs > 0) await sleep(Math.min(waitMs, 30000));

      const epoch = Math.floor(Date.now() / 1000).toString();
      const signPayload = `cdk=${code}&fid=${fid}&kid=${kid}&time=${epoch}`;
      const sign = md5(signPayload + "mN4!pQs6JrYwV9");
      const body = new URLSearchParams({ fid, cdk: code, kid, time: epoch, sign }).toString();

      let response: Response;
      let responseText = "";
      try {
        response = await fetch("https://kingshot-giftcode.centurygame.com/api/gift_code", {
          method: "POST",
          headers: {
            accept: "application/json, text/plain, */*",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/x-www-form-urlencoded",
            origin: "https://kingshot-giftcode.centurygame.com",
            referer: "https://kingshot-giftcode.centurygame.com/",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
          },
          body,
          signal: AbortSignal.timeout(30000),
        });
        responseText = await response.text();
      } catch (error) {
        await rpc("redemption_finalize_attempt", {
          p_queue_id: item.id, p_worker: worker, p_state: "uncertain", p_status: "UPSTREAM_UNCERTAIN",
          p_err_code: null, p_message: "Network timeout or transport error; outcome requires reconciliation",
          p_result: { status: "UPSTREAM_UNCERTAIN", error: String(error).slice(0, 180) },
          p_journal_state: "uncertain",
        });
        stats.uncertain++;
        countStatus("UPSTREAM_UNCERTAIN");
        continue;
      }

      let payload: Record<string, unknown> | null = null;
      try { payload = JSON.parse(responseText); } catch { payload = null; }
      const raw = String(payload?.msg ?? "UNKNOWN ERROR");
      let errCode: number | null = null;
      if (/^\d+$/.test(String(payload?.err_code ?? ""))) errCode = Number(payload?.err_code);
      const status = normalizeStatus(raw, errCode, response.status);

      if (status === "TIMEOUT_RETRY") {
        const cooldown = response.status === 429 ? 120 : 60;
        await rpc("redemption_set_cooldown", {
          p_source: "century-gift-code", p_seconds: cooldown, p_http_status: response.status,
        });
        await rpc("redemption_finalize_attempt", {
          p_queue_id: item.id, p_worker: worker, p_state: "completed", p_status: status,
          p_err_code: errCode ?? 40019, p_message: raw === "UNKNOWN ERROR" ? "Upstream requested retry" : raw,
          p_result: { status, err_code: errCode ?? 40019, message: raw, http_status: response.status },
          p_journal_state: "recorded",
        });
        stats.completed++;
        countStatus(status);
        stats.rate_limited = true;
        break;
      }

      if (response.status < 200 || response.status >= 300 || !payload || !terminalStatuses.has(status)) {
        await rpc("redemption_finalize_attempt", {
          p_queue_id: item.id, p_worker: worker, p_state: "uncertain", p_status: "UPSTREAM_UNCERTAIN",
          p_err_code: errCode, p_message: "Unclassified upstream response; manual reconciliation required",
          p_result: { status: "UPSTREAM_UNCERTAIN", http_status: response.status, response_text: responseText.slice(0, 500) },
          p_journal_state: "uncertain",
        });
        stats.uncertain++;
        countStatus("UPSTREAM_UNCERTAIN");
        continue;
      }

      const message = String(payload.msg ?? "");
      await rpc("redemption_finalize_attempt", {
        p_queue_id: item.id, p_worker: worker, p_state: "completed", p_status: status,
        p_err_code: errCode, p_message: message,
        p_result: { status, err_code: errCode, message, http_status: response.status, response: payload },
        p_journal_state: "recorded",
      });
      stats.completed++;
      countStatus(status);
    }
    const elapsedMs = Date.now() - startedAt;
    console.info("redemption-worker-summary", JSON.stringify({ worker_slot: slot, elapsed_ms: elapsedMs, limit, ...stats }));
    return json({ ok: true, worker_slot: slot, elapsed_ms: elapsedMs, ...stats });
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    console.error("redemption-worker-failed", JSON.stringify({ worker_slot: slot, elapsed_ms: elapsedMs, ...stats, error: String(error).slice(0, 300) }));
    return json({ ok: false, worker_slot: slot, elapsed_ms: elapsedMs, ...stats, error: String(error).slice(0, 300) }, 500);
  }
});
