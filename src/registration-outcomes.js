import { allianceDetails, formatPower, playerDisplayName, playerPower } from "../lib/player-display.js";
import { playerIdFeedback } from "./player-id-feedback.js";

const LABELS = {
  registered: "REGISTERED",
  existing: "ALREADY ACTIVE",
  reactivated: "RE-ENABLED",
  disabled: "DISABLED",
  failed: "NEEDS ATTENTION"
};

const HEADLINES = {
  registered: "Registration complete",
  existing: "Already active",
  reactivated: "Re-enabled successfully",
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
  const playerIssue = kind === "failed" ? playerIdFeedback(data.code, data.message) : null;

  if (kind === "registered") {
    summary = data.verificationPending
      ? "Registration saved. Some profile details are still being verified."
      : data.stale
        ? "Registration saved, but the latest profile could not be refreshed."
        : "Registered for automatic gift-code checks.";
  } else if (kind === "existing") {
    summary = "No action needed.";
  } else if (kind === "reactivated") {
    summary = "Auto-redemption is active again.";
  } else if (kind === "disabled") {
    summary = "Auto-redemption is disabled. Contact support if you think this is a mistake.";
  } else {
    summary = playerIssue?.message || summary.replace(/^PLAYER ID BANNED\s*·\s*/i, "").replace(/\s*reason\s*:[\s\S]*/i, "").trim() || "Registration failed. Check the Player ID or contact support.";
  }

  return {
    id,
    name: name || "",
    kingdom: text(data.kingdom) || "—",
    avatar: text(data.avatar),
    power: text(data.power) || "—",
    townCenterLevel: data.townCenterLevel ?? "—",
    allianceName: text(data.allianceName),
    allianceTag: text(data.allianceTag),
    kind,
    label: playerIssue?.type === "invalid" ? "INVALID ID" : playerIssue?.type === "not_found" ? "NOT FOUND" : LABELS[kind],
    headline: playerIssue?.title || HEADLINES[kind],
    summary,
    reason: kind === "disabled" ? reason || "Auto-redemption is disabled for this Player ID." : "",
    code: text(data.code),
    verificationPending: Boolean(data.verificationPending),
    stale: Boolean(data.stale)
  };
}

export function makeSuccessOutcome(id, player = {}, result = {}) {
  const status = text(result.registrationStatus || (result.alreadyRegistered ? "ALREADY_REGISTERED" : "NEW")).toUpperCase();
  let kind = "registered";
  if (result.banned || result.code === "player_banned" || status.includes("BANNED") || status.includes("BLOCKED")) kind = "disabled";
  else if (result.disabled || result.enabled === false || status.includes("DISABLED")) kind = "disabled";
  else if (status.includes("REACTIVATED") || status.includes("RE-ENABLED")) kind = "reactivated";
  else if (result.alreadyRegistered || status.includes("ALREADY") || status.includes("EXISTING")) kind = "existing";

  const profile = {
    ...(result.player && typeof result.player === "object" ? result.player : {}),
    ...(player && typeof player === "object" ? player : {}),
    alliance: player?.alliance ?? result.player?.alliance
  };
  const alliance = allianceDetails(profile);
  return outcome(kind, {
    id,
    name: playerDisplayName(profile, ""),
    kingdom: result.verifiedKingdomId || profile.kid || profile.kingdom_id || "—",
    avatar: profile.avatar_url || profile.avatar || profile.avatarUrl || "",
    power: formatPower(playerPower(profile)),
    townCenterLevel: profile.town_center_level ?? profile.tc_level ?? profile.townCenterLevel ?? profile.town_center ?? "",
    allianceName: alliance.name,
    allianceTag: alliance.tag,
    message: result.error || result.message,
    reason: result.ban?.reason || result.reason,
    code: result.code,
    verificationPending: result.verificationPending,
    stale: result.stale
  });
}

export function makeFailureOutcome({ id, message, code, banned, disabled, alreadyRegistered, ban, reason, player } = {}) {
  const normalizedMessage = text(message) || "The Player ID could not be registered. Check the details or contact support.";
  const lower = normalizedMessage.toLowerCase();
  let kind = "failed";
  if (banned || code === "player_banned" || ban || /player id banned|blocked from registration|registration blocked/.test(lower)) kind = "disabled";
  else if (disabled || code === "player_disabled" || /auto.?redemption.*disabled|player.*disabled|registration.*disabled/.test(lower)) kind = "disabled";
  else if (alreadyRegistered || code === "already_registered" || /already registered|already enrolled/.test(lower)) kind = "existing";

  const profile = player && typeof player === "object" ? player : {};
  const alliance = allianceDetails(profile);
  return outcome(kind, {
    id,
    name: playerDisplayName(profile, ""),
    kingdom: profile.kid || profile.kingdom_id || "—",
    avatar: profile.avatar_url || profile.avatar || profile.avatarUrl || "",
    power: formatPower(playerPower(profile)),
    townCenterLevel: profile.town_center_level ?? profile.tc_level ?? profile.townCenterLevel ?? profile.town_center ?? "",
    allianceName: alliance.name,
    allianceTag: alliance.tag,
    message: normalizedMessage,
    code,
    reason: reason || ban?.reason || readReason(normalizedMessage)
  });
}

export function summarizeRegistrationOutcomes(outcomes = []) {
  const counts = { total: outcomes.length, registered: 0, existing: 0, reactivated: 0, disabled: 0, failed: 0 };
  for (const item of outcomes) {
    if (Object.hasOwn(counts, item?.kind)) counts[item.kind] += 1;
  }
  counts.active = counts.registered + counts.existing + counts.reactivated;
  const parts = [];
  if (counts.active) parts.push(`${counts.active} active`);
  if (counts.disabled) parts.push(`${counts.disabled} disabled`);
  if (counts.failed) parts.push(`${counts.failed} need attention`);

  const message = counts.total === 1
    ? outcomes[0]?.summary || "No registration result was returned."
    : "Review each player below.";
  const allRestricted = counts.total > 0 && counts.disabled === counts.total;
  const allActive = counts.total > 0 && counts.active === counts.total;
  const needsAttention = counts.disabled + counts.failed > 0;

  return { ...counts, message, allRestricted, allActive, needsAttention };
}

export function registrationOutcomeHeadline(outcomes = []) {
  if (outcomes.length === 1) return outcomes[0].headline;
  return "Registration results";
}
