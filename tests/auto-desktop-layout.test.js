import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("registration milestone stays limited to Auto Redeem and Manual Redeem", async () => {
  const header = await read("../src/components/PublicSiteHeader.jsx");
  assert.match(header, /const showRegistrationCountdown=current==="auto"\|\|current==="manual"/);
  assert.match(header, /showRegistrationCountdown&&<RegistrationCountdown\/>/);
});

test("Halloween decoration has no visible countdown or one-second timer loop", async () => {
  const seasonal = await read("../src/components/SeasonalHalloweenOverlay.jsx");
  assert.doesNotMatch(seasonal, /ks-halloween-countdown|HALLOWEEN ENDS IN|setInterval/);
  assert.match(seasonal, /ks-halloween-overlay/);
});

test("Auto Redeem has a dedicated desktop composition and preserves the mobile stylesheet", async () => {
  const entry = await read("../src/main.jsx");
  const desktop = await read("../src/auto-desktop-layout.css");
  const mobile = await read("../src/auto-registration-redesign.css");
  assert.match(entry, /import["']\.\/auto-desktop-layout\.css["']/);
  assert.match(entry, /id="auto-main-content" className="ks-auto-desktop-layout"/);
  assert.match(desktop, /@media \(min-width: 1024px\)/);
  assert.match(desktop, /grid-template-areas/);
  assert.match(mobile, /@media \(max-width: 640px\)/);
});
