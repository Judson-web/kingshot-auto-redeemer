// Pure helpers for safely pruning scraper archive files by their date-bearing paths.
// Unknown path formats must remain readable to preserve legacy archive compatibility.
export function archivePathDate(path) {
  const match = path.match(/(?:^|\\/)(\\d{4}-\\d{2}-\\d{2})(?:\\/|\\.jsonl$)/);
  return match?.[1] || null;
}

export function utcDay(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

export function shouldSkipArchivePath(path, afterDay, beforeDay) {
  const fileDay = archivePathDate(path);
  if (!fileDay) return false;
  if (afterDay && fileDay < afterDay) return true;
  if (beforeDay && fileDay > beforeDay) return true;
  return false;
}
