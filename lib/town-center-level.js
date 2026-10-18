const EXPLICIT_TG = /^(?:TG|TRUE\\s?GOLD)\\s*([1-8])(?:\\s*[-–]\\s*(\\d+))?$/i;

/**
 * Map the provider's linear Town Center progression value to a Truegold tier.
 * Levels 1–30 are normal; 31–34 are the four 30-x transition stages; 35–39
 * are TG1, then every five progression values advances the displayed tier.
 */
export function townCenterTier(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const explicit = EXPLICIT_TG.exec(raw);
  if (explicit) return Number(explicit[1]);

  const numeric = Number(raw);
  if (!Number.isInteger(numeric) || numeric < 35 || numeric > 74) return null;

  const tier = Math.floor((numeric - 30) / 5);
  return tier >= 1 && tier <= 8 ? tier : null;
}

/** Return the player-facing Town Center label for text-only surfaces. */
export function formatTownCenterLevel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";

  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric >= 31 && numeric <= 34) {
    return "30-" + (numeric - 30);
  }

  const explicit = EXPLICIT_TG.exec(raw);
  if (explicit) {
    return "TG" + Number(explicit[1]) + (explicit[2] ? "-" + Number(explicit[2]) : "");
  }

  const tier = townCenterTier(value);
  return tier ? "TG" + tier : raw;
}
