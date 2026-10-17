const LABELS = {
  registered: "REGISTERED",
  existing: "ALREADY ACTIVE",
  reactivated: "RE-ENABLED",
  banned: "BLOCKED",
  disabled: "DISABLED",
  failed: "NEEDS ATTENTION"
};

const HEADLINES = {
  registered: "Registration complete",
  existing: "Already active",
  reactivated: "Re-enabled successfully",
  banned: "Registration blocked",
  disabled: "Auto-redemption disabled",
  failed: "Registration needs attention"
};

function text(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function readReason(message) {
  const match = text(message).match(/reason\s*:\s*([\s\S]*)/i);
  return match ? match[1].trim().replace(/[.;]+$/, "") : "";
}

function outcome(kind, data) {
  const id = text(data.id);
  const name = text(data.name);
  const reason = text(data.reason) || readReason(data.message);
  let summary = text(data.message);

  if (kind === "registered") {
    summary = data.verificationPending
      ? "Registration is saved. Some profile details are still being verified."
      : data.stale
        ? "Registration is saved, but the latest player profile could not be refreshed."
        : "This Player ID is registered and eligible for automatic gift-code checks.";
  } else if (kind === "existing") {
    summary = "Already enrolled. No duplicate registration was created.";
  } else if (kind === "reactivated") {
    summary = "The previous registration is active again for automatic redemption.";
  } else if (kind === "banned") {
    summary = "This Player ID cannot be enrolled under the current service rules.";
  } else if (kind === "disabled") {
    summary = "This Player ID is disabled for automatic redemption. Contact support if you need help re-enabling it.";
  } else {
    summary = summary.replace(/^PLAYER ID BANNED\s*·\s*/i, "").replace(/\s*reason\s*:[\s\S]*/i, "").trim() || "The Player ID could not be registered. Check the details or contact support.";
  }

  return {
    id,
    name: name || "",
    kingdom: text(data.kingdom) || "—",
    avatar: text(data.avatar),
    kind,
    label: LABELS[kind],
    headline: HEADLINES[kind],
    summary,
    reason: kind === "banned" ? reason || "This ID is restricted from registration." : "",
    code: text(data.code),
    verificationPending: Boolean(data.verificationPending),
    stale: Boolean(data.stale)
  };
}

export function makeSuccessOutcome(id, player = {}, result = {}) {
  const status = text(result.registrationStatus || (result.alreadyRegistered ? "ALREADY_REGISTERED" : "NEW")).toUpperCase();
  let kind = "registered";
  if (result.banned || result.code === "player_banned" || status.includes("BANNED") || status.includes("BLOCKED")) kind = "banned";
  else if (result.disabled || result.enabled === false || status.includes("DISABLED")) kind = "disabled";
  else if (status.includes("REACTIVATED") || status.includes("RE-ENABLED")) kind = "reactivated";
  else if (result.alreadyRegistered || status.includes("ALREADY") || status.includes("EXISTING")) kind = "existing";

  return outcome(kind, {
    id,
    name: player.nick_name || player.name || player.nickname || result.player?.player_name || "",
    kingdom: result.verifiedKingdomId || player.kid || player.kingdom_id || "—",
    avatar: player.avatar_url || player.avatar || player.avatarUrl || result.player?.avatar_url || "",
    message: result.error || result.message,
    reason: result.ban?.reason || result.reason,
    code: result.code,
    verificationPending: result.verificationPending,
    stale: result.stale
  });
}

export function makeFailureOutcome({ id, message, code, banned, disabled, alreadyRegistered, ban, reason } = {}) {
  const normalizedMessage = text(message) || "The Player ID could not be registered. Check the details or contact support.";
  const lower = normalizedMessage.toLowerCase();
  let kind = "failed";
  if (banned || code === "player_banned" || ban || /player id banned|blocked from registration|registration blocked/.test(lower)) kind = "banned";
  else if (disabled || code === "player_disabled" || /auto.?redemption.*disabled|player.*disabled|registration.*disabled/.test(lower)) kind = "disabled";
  else if (alreadyRegistered || code === "already_registered" || /already registered|already enrolled/.test(lower)) kind = "existing";

  return outcome(kind, {
    id,
    message: normalizedMessage,
    code,
    reason: reason || ban?.reason || readReason(normalizedMessage)
  });
}

export function summarizeRegistrationOutcomes(outcomes = []) {
  const counts = { total: outcomes.length, registered: 0, existing: 0, reactivated: 0, banned: 0, disabled: 0, failed: 0 };
  for (const item of outcomes) {
    if (Object.hasOwn(counts, item?.kind)) counts[item.kind] += 1;
  }
  counts.active = counts.registered + counts.existing + counts.reactivated;
  const parts = [];
  if (counts.active) parts.push(`${counts.active} active`);
  if (counts.banned) parts.push(`${counts.banned} blocked`);
  if (counts.disabled) parts.push(`${counts.disabled} disabled`);
  if (counts.failed) parts.push(`${counts.failed} need attention`);

  const message = counts.total === 1
    ? outcomes[0]?.summary || "No registration result was returned."
    : `${counts.total} Player IDs checked · ${parts.join(" · ") || "No results"}.`;
  const allRestricted = counts.total > 0 && counts.banned === counts.total;
  const allActive = counts.total > 0 && counts.active === counts.total;
  const needsAttention = counts.banned + counts.disabled + counts.failed > 0;

  return { ...counts, message, allRestricted, allActive, needsAttention };
}

export function registrationOutcomeHeadline(outcomes = []) {
  if (outcomes.length === 1) return outcomes[0].headline;
  return "Registration results";
}
