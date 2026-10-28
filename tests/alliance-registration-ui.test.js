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

test("whole-alliance registration respects the three-per-kingdom capacity and uses server progress", () => {
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
  assert.match(metadata, /og:title" content="Alliance Registration"/);
  assert.match(metadata, /route=alliance-registration&v=4/);
  assert.doesNotMatch(metadata, /select individuals|select individual members/);
});
