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
  assert.match(activity, /No Developer API key is required/);
  assert.match(activity, /AllianceRegistrationScreen/);
  assert.match(activity, /GiftCodesScreen/);
  assert.match(activity, /AllianceSyncAdminScreen/);
  assert.match(activity, /DeveloperApiSettings\(container\)/);
});

test("unfinished specialist workspaces open their real protected production routes", () => {
  assert.match(activity, /"\/dev" to \("Developer workspace"/);
  assert.match(activity, /"\/devsupport" to \("Developer support"/);
  assert.match(activity, /"\/push" to \("Push console"/);
  assert.match(activity, /"\/message" to \("Custom message"/);
  assert.match(activity, /"\/admin\/players" to \("Player administration"/);
  assert.match(activity, /"\/admin\/maintenance" to \("Maintenance controls"/);
  assert.match(activity, /Intent\(Intent\.ACTION_VIEW, Uri\.parse\(target\)\)/);
  assert.match(activity, /server-side Discord authorization/);
});

test("ordinary redemption and player lookup use public endpoints without a developer key", async () => {
  const apiUrl = new URL("../android/app/src/main/java/com/judson/kingshot/autoredeemer/data/api/RedeemerApi.kt", import.meta.url);
  const repoUrl = new URL("../android/app/src/main/java/com/judson/kingshot/autoredeemer/data/RedeemerRepository.kt", import.meta.url);
  const api = await readFile(apiUrl, "utf8");
  const repository = await readFile(repoUrl, "utf8");
  assert.match(api, /api\/kingshot-player/);
  assert.match(api, /api\/kingshot-redeem/);
  assert.match(repository, /api\.publicPlayer\(playerId\)/);
  assert.match(repository, /api\.publicRedeem\(body\)/);
  assert.match(repository, /redemption_unresolved/);
});

test("native alliance and gift-code tools use first-party backend endpoints", async () => {
  const apiUrl = new URL("../android/app/src/main/java/com/judson/kingshot/autoredeemer/data/api/RedeemerApi.kt", import.meta.url);
  const api = await readFile(apiUrl, "utf8");
  assert.match(api, /api\/kingshot-gift-codes/);
  assert.match(api, /developerPath=alliance-lookup/);
  assert.match(api, /developer=alliance-sync/);
});

test("native alliance sync administration uses the existing authenticated worker API", async () => {
  const apiUrl = new URL("../android/app/src/main/java/com/judson/kingshot/autoredeemer/data/api/RedeemerApi.kt", import.meta.url);
  const containerUrl = new URL("../android/app/src/main/java/com/judson/kingshot/autoredeemer/data/AppContainer.kt", import.meta.url);
  const api = await readFile(apiUrl, "utf8");
  const container = await readFile(containerUrl, "utf8");
  assert.match(api, /api\/kingshot-alliance-sync/);
  assert.match(api, /allianceSyncAction/);
  assert.match(api, /allianceSyncQuery/);
  assert.match(container, /api\/kingshot-alliance-sync/);
});
