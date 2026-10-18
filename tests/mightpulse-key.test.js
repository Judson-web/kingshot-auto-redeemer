import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const paths = [
  "../internal/kingshot/mightpulse.ts",
  "../internal/kingshot/kingdom-validation.ts",
  "../lib/discord-interactions.js",
  "../api/kingshot-player.ts",
];

test("MightPulse API key 2 takes precedence while preserving legacy fallbacks", async () => {
  const selector = /process\\.env\\.MIGHTPULSE_API_KEY_2\\s*\\|\\|\\s*process\\.env\\.MIGHTPULSE_API_KEY\\s*\\|\\|\\s*process\\.env\\.KSS_API_KEY/;
  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, selector, `${path} must prefer MIGHTPULSE_API_KEY_2 and retain legacy fallback keys`);
  }
});
