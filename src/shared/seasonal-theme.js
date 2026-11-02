export const HALLOWEEN_SEASON_END = Date.parse("2026-11-02T18:30:00Z");
export const isHalloweenThemeActive = (now = Date.now()) => Number(now) < HALLOWEEN_SEASON_END;
