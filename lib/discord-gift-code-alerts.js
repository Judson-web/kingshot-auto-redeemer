const SOURCE_LABELS = {
  "kingshot-api": "Kingshot.net API",
  "kingshot-net-api": "Kingshot.net API",
  "kingshot-page": "Kingshot.net page",
  "kingshot-net-page": "Kingshot.net page",
  beebom: "Beebom",
  pocketgamer: "Pocket Gamer",
  "whiteout-bot-aggregator": "Community aggregator",
  "verified-manual-fallback": "Verified fallback list",
  admin: "Admin-added"
};

function field(name, value, inline = false) {
  return { name, value: String(value ?? "—").slice(0, 1024) || "—", inline };
}

function sourcesFor(item = {}) {
  const values = Array.isArray(item.sources) && item.sources.length
    ? item.sources
    : [item.source || "unknown"];
  return [...new Set(values.map(value => String(value || "unknown")))];
}

export function buildNewGiftCodeAlert(item = {}) {
  const sources = sourcesFor(item);
  const confidence = Number.isFinite(Number(item.confidence)) ? Math.round(Number(item.confidence) * 100) : null;
  const expiryValue = typeof item.expiresAt === "number" ? item.expiresAt : Date.parse(String(item.expiresAt || ""));
  const expiry = item.expiresAt && Number.isFinite(expiryValue)
    ? new Date(expiryValue).toISOString()
    : "Not supplied by source";
  return {
    title: "🆕 Gift-code candidate discovered",
    description: "A code candidate was found in public listings. This is not a confirmation that Kingshot will accept it; wait for a conclusive redemption result before treating it as verified.",
    color: 0x5865F2,
    fields: [
      field("Candidate code", item.code),
      field("Evidence sources", sources.map(source => SOURCE_LABELS[source] || source).join(", ")),
      field("Source confidence", confidence === null ? "Not scored" : confidence + "% · " + String(item.confidenceTier || "unverified")),
      field("Code status", "UNVERIFIED"),
      field("Expiry", expiry),
      field("Next step", "Verify against Kingshot before announcing it as working.")
    ]
  };
}

export function buildGiftCodeValidationAlert({ code, status, validationStatus, message, errorCategory } = {}) {
  const normalizedStatus = String(status || "UNKNOWN").trim().toUpperCase();
  const validation = String(validationStatus || "pending").trim().toLowerCase();
  let title = "🟡 Gift-code check inconclusive";
  let description = "Kingshot returned a result, but it does not establish whether this code is valid. Keep it unverified until a conclusive response is available.";
  let color = 0xFEE75C;
  let nextStep = "Leave it unavailable for automatic redemption until verification is conclusive.";

  if (validation === "verified") {
    title = normalizedStatus === "SUCCESS" ? "✅ Gift code accepted by Kingshot" : "✅ Gift code confirmed";
    description = normalizedStatus === "SUCCESS"
      ? "Kingshot accepted the redemption request on the verification account. This check may have claimed the reward on that account."
      : "Kingshot returned an already-claimed or equivalent successful redemption response. The code is treated as verified.";
    color = 0x57F287;
    nextStep = "Code passed verification and may be released to eligible players.";
  } else if (validation === "invalid") {
    title = "⛔ Gift code not found";
    description = "Kingshot explicitly reported that the code was not found. This is a confirmed invalid-code response, unlike usage-limit or player-eligibility errors.";
    color = 0xED4245;
    nextStep = "Keep the code blocked unless new evidence warrants a fresh review.";
  } else if (validation === "expired") {
    title = "⌛ Gift code expired";
    description = "Kingshot returned an expired-code response. Do not present this as a currently working code.";
    color = 0xED4245;
    nextStep = "Keep the code out of the active redemption pool.";
  } else if (validation === "usage_limit" || normalizedStatus === "USAGE_LIMIT") {
    title = "⚠️ Gift code recognized · redemption limit reached";
    description = "Kingshot recognized this code but returned USAGE_LIMIT, meaning the redemption limit has been reached. This is not a code-not-found or invalid-code result.";
    color = 0xFEE75C;
    nextStep = "Keep it out of the active redemption pool while the limit applies, but do not mark it invalid.";

  }

  return {
    title,
    description,
    color,
    fields: [
      field("Gift code", code),
      field("Kingshot result", normalizedStatus),
      field("Validation state", validation.toUpperCase()),
      ...(errorCategory ? [field("Error category", errorCategory)] : []),
      ...(message ? [field("Provider message", message)] : []),
      field("Next step", nextStep)
    ]
  };
}

export function buildGiftCodeVerificationErrorAlert({ code, errorCategory, message } = {}) {
  return {
    title: "🟡 Gift-code verification could not finish",
    description: "No conclusive verification result was recorded. The candidate stays unverified; this is not evidence that the code is invalid.",
    color: 0xFEE75C,
    fields: [
      field("Gift code", code),
      field("Error category", errorCategory || "VERIFICATION_ERROR"),
      field("Details", message || "No additional details were returned."),
      field("Next step", "Review the source or retry verification during a later scheduled cycle.")
    ]
  };
}
