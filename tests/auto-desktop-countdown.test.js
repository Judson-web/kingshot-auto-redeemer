import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("registration milestone appears only on Auto Redeem and Manual Redeem", async () => {
  const header = await read("../src/components/PublicSiteHeader.jsx");
  assert.match(header, /\(current===\"auto\"\|\|current===\"manual\"\)&&<SeasonCountdown\/>/);
});

test("Halloween seasonal decoration no longer renders an event countdown", async () => {
  const seasonal = await read("../src/components/SeasonalHalloweenOverlay.jsx");
  assert.doesNotMatch(seasonal, /ks-halloween-countdown|HALLOWEEN ENDS IN/);
  assert.match(seasonal, /ks-halloween-overlay/);
});

test("Auto Redeem uses a dedicated desktop layout without replacing the mobile flow", async () => {
  const entry = await read("../src/main.jsx");
  const styles = await read("../src/auto-desktop-layout.css");
  const mobileStyles = await read("../src/auto-registration-redesign.css");
  assert.match(entry, /id=\"auto-main-content\" className=\"ks-auto-desktop-layout\"/);
  assert.match(styles, /@media \(min-width: 1024px\)/);
  assert.match(styles, /grid-template-areas/);
  assert.match(styles, /@media \(max-width: 640px\)/);
});
