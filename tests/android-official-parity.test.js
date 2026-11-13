import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const activityUrl = new URL("../android/app/src/main/java/com/judson/kingshot/autoredeemer/MainActivity.kt", import.meta.url);
const activity = await readFile(activityUrl, "utf8");

test("primary application destinations render native Compose screens", () => {
  assert.match(activity, /AppTab\.HOME -> HomeScreen\(/);
  assert.match(activity, /AppTab\.REDEEM -> RedeemScreen\(container\)/);
  assert.match(activity, /AppTab\.PLAYERS -> PlayersScreen\(container\)/);
  assert.match(activity, /AppTab\.ACCOUNT -> AccountScreen\(/);
  assert.match(activity, /AppTab\.HISTORY -> HistoryScreen\(container\)/);
});

test("the Android application does not embed the website", () => {
  assert.doesNotMatch(activity, /android\.webkit\.WebView/);
  assert.doesNotMatch(activity, /AndroidView\s*\(/);
  assert.doesNotMatch(activity, /OfficialWebScreen/);
  assert.doesNotMatch(activity, /loadUrl\(/);
  assert.doesNotMatch(activity, /addJavascriptInterface\(/);
});

test("native app retains backend-backed Discord OAuth and optional developer settings", () => {
  assert.match(activity, /startDiscordSignIn\(challenge\)/);
  assert.match(activity, /completeDiscordSignIn\(code, verifier\)/);
  assert.match(activity, /Developer API key is only/i);
  assert.match(activity, /DeveloperApiSettings\(container\)/);
});

test("native Explore never silently opens an embedded web route", () => {
  assert.match(activity, /NativeFeatureScreen\(nativeFeature!!\)/);
  assert.match(activity, /being implemented with native Android screens and direct backend calls/);
});
