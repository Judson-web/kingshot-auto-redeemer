const INVALID_PLAYER_ID = {
  type: "invalid",
  title: "Check Player ID",
  message: "Use the numeric Player ID shown in Kingshot under Profile → Info. It must contain 5–20 digits; your kingdom number is different."
};

const PLAYER_NOT_FOUND = {
  type: "not_found",
  title: "Player not found",
  message: "No player was found for this ID. Check every digit against Kingshot → Profile → Info. If the ID is correct, try again shortly."
};

function text(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

/**
 * Convert known player-ID API errors into player-facing guidance.
 * Unknown errors return null so transport/provider failures remain distinct.
 */
export function playerIdFeedback(code, message) {
  const normalizedCode = text(code).toLowerCase();
  const normalizedMessage = text(message).toLowerCase();

  if (
    normalizedCode === "invalid_player_id" ||
    /invalid player id|player id must contain 5.?20 digits|player id must be 5.?20 digits/.test(normalizedMessage)
  ) {
    return { ...INVALID_PLAYER_ID };
  }

  if (
    normalizedCode === "player_not_found" ||
    /mightpulse could not find this player|player lookup provider could not find this player|no player was found for this id|player not found/.test(normalizedMessage)
  ) {
    return { ...PLAYER_NOT_FOUND };
  }

  return null;
}
