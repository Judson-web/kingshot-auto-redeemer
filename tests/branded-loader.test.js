import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read=path=>readFile(new URL("../"+path,import.meta.url),"utf8");
test("workspace and preflight use one permanent Kingshot 3D loader",async()=>{
 const main=await read("src/main.jsx"),loader=await read("src/components/PumpkinLoader.jsx"),css=await read("src/components/branded-loader.css");
 assert.ok(main.includes('import { WorkspaceLoader } from "./components/PumpkinLoader.jsx";'));assert.ok(main.includes("WorkspaceLoader"));assert.ok(!main.includes("<PumpkinLoader"));assert.ok(main.includes("Getting things ready"));assert.ok(main.includes("refreshMaintenanceStatus"));assert.ok(main.includes("retryLabel"));assert.ok(loader.includes("ks-workspace-loader-retry"));
 assert.ok(loader.includes("export function WorkspaceLoader"));assert.ok(loader.includes("KingshotMark"));assert.ok(loader.includes("ks-brand-loader-orbit"));
 assert.ok(css.includes("preserve-3d"));assert.ok(css.includes("rotateX(68deg)"));assert.ok(css.includes("prefers-reduced-motion"));
 assert.ok(!loader.includes("isHalloweenThemeActive"));
});
test("Halloween countdown is removed while seasonal decoration stays separate from the loader",async()=>{
 const main=await read("src/main.jsx"),overlay=await read("src/components/SeasonalHalloweenOverlay.jsx"),loader=await read("src/components/PumpkinLoader.jsx");
 assert.ok(main.includes("SeasonalHalloweenOverlay"));
 assert.ok(!overlay.includes("ks-halloween-countdown"));
 assert.ok(!overlay.includes("HALLOWEEN ENDS IN"));
 assert.ok(!overlay.includes('role="timer"'));
 assert.ok(!loader.includes("PumpkinMark"));assert.ok(!loader.includes("seasonal-theme"));
});
test("registration milestone countdown is removed from the public header",async()=>{
 const header=await read("src/components/PublicSiteHeader.jsx");
 assert.ok(!header.includes("RegistrationCountdown"));
 assert.ok(!header.includes("showRegistrationCountdown"));
 assert.ok(!header.includes("milestone=count"));
});
test("Auto Redeem has a distinct desktop workspace while retaining its mobile layout",async()=>{
 const css=await read("src/auto-registration-redesign.css"),main=await read("src/main.jsx");
 assert.ok(main.includes('className="app ks-app ks-auto-app"'));
 assert.ok(css.includes("@media (min-width: 960px)"));
 assert.ok(css.includes("grid-template-columns: minmax(0, .88fr) minmax(470px, 1.12fr)"));
 assert.ok(css.includes("grid-template-columns: repeat(3, minmax(0, 1fr))"));
 assert.ok(css.includes("@media (max-width: 640px)"));
});
test("profile has a separate desktop layout while preserving responsive mobile styling",async()=>{
 const css=await read("src/profile-redesign.css"),app=await read("src/ProfileApp.tsx");
 assert.ok(app.includes("profile-desktop-layout"));assert.ok(app.includes("profile-user-card-modern"));assert.ok(app.includes("profile-quick-links"));
 assert.ok(css.includes("@media (min-width: 1024px)"));assert.ok(css.includes("grid-template-columns:repeat(2,minmax(0,1fr))"));assert.ok(css.includes("@media(max-width:620px)"));
});
test("PWA shell cache includes the profile route and refreshes the branded shell",async()=>{
 const sw=await read("public/sw.js"),manifest=JSON.parse(await read("public/site.webmanifest"));
 assert.ok(sw.includes("kingshot-shell-v10"));assert.ok(sw.includes('"/profile"'));
 assert.equal(manifest.name,"Kingshot Auto Redeemer");assert.equal(manifest.theme_color,"#0b0d10");
});
