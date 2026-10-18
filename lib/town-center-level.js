const EXPLICIT_TG = /^(?:TG|TRUE\\s?GOLD)\\s*([1-8])(?:\\s*[-–]\\s*(\\d+))?$/i;

/**
 * Map the provider's linear Town Center progression value to its Truegold tier.
 * Levels 1–30 are standard. 31–34 are 30-1 through 30-4; 35 is TG1;
 * every tier then has four internal stages before the next TG tier begins.
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

/** Return the exact player-facing label for a Town Center progression value. */
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

  if (Number.isInteger(numeric) && numeric >= 35 && numeric <= 74) {
    const tier = Math.floor((numeric - 30) / 5);
    const stage = (numeric - 30) % 5;
    return "TG" + tier + (stage ? "-" + stage : "");
  }

  return raw;
}
