import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const component = await readFile(new URL("../src/AllianceRegistration.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/alliance-registration.css", import.meta.url), "utf8");
const english = await readFile(new URL("../src/shared/translations/en.js", import.meta.url), "utf8");
const korean = await readFile(new URL("../src/shared/translations/ko.js", import.meta.url), "utf8");
const api = await readFile(new URL("../api/kingshot-player.ts", import.meta.url), "utf8");
const metadata = await readFile(new URL("../alliance-registration.html", import.meta.url), "utf8");

test("alliance registration uses one server-side whole-alliance action", () => {
  assert.match(component, /const registerEntireAlliance = async/);
  assert.match(component, /action: "register-alliance"/);
  assert.doesNotMatch(component, /Register selected members|Select visible|Select new members|ks-alliance-selection-bar|ks-alliance-submit-row/);
});

test("alliance lookup ignores stale responses after a newer search or roster request", () => {
  assert.match(component, /const searchRequestRef = useRef\(0\)/);
  assert.match(component, /const rosterRequestRef = useRef\(0\)/);
  assert.match(component, /requestId !== searchRequestRef\.current/);
  assert.match(component, /requestId !== rosterRequestRef\.current/);
});

test("refreshing the same alliance preserves attempt history and only reconciles current selection", () => {
  assert.match(component, /const sameAlliance = Boolean/);
  assert.match(component, /if \(sameAlliance\) \{[\s\S]*?setSelected\(current => current\.filter\(id => validIds\.has\(id\) && !registered\.has\(id\)\)\)/);
  assert.match(component, /if \(!sameAlliance\) \{/);
});

test("a new search clears a superseded roster loading state", () => {
  assert.match(component, /rosterRequestRef\.current\+\+/);
  assert.match(component, /setLoadingRoster\(false\);\s*setRoster\(null\);/);
  assert.match(component, /normalized\.ageSeconds > 3600/);
});

test("alliance search submits the entered name or tag to the server", () => {
  assert.match(component, /mode: "search", kingdomId: kingdomId\.trim\(\), \.\.\.\(query\.trim\(\) \? \{ q: query\.trim\(\) \} : \{\}\)/);
});

test("alliance roster keeps a member filter, empty state, and refresh action", () => {
  assert.match(component, /alliance\.refreshRoster/);
  assert.match(component, /alliance\.memberFilterPlaceholder/);
  assert.match(component, /ks-alliance-empty-state/);
});

test("alliance page has reduced-motion, focus, and small-screen interaction styling", () => {
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /focus-visible/);
  assert.match(styles, /max-width: 420px/);
  assert.match(styles, /ks-alliance-empty-state/);
});

test("alliance registration labels exist in English and Korean dictionaries", () => {
  for (const key of ["alliance.pageTitle", "alliance.alreadyRegistered", "alliance.notRegistered", "alliance.refreshRoster"]) {
    assert.ok(english.includes('"' + key + '"'), "missing English translation: " + key);
    assert.ok(korean.includes('"' + key + '"'), "missing Korean translation: " + key);
  }
});


test("all alliance results are rendered without a show-more cap or exact-tag fallback", () => {
  assert.match(component, /filteredAlliances\.map\(item =>/);
  assert.doesNotMatch(component, /showAllAlliances|setShowAllAlliances|exactTagToggle|loadExactTag|ks-alliance-exact/);
});

test("alliance flag images reveal a fallback icon if the upstream asset fails", () => {
  assert.match(component, /className="ks-alliance-flag"><Users size=\{18\}/);
  assert.match(component, /onError=\{event => \{ event\.currentTarget\.style\.display = "none"; \}\}/);
  assert.match(api, /row\.icon_url \?\? row\.iconUrl/);
});

test("whole-alliance registration respects the four-per-kingdom capacity and uses server progress", () => {
  assert.match(component, /allianceSyncCapacity\?\.canRegister/);
  assert.match(component, /allianceAlreadyRegistered/);
  assert.match(component, /capacityData\.canRegister/);
  assert.match(component, /ks-alliance-server-progress/);
  assert.doesNotMatch(component, /ks-alliance-outcome-list/);
});


test("alliance roster returns to the cached search results until the page is refreshed", () => {
  assert.match(component, /alliance\.backToList/);
  assert.match(component, /onClick=\{\(\) => \{ rosterRequestRef\.current\+\+; setLoadingRoster\(false\); setActiveAlliance\(null\); updateAllianceLocation\(\); setRosterError\(""\); \}\}/);
  assert.match(component, /if \(!forceRefresh && roster && roster\.alliance\.kingdomId/);
  assert.match(component, /loadRoster\(activeAlliance, true\)/);
});

test("roster shows registration status for every member without manual selection", () => {
  assert.match(component, /registeredIds\.includes\(member\.playerId\) \? t\("alliance\.alreadyRegistered"/);
  assert.match(component, /t\("alliance\.notRegistered", "Not registered"\)/);
  assert.doesNotMatch(component, /<input type="checkbox"/);
});

test("automatic alliance sync is informational and scheduled after first registration", () => {
  assert.match(component, /action: "create", kingdomId: activeAlliance\.kingdomId/);
  assert.match(component, /alliance\.autoSyncSetupFailed/);
  assert.match(component, /24-hour alliance schedule|24-hour sync/,
    "the first registration configures the fixed 24-hour schedule and reports setup failures");
  assert.doesNotMatch(component, /alliance\.enableAutoSync/);
  assert.doesNotMatch(component, /updateAutoSync\("sync"\)|alliance\.pauseSync/);
});

test("alliance flag is visible in the roster identity and retains a fallback icon", () => {
  assert.match(component, /ks-alliance-roster-flag/);
  assert.match(component, /ks-alliance-roster-flag"><Users size=\{18\}/);
});


test("alliance registration UI has no manual player registration or cancellation controls", () => {
  assert.doesNotMatch(component, /alliance\.cancelRegistration/);
  assert.doesNotMatch(component, /alliance\.registerSelectedMembers/);
  assert.doesNotMatch(component, /<input type="checkbox"/);
  assert.match(component, /action: "register-alliance"/);
});

test("automatic registration cancellation preserves completed outcomes and skips unstarted IDs", async () => {
  const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  assert.match(main, /if\(cancelRequestedRef\.current\)break/);
  assert.match(main, /auto\.cancelRegistration/);
  assert.match(main, /auto\.cancelled/);
  assert.match(main, /window\.addEventListener\("pagehide",handlePageHide\)/);
});

test("manual redeem cancellation never automatically retries an uncertain redemption", async () => {
  const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  assert.match(main, /manualControllerRef\.current\?\.abort\(\)/);
  assert.match(main, /manual\.cancelledUnknown/);
  assert.match(main, /manualAbortReasonRef\.current==="user"/);
  assert.match(main, /if\(manualAbortReasonRef\.current==="user"\)throw/);
});

test("cancellation guidance is available in English and Korean", () => {
  for (const key of ["auto.cancelRegistration", "auto.cancelPending", "auto.cancelled", "manual.stopWaiting", "manual.cancelledUnknown", "alliance.cancelRegistration", "alliance.cancelled"]) {
    assert.ok(english.includes('"' + key + '"'), "missing English translation: " + key);
    assert.ok(korean.includes('"' + key + '"'), "missing Korean translation: " + key);
  }
});


test("accepted alliance registration immediately shows Registered and explains server-side continuation", () => {
  assert.match(component, /setAllianceSyncCapacity\(current => \(\{[\s\S]*?isRegistered: true[\s\S]*?canRegister: false/);
  assert.match(component, /alliance\.serverContinues/);
  assert.match(component, /\(registering \|\| allianceSyncCapacity\?\.isRegistered\)/);
  assert.match(component, /const switchingAlliance =/);
});

test("alliance loading copy and social preview describe the current registration flow", () => {
  assert.match(component, /alliance\.loadingAllianceInfo/);
  assert.match(english, /"alliance\.loadingAllianceInfo": "Loading"/);
  assert.match(korean, /"alliance\.loadingAllianceInfo": "불러오는 중"/);
  assert.match(metadata, /og:title" content="Kingshot Alliance Registration"/);
  assert.match(metadata, /route=alliance-registration&v=6/);
  assert.doesNotMatch(metadata, /select individuals|select individual members/);
});


test("mobile search card keeps its submit button inside the panel", () => {
  assert.match(styles, /ks-alliance-discover-form\{padding-bottom:20px!important\}/);
  assert.match(styles, /ks-alliance-discovery\{overflow:visible!important\}/);
});

test("alliance registration explains the four-alliance kingdom cap", () => {
  assert.match(component, /kingdom_alliance_limit/);
  assert.match(component, /alliance\.kingdomAllianceCapTitle/);
  assert.match(component, /allianceSyncCapacity\.registeredCount >= allianceSyncCapacity\.limit/);
  assert.match(english, /"alliance\.kingdomAllianceCapReached": "This kingdom already has 4 registered alliances/);
  assert.match(korean, /"alliance\.kingdomAllianceCapReached": "이 왕국에는 이미 연맹 4개/);
});

test("beta badge appears only in alliance drawer and announcement", async () => {
  const nav = await readFile(new URL("../src/components/MobileNavDrawer.jsx", import.meta.url), "utf8");
  const banner = await readFile(new URL("../src/components/AllianceFeatureAnnouncement.jsx", import.meta.url), "utf8");
  assert.match(nav, /alliance\.pageTitle"[\s\S]*?ks-beta-tag">BETA/);
  assert.match(banner, /ks-alliance-feature-kicker"[\s\S]*?ks-beta-tag">BETA/);
  assert.match(english, /"alliance\.pageTitle": "Alliance Registration"/);
  assert.doesNotMatch(component, /ks-beta-tag-page|Alliance Member Registration/);
});

test("alliance registration social metadata reflects current flow", async () => {
  const metadata = await readFile(new URL("../alliance-registration.html", import.meta.url), "utf8");
  assert.match(metadata, /og:title" content="Kingshot Alliance Registration"/);
  assert.match(metadata, /route=alliance-registration&v=6/);
  assert.match(metadata, /Up to four alliances per kingdom/);
  assert.match(metadata, /route=alliance-registration&v=6/);
  assert.match(metadata, /server-side roster sync/);
  assert.doesNotMatch(metadata, /select individuals|select individual members/);
});

test("refreshes roster when server-side alliance processing finishes", () => {
  assert.match(component, /const completed = Boolean\(allianceServerProgress\?\.active\)/);
  assert.match(component, /if \(completed && !cancelled\) void loadRoster\(activeAlliance, true\)/);
});


test("kingdom alliance cap check and insert are serialized by a Supabase transaction", async () => {
  const handler = await readFile(new URL("../internal/kingshot/alliance-sync-handler.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase/migrations/20261029233000_raise_alliance_sync_cap_to_four.sql", import.meta.url), "utf8");
  assert.match(handler, /register_alliance_sync_config/);
  assert.match(handler, /runAllianceSyncAsAdmin/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /if v_total >= 4 then/);
  assert.match(migration, /alliance_already_managed/);
});

test("How it works page imports every icon used by its feature sections", async () => {
  const info = await readFile(new URL("../src/InfoApp.jsx", import.meta.url), "utf8");
  const iconImport = info.match(/import\s*\{([^}]+)\}\s*from\s*"lucide-react"/);
  assert.ok(iconImport, "How it works page should import its Lucide icons");
  const importedIcons = new Set(iconImport[1].split(",").map(value => value.trim().split(/\s+as\s+/)[0]));
  assert.ok(importedIcons.has("Users"), "Users icon is rendered by the alliance registration feature card");
  assert.match(info, /icon:Users,titleKey:"info\.cardAlliance"/);
});
