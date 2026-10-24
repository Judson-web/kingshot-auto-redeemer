export function normalizeRegistrationInput(body = {}) {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  return {
    // Trim surrounding whitespace, but never strip letters/symbols. The handler must
    // reject malformed IDs rather than accidentally registering a different numeric ID.
    playerId: String(input.playerId ?? "").trim(),
    kingdomId: String(input.kingdomId ?? "").trim(),
    playerName: String(input.playerName ?? "").trim().slice(0, 120),
    avatarUrl: String(input.avatarUrl ?? "").trim().slice(0, 500)
  };
}
