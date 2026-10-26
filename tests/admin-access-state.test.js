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

test("public prompts are scoped to public redemption routes, not private workspaces", async () => {
  const entry = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  const push = await readFile(new URL("../src/components/PushNotifications.tsx", import.meta.url), "utf8");
  assert.match(entry, /privateWorkspacePaths=new Set\(\["\/dev","\/devsupport","\/admin\/players","\/admin\/maintenance","\/push","\/message","\/gift-codes"\]\)/);
  assert.match(entry, /showNotificationPrompt=\["\/","\/auto","\/manual","\/redeem"\]\.includes\(location\.pathname\)/);
  assert.match(entry, /isPrivateWorkspace\?publicPage:<PublicAnnouncements>/);
  assert.match(entry, /!isPrivateWorkspace&&<InstallAppPrompt\/>/);
  assert.match(entry, /showNotificationPrompt&&<PushNotifications\/>/);
  assert.match(entry, /showPublicSupport&&<SupportWidget\/>/);
  assert.match(push, /bottom: "calc\(84px \+ env\(safe-area-inset-bottom, 0px\)\)"/);
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

test("admin data accepts a profile session only after verifying the configured Discord owner", async () => {
  const adminData = await readFile(new URL("../lib/admin-data.js", import.meta.url), "utf8");
  const identity = await readFile(new URL("../lib/discord-identity.js", import.meta.url), "utf8");
  assert.match(adminData, /const PROFILE_COOKIE="__Host-ks_profile_session"/);
  assert.match(adminData, /const ownerSession=getCookie\(req,COOKIE\),profileSession=getCookie\(req,PROFILE_COOKIE\)/);
  assert.match(adminData, /isDiscordOwner\(owner,OWNER_DISCORD_ID\)/);
  assert.match(adminData, /session===profileSession&&session!==ownerSession/);
  assert.ok(adminData.indexOf("isDiscordOwner(owner,OWNER_DISCORD_ID)") < adminData.indexOf('COOKIE+"="+encodeURIComponent(session)'));
  assert.match(identity, /return hasDiscord && actual.length > 0 && actual === String\(expectedDiscordId\)/);
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
