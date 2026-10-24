export const MAX_REGISTRATION_IDS = 10;

// Normalize clipboard/drag-drop input into the exact character set the form supports.
// Bad alphanumeric/symbol-containing tokens are dropped whole, so "abc123" cannot
// silently turn into a different Player ID "123".
export function sanitizeRegistrationInput(value) {
  const normalized = String(value ?? "").replace(/[\r\n\t]+/g, " ");
  return normalized
    .split(/([, ]+)/)
    .map(token => /^[, ]+$/.test(token) || /^\d+$/.test(token) ? token : "")
    .join("")
    .replace(/ {2,}/g, " ");
}

export function splitRegistrationIds(value) {
  const input = String(value ?? "").trim();
  const segments = input ? input.split(/[, ]+/).filter(Boolean) : [];
  const ids = [...new Set(segments)];
  return {
    ids,
    enteredCount: segments.length,
    uniqueCount: ids.length,
    duplicateCount: segments.length - ids.length
  };
}

export function validateRegistrationIds(value) {
  const input = String(value ?? "").trim();
  if (!input) {
    return { ids: [], duplicateCount: 0, error: "Enter at least one Kingshot Player ID." };
  }
  if (!/^[0-9, ]+$/.test(input)) {
    return { ids: [], duplicateCount: 0, error: "Use digits, commas, and spaces only. Letters and symbols are not allowed." };
  }

  const parsed = splitRegistrationIds(input);
  if (!parsed.uniqueCount) {
    return { ids: [], duplicateCount: 0, error: "Enter at least one Kingshot Player ID." };
  }
  const invalid = parsed.ids.find(id => !/^\d{5,20}$/.test(id));
  if (invalid) {
    return {
      ids: [],
      duplicateCount: parsed.duplicateCount,
      error: "Each Player ID must contain 5–20 digits. Check: " + invalid
    };
  }
  if (parsed.uniqueCount > MAX_REGISTRATION_IDS) {
    return {
      ids: [],
      duplicateCount: parsed.duplicateCount,
      error: "Register up to " + MAX_REGISTRATION_IDS + " unique Player IDs per submission. Split larger lists into batches of " + MAX_REGISTRATION_IDS + "."
    };
  }
  return {
    ids: parsed.ids,
    duplicateCount: parsed.duplicateCount,
    error: ""
  };
}

export function registrationInputSummary(value) {
  const input = String(value ?? "").trim();
  const parsed = splitRegistrationIds(input);
  if (!input) {
    return { label: "Up to " + MAX_REGISTRATION_IDS + " IDs", detail: "Commas or spaces", overLimit: false };
  }
  if (!parsed.uniqueCount) {
    return { label: "No IDs detected", detail: "Enter 5–20 digit Player IDs", overLimit: false };
  }
  if (parsed.uniqueCount > MAX_REGISTRATION_IDS) {
    return {
      label: parsed.uniqueCount + " unique IDs entered",
      detail: "Process " + MAX_REGISTRATION_IDS + " at a time",
      overLimit: true
    };
  }
  return {
    label: parsed.uniqueCount + " unique " + (parsed.uniqueCount === 1 ? "ID" : "IDs") + " entered",
    detail: parsed.duplicateCount
      ? parsed.duplicateCount + " duplicate " + (parsed.duplicateCount === 1 ? "ID" : "IDs") + " will be ignored"
      : "Ready to register",
    overLimit: false
  };
}
