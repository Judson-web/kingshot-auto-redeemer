const API_VERSION = "v1";

function config() {
  const url = String(process.env.DISCORD_SUPABASE_URL || "").replace(/\/+$/, "");
  const key = String(process.env.DISCORD_SUPABASE_SERVICE_ROLE_KEY || "");
  if (!url || !key) return null;
  return { url, key };
}

async function rest(path, method, body, prefer) {
  const cfg = config();
  if (!cfg) return null;
  const response = await fetch(cfg.url + "/rest/" + API_VERSION + "/" + path, {
    method,
    headers: {
      apikey: cfg.key,
      Authorization: "Bearer " + cfg.key,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(2500)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error("Discord database request failed (" + response.status + "): " + detail.slice(0, 240));
  }
  return response.status === 204 ? null : response.json().catch(() => null);
}

export async function recordDiscordCommand({
  guildId,
  actorId,
  commandName,
  outcome,
  latencyMs,
  errorCode
}) {
  if (!config()) return false;
  const safeGuildId = /^\d{5,25}$/.test(String(guildId || "")) ? String(guildId) : null;
  const safeActorId = /^\d{5,25}$/.test(String(actorId || "")) ? String(actorId) : null;
  const safeCommand = String(commandName || "").slice(0, 64);
  const safeOutcome = ["accepted", "succeeded", "failed", "rejected"].includes(outcome) ? outcome : "failed";
  if (!safeCommand) return false;

  if (safeGuildId) {
    await rest("discord_guilds?on_conflict=guild_id", "POST", [{
      guild_id: safeGuildId,
      last_seen_at: new Date().toISOString()
    }], "resolution=merge-duplicates,return=minimal");
  }

  await rest("discord_command_events", "POST", [{
    guild_id: safeGuildId,
    actor_id: safeActorId,
    command_name: safeCommand,
    outcome: safeOutcome,
    latency_ms: Number.isFinite(latencyMs) ? Math.max(0, Math.round(latencyMs)) : null,
    error_code: errorCode ? String(errorCode).slice(0, 100) : null
  }], "return=minimal");
  return true;
}

export async function recordDiscordAudit({
  guildId,
  actorId,
  action,
  targetType,
  targetId,
  details = {}
}) {
  if (!config()) return false;
  const safeGuildId = /^\d{5,25}$/.test(String(guildId || "")) ? String(guildId) : null;
  const safeActorId = /^\d{5,25}$/.test(String(actorId || "")) ? String(actorId) : null;
  await rest("discord_audit_log", "POST", [{
    guild_id: safeGuildId,
    actor_id: safeActorId,
    action: String(action || "unknown").slice(0, 100),
    target_type: targetType ? String(targetType).slice(0, 80) : null,
    target_id: targetId ? String(targetId).slice(0, 100) : null,
    details: details && typeof details === "object" && !Array.isArray(details) ? details : {}
  }], "return=minimal");
  return true;
}
