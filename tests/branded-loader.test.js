import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read=path=>readFile(new URL("../"+path,import.meta.url),"utf8");
test("workspace and preflight use one permanent Kingshot 3D loader",async()=>{
 const main=await read("src/main.jsx"),loader=await read("src/components/PumpkinLoader.jsx"),css=await read("src/components/branded-loader.css");
 assert.ok(main.includes('import { WorkspaceLoader } from "./components/PumpkinLoader.jsx";'));assert.ok(main.includes("WorkspaceLoader"));assert.ok(!main.includes("<PumpkinLoader"));assert.ok(main.includes("Getting things ready"));
 assert.ok(loader.includes("export function WorkspaceLoader"));assert.ok(loader.includes("KingshotMark"));assert.ok(loader.includes("ks-brand-loader-orbit"));
 assert.ok(css.includes("preserve-3d"));assert.ok(css.includes("rotateX(68deg)"));assert.ok(css.includes("prefers-reduced-motion"));
 assert.ok(!loader.includes("isHalloweenThemeActive"));
});
test("Halloween event decoration remains seasonal and separate from permanent loader",async()=>{
 const overlay=await read("src/components/SeasonalHalloweenOverlay.jsx"),loader=await read("src/components/PumpkinLoader.jsx");
 assert.ok(overlay.includes("HALLOWEEN_SEASON_END"));assert.ok(overlay.includes('role="timer"'));assert.ok(overlay.includes("HALLOWEEN ENDS IN"));
 assert.ok(!loader.includes("PumpkinMark"));assert.ok(!loader.includes("seasonal-theme"));
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
