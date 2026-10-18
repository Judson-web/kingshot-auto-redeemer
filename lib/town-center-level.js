const EXPLICIT_TG = /^(?:TG|TRUE\s?GOLD)\s*([1-8])(?:\s*[-–]\s*([1-4]))?$/i;

/** Map a provider's Town Center progression value to its Truegold tier. */
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

/** Format normal Town Center, transition, and Truegold levels for display. */
export function formatTownCenterLevel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric >= 31 && numeric <= 34) return "30-" + (numeric - 30);
  const explicit = EXPLICIT_TG.exec(raw);
  if (explicit) return "TG" + Number(explicit[1]) + (explicit[2] ? "-" + Number(explicit[2]) : "");
  if (Number.isInteger(numeric) && numeric >= 35 && numeric <= 74) {
    const tier = Math.floor((numeric - 30) / 5);
    const stage = (numeric - 30) % 5;
    return "TG" + tier + (stage ? "-" + stage : "");
  }
  return raw;
}

/** Validate provider values before saving them; ignore unknown formats. */
export function normalizeTownCenterValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^[0-9]{1,2}$/.test(raw)) {
    const numeric = Number(raw);
    return numeric >= 1 && numeric <= 74 ? String(numeric) : null;
  }
  const transition = /^30[-–]([1-4])$/.exec(raw);
  if (transition) return "30-" + Number(transition[1]);
  const explicit = EXPLICIT_TG.exec(raw);
  if (explicit) return "TG" + Number(explicit[1]) + (explicit[2] ? "-" + Number(explicit[2]) : "");
  return null;
}
