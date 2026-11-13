import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const activityUrl = new URL("../android/app/src/main/java/com/judson/kingshot/autoredeemer/MainActivity.kt", import.meta.url);
const activity = await readFile(activityUrl, "utf8");

test("official Android primary workflows use the production website rather than requiring a V4 key", () => {
  assert.match(activity, /AppTab\.HOME -> OfficialWebScreen\("\/", container\)/);
  assert.match(activity, /AppTab\.REDEEM -> OfficialWebScreen\("\/manual", container\)/);
  assert.match(activity, /AppTab\.PLAYERS -> OfficialWebScreen\("\/user", container\)/);
  assert.match(activity, /does not need a Developer API key for normal use/);
  assert.match(activity, /optional integration/i);
});

test("Explore exposes the official website feature routes", () => {
  for (const route of [
    "/alliance-registration", "/gift-codes", "/info", "/profile",
    "/developer", "/dev", "/devsupport", "/push", "/message",
    "/admin/players", "/admin/alliance-sync", "/admin/maintenance"
  ]) {
    assert.ok(activity.includes('"' + route + '"'), "Missing official route " + route);
  }
});

test("embedded official workspace is HTTPS host-pinned and blocks local file access", () => {
  assert.match(activity, /uri\.scheme == "https" && uri\.host == android\.net\.Uri\.parse\(origin\)\.host/);
  assert.match(activity, /settings\.allowFileAccess = false/);
  assert.match(activity, /settings\.allowContentAccess = false/);
  assert.match(activity, /WebSettings\.MIXED_CONTENT_NEVER_ALLOW/);
  assert.match(activity, /settings\.javaScriptCanOpenWindowsAutomatically = false/);
  assert.doesNotMatch(activity, /addJavascriptInterface\(/);
});

test("native Discord profile cookie is scoped to the official HTTPS WebView origin", () => {
  assert.match(activity, /PROFILE_COOKIE_STORAGE/);
  assert.match(activity, /Path=\/; Secure; HttpOnly; SameSite=Strict/);
  assert.match(activity, /CookieManager\.getInstance\(\)\.flush\(\)/);
});
