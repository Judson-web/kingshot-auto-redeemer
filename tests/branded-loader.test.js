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
test("Halloween effects and seasonal branding are removed from the app shell",async()=>{
 const main=await read("src/main.jsx"),loader=await read("src/components/PumpkinLoader.jsx");
 assert.ok(!main.includes("SeasonalHalloweenOverlay"));
 assert.ok(!main.includes("HALLOWEEN"));
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
 assert.ok(sw.includes("kingshot-shell-v12"));assert.ok(sw.includes('"/profile"'));
 assert.equal(manifest.name,"Kingshot Auto Redeemer");assert.equal(manifest.theme_color,"#0b0d10");
});

test("seasonal Halloween overlay and branding are fully removed from the app shell",async()=>{
 const main=await read("src/main.jsx");
 assert.ok(!main.includes("SeasonalHalloweenOverlay"));
 assert.ok(!main.includes("HALLOWEEN"));
});
test("public push subscriptions are reconciled server-side and public audience counts exclude admin devices",async()=>{
 const push=await read("src/components/PushNotifications.tsx"),api=await read("api/custom-message.js");
 assert.ok(push.includes('action: "PUSH_SUBSCRIBE", subscription: sub.toJSON()'));
 assert.ok(push.includes('else if (permission === "granted" && sub) setState("on")'));
 assert.ok(api.includes("kingshot_push_subscriptions?select=id&audience=eq.public&limit=1"));
});
test("service worker refreshes notification shell and keeps one interaction option",async()=>{
 const sw=await read("public/sw.js");
 assert.ok(sw.includes('const CACHE="kingshot-shell-v12"'));
 assert.equal((sw.match(/requireInteraction:Boolean\(p\.requireInteraction\)/g)||[]).length,1);
});

test("favicon and installed app icons use permanent Kingshot branding",async()=>{
 const favicon=await read("public/favicon.svg"),icon192=await read("public/icons/icon-192.svg"),icon512=await read("public/icons/icon-512.svg");
 const manifest=JSON.parse(await read("public/site.webmanifest")),html=await read("index.html"),sw=await read("public/sw.js");
 for(const asset of [favicon,icon192,icon512]){assert.match(asset,/<svg/);assert.doesNotMatch(asset,/pumpkin|#e77d32|#ffbd67|#bd5428/i);}
 assert.ok(html.includes("/favicon.svg?v=12"));assert.ok(html.includes("/icons/icon-192.svg?v=12"));assert.ok(html.includes("/site.webmanifest?v=12"));
 assert.ok(manifest.icons.every(icon=>icon.src.includes("?v=12")));
 assert.ok(sw.includes('const CACHE="kingshot-shell-v12"'));
 assert.ok(sw.includes('"/favicon.svg?v=12"'));assert.ok(sw.includes('"/icons/icon-512.svg?v=12"'));
});
