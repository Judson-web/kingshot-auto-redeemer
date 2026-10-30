import test from "node:test";
import assert from "node:assert/strict";
import { isAdminAccessDenied } from "../src/admin-access-state.js";
import { readFile } from "node:fs/promises";

test("admin access state distinguishes auth failures from ordinary API errors", () => {
  assert.equal(isAdminAccessDenied(Object.assign(new Error("Unauthorized."), { status: 401 })), true);
  assert.equal(isAdminAccessDenied(Object.assign(new Error("Forbidden."), { status: 403 })), true);
  assert.equal(isAdminAccessDenied(new Error("Discord administrator sign-in required.")), true);
  assert.equal(isAdminAccessDenied(new Error("Upstream timed out.")), false);
  assert.equal(isAdminAccessDenied(new Error("The player database response was incomplete.")), false);
});

test("notification preferences stay available on public pages, not private workspaces", async () => {
  const entry = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  const push = await readFile(new URL("../src/components/PushNotifications.tsx", import.meta.url), "utf8");
  assert.match(entry, /privateWorkspacePaths=new Set\(\["\/dev","\/devsupport","\/admin\/players","\/admin\/alliance-sync","\/admin\/maintenance","\/push","\/message","\/gift-codes"\]\)/);
  assert.match(entry, /showNotificationPrompt=!isPrivateWorkspace/);
  assert.match(entry, /isPrivateWorkspace\?publicPage:<PublicAnnouncements>/);
  assert.match(entry, /!isPrivateWorkspace&&<InstallAppPrompt\/>/);
  assert.match(entry, /showNotificationPrompt&&<PushNotifications\/>/);
  assert.match(entry, /showPublicSupport&&<SupportWidget\/>/);
  assert.match(push, /bottom: "calc\(84px \+ env\(safe-area-inset-bottom, 0px\)\)"/);
  assert.match(push, /ks-push-panel-dismissed-v3/);
  assert.match(push, /localStorage\.getItem\("ks-push-panel-dismissed-v3"\) === "1"/);
  assert.match(push, /localStorage\.setItem\("ks-push-panel-dismissed-v3", "1"\)/);
  assert.match(push, /ks-push-panel-dismissed-v2/);
});

test("push notifications use richer platform presentation and safe click navigation", async () => {
  const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(worker, /const CACHE="kingshot-shell-v9"/);
  assert.match(worker, /timestamp:Date\.now\(\)/);
  assert.match(worker, /vibrate:\[120,60,120\]/);
  assert.match(worker, /dir:"auto"/);
  assert.match(worker, /new URL\(client\.url\)\.origin===self\.location\.origin/);
  assert.match(worker, /await client\.navigate\(target\)/);
});

test("admin player page never renders empty statistics before a valid player list loads", async () => {
  const page = await readFile(new URL("../src/AdminPlayersApp.tsx", import.meta.url), "utf8");
  const helper = await readFile(new URL("../src/admin-access-state.js", import.meta.url), "utf8");
  assert.match(page, /hasLoadedData/);
  assert.match(page, /if\(accessDenied\)return/);
  assert.match(page, /if\(!hasLoadedData\)return/);
  assert.match(page, /Your administrator session is missing, expired, or does not have permission/);
  assert.match(page, /profile\?returnTo=%2Fadmin%2Fplayers/);
  assert.match(page, /if\(!Array\.isArray\(d\.players\)\)throw Error\("The player database response was incomplete\."/);
  assert.match(page, /data\.players\.length\?"No players match this filter\."\:"No registered players yet\."/);
  assert.match(helper, /status === 401 \|\| status === 403/);
});


test("support inbox loads the isolated admin push control rather than the entire player database module", async () => {
  const player = await readFile(new URL("../src/AdminPlayersApp.tsx", import.meta.url), "utf8");
  const support = await readFile(new URL("../src/DevSupportApp.tsx", import.meta.url), "utf8");
  const control = await readFile(new URL("../src/components/AdminPushControl.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(support, /from "\.\/AdminPlayersApp"/);
  assert.match(support, /from "\.\/components\/AdminPushControl"/);
  assert.doesNotMatch(player, /export function AdminPushControl/);
  assert.match(control, /export default function AdminPushControl/);
});

test("secondary routes use lazy chunks and a Suspense fallback", async () => {
  const entry = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  assert.match(entry, /React\.lazy\(\(\)=>import\("\.\/ProfileApp\.tsx"\)\)/);
  assert.match(entry, /React\.lazy\(\(\)=>import\("\.\/DeveloperApp\.tsx"\)\)/);
  assert.match(entry, /React\.lazy\(\(\)=>import\("\.\/AdminPlayersApp\.tsx"\)\)/);
  assert.match(entry, /React\.Suspense fallback=/);
  assert.doesNotMatch(entry, /import AdminPlayersApp from/);
});

test("profile, admin and support-specific CSS follows the relevant lazy component", async () => {
  const profile = await readFile(new URL("../src/ProfileApp.tsx", import.meta.url), "utf8");
  const developer = await readFile(new URL("../src/DeveloperApp.tsx", import.meta.url), "utf8");
  const admin = await readFile(new URL("../src/AdminPlayersApp.tsx", import.meta.url), "utf8");
  const support = await readFile(new URL("../src/components/SupportWidget.tsx", import.meta.url), "utf8");
  const entry = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  assert.match(profile, /import "\.\/profile-redesign\.css"/);
  assert.match(developer, /import "\.\/developer-redesign\.css"/);
  assert.match(admin, /import "\.\/admin-players\.css"/);
  assert.match(support, /import "\.\.\/support-centre-redesign\.css"/);
  assert.doesNotMatch(entry, /import["']\.\/admin-players\.css/);
  assert.doesNotMatch(entry, /import["']\.\/profile-redesign\.css/);
  assert.doesNotMatch(entry, /import["']\.\/support-centre-redesign\.css/);
});

test("admin player page verifies the profile session and obtains owner access before loading private data", async () => {
  const page = await readFile(new URL("../src/AdminPlayersApp.tsx", import.meta.url), "utf8");
  const helper = await readFile(new URL("../src/admin-session-bootstrap.js", import.meta.url), "utf8");
  const call = page.indexOf("await ensureAdminWorkspaceSession();");
  const data = page.indexOf("const d=await request();", call);
  assert.ok(call >= 0 && data > call, "owner session bootstrap must run before the private data request");
  assert.match(helper, /developer=account-auth/);
  assert.match(helper, /action: "dev-check"/);
  assert.match(helper, /data\?\.authenticated !== true/);
});

test("admin session bootstrap succeeds only when server confirms the owner session", async () => {
  const { ensureAdminWorkspaceSession } = await import("../src/admin-session-bootstrap.js");
  let captured;
  await ensureAdminWorkspaceSession(async (url, init) => {
    captured = { url, init, credentials: init.credentials, body: JSON.parse(init.body) };
    return { ok: true, status: 200, json: async () => ({ authenticated: true }) };
  });
  assert.match(captured.url, /developer=account-auth/);
  assert.equal(captured.credentials, "same-origin");
  assert.equal(captured.body.action, "dev-check");
  await assert.rejects(
    () => ensureAdminWorkspaceSession(async () => ({ ok: true, status: 200, json: async () => ({ authenticated: false }) })),
    error => error.status === 401
  );
});


test("push console uses a review dialog instead of a generic browser confirmation", async () => {
  const consoleSource = await readFile(new URL("../src/PushConsoleApp.tsx", import.meta.url), "utf8");
  assert.match(consoleSource, /role="dialog" aria-modal="true"/);
  assert.match(consoleSource, /Review announcement/);
  assert.match(consoleSource, /audienceCount\.toLocaleString\(\) \+ " devices"/);
  assert.match(consoleSource, /Opens:/);
  assert.match(consoleSource, /onClick=\{confirmSend\}/);
  assert.doesNotMatch(consoleSource, /window\.confirm/);
  assert.match(consoleSource, /if \(busy \|\| !title\.trim\(\) \|\| !message\.trim\(\)\) return/);
});


test("verified gift-code pushes are explicit, actionable, and deduplicate stable batches", async () => {
  const worker = await readFile(new URL("../api/kingshot-auto.js", import.meta.url), "utf8");
  const push = await readFile(new URL("../internal/push-notifications.ts", import.meta.url), "utf8");
  const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(worker, /Kingshot verification passed for /);
  assert.match(worker, /verified gift codes ready/);
  assert.match(worker, /const sortedKey=uniqueCodes\.map\(item=>String\(item\.code\)\.trim\(\)\.toUpperCase\(\)\)\.sort\(\)\.join\("\\|"/);
  assert.match(worker, /tag="gift-codes-"\+\(tagHash>>>0\)\.toString\(36\)/);
  assert.match(worker, /action:"view-codes"/);
  assert.match(worker, /action:"dismiss"/);
  assert.match(push, /actions\?:Array/);
  assert.match(sw, /event\.action==="dismiss"/);
  assert.match(sw, /requireInteraction:Boolean\(p\.requireInteraction\)/);
});


test("verified gift-code pushes are explicit, actionable, and deduplicate stable batches", async () => {
  const worker = await readFile(new URL("../api/kingshot-auto.js", import.meta.url), "utf8");
  const push = await readFile(new URL("../internal/push-notifications.ts", import.meta.url), "utf8");
  const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(worker, /Kingshot verification passed for /);
  assert.match(worker, /verified gift codes ready/);
  assert.match(worker, /const sortedKey=uniqueCodes\.map/);
  assert.match(worker, /tag="gift-codes-"\+\(tagHash>>>0\)\.toString\(36\)/);
  assert.match(worker, /action:"view-codes"/);
  assert.match(worker, /action:"dismiss"/);
  assert.match(push, /actions\?:Array/);
  assert.match(sw, /event\.action==="dismiss"/);
  assert.match(sw, /requireInteraction:Boolean\(p\.requireInteraction\)/);
});
