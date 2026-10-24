export const MAX_REGISTRATION_IDS = 10;

export function splitRegistrationIds(value) {
  const input = String(value ?? "").trim();
  const segments = input ? input.split(/[,\s]+/).filter(Boolean) : [];
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
  if (!/^[0-9,\s]+$/.test(input)) {
    return { ids: [], duplicateCount: 0, error: "Player IDs can only contain digits, commas, spaces, or new lines." };
  }

  const parsed = splitRegistrationIds(input);
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
    return { label: "Up to " + MAX_REGISTRATION_IDS + " IDs", detail: "Commas, spaces, or new lines" };
  }
  if (parsed.uniqueCount > MAX_REGISTRATION_IDS) {
    return {
      label: parsed.uniqueCount + " unique IDs entered",
      detail: "Process " + MAX_REGISTRATION_IDS + " at a time"
    };
  }
  return {
    label: parsed.uniqueCount + " unique " + (parsed.uniqueCount === 1 ? "ID" : "IDs") + " entered",
    detail: parsed.duplicateCount
      ? parsed.duplicateCount + " duplicate " + (parsed.duplicateCount === 1 ? "ID" : "IDs") + " will be ignored"
      : "Ready when you are"
  };
}
