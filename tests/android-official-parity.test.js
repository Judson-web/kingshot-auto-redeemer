import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const activityUrl = new URL("../android/app/src/main/java/com/judson/kingshot/autoredeemer/MainActivity.kt", import.meta.url);
const activity = await readFile(activityUrl, "utf8");

test("primary application destinations render native Compose screens", () => {
  assert.match(activity, /AppTab\.HOME -> com\.judson\.kingshot\.autoredeemer\.ui\.home\.ProfessionalHomeScreen\(/);
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


test("announcements and legal pages are native Compose destinations", async () => {
  const apiUrl = new URL("../android/app/src/main/java/com/judson/kingshot/autoredeemer/data/api/RedeemerApi.kt", import.meta.url);
  const announcementsUrl = new URL("../android/app/src/main/java/com/judson/kingshot/autoredeemer/features/announcements/AnnouncementsScreen.kt", import.meta.url);
  const legalUrl = new URL("../android/app/src/main/java/com/judson/kingshot/autoredeemer/features/legal/NativeLegalScreen.kt", import.meta.url);
  const api = await readFile(apiUrl, "utf8");
  const announcements = await readFile(announcementsUrl, "utf8");
  const legal = await readFile(legalUrl, "utf8");
  assert.match(activity, /features\.announcements\.AnnouncementsScreen\(container\)/);
  assert.match(activity, /features\.legal\.NativeLegalScreen\(nativeFeature == "\/privacy"\)/);
  assert.match(activity, /"\/announcements"/);
  assert.match(api, /api\/kingshot-admin-data\?public=announcements/);
  assert.match(announcements, /container\.api\.publicAnnouncements\(\)/);
  assert.match(announcements, /uri\?\.scheme == "https"/);
  assert.match(legal, /Use the service responsibly/);
  assert.match(legal, /Your data, explained/);
  assert.match(legal, /30-day expiry/);
  assert.match(legal, /never send it to us/i);
});


test("owner administration uses the production session exchange and server authorization", async () => {
  const containerUrl = new URL("../android/app/src/main/java/com/judson/kingshot/autoredeemer/data/AppContainer.kt", import.meta.url);
  const repositoryUrl = new URL("../android/app/src/main/java/com/judson/kingshot/autoredeemer/data/RedeemerRepository.kt", import.meta.url);
  const apiUrl = new URL("../android/app/src/main/java/com/judson/kingshot/autoredeemer/data/api/RedeemerApi.kt", import.meta.url);
  const maintenanceUrl = new URL("../android/app/src/main/java/com/judson/kingshot/autoredeemer/features/maintenance/NativeMaintenanceScreen.kt", import.meta.url);
  const playersUrl = new URL("../android/app/src/main/java/com/judson/kingshot/autoredeemer/features/adminplayers/NativeAdminPlayersScreen.kt", import.meta.url);
  const container = await readFile(containerUrl, "utf8");
  const repository = await readFile(repositoryUrl, "utf8");
  const api = await readFile(apiUrl, "utf8");
  const maintenance = await readFile(maintenanceUrl, "utf8");
  const players = await readFile(playersUrl, "utf8");
  assert.match(container, /__Host-ks_owner_session/);
  assert.match(container, /OWNER_COOKIE_STORAGE/);
  assert.match(repository, /action", "dev-check"/);
  assert.match(repository, /ensureOwnerSession/);
  assert.match(api, /adminMaintenance/);
  assert.match(api, /adminPlayers/);
  assert.match(api, /adminPlayerAction/);
  assert.match(maintenance, /SET_MAINTENANCE/);
  assert.match(repository, /restricted to the configured owner Discord account/);
  assert.match(players, /BAN_PLAYER/);
  assert.match(players, /UNBAN_PLAYER/);
  assert.match(players, /ensureOwnerSession/);
  assert.match(activity, /features\.maintenance\.NativeMaintenanceScreen/);
  assert.match(activity, /features\.adminplayers\.NativeAdminPlayersScreen/);
});

test("legal and announcements pages no longer hand off to the browser", () => {
  assert.match(activity, /features\.legal\.NativeLegalScreen/);
  assert.match(activity, /features\.announcements\.AnnouncementsScreen/);
  assert.match(activity, /OfficialFeature\("Announcements"/);
});
