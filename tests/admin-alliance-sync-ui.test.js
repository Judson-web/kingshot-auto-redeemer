import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const component = await readFile(new URL("../src/AdminAllianceSyncApp.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/admin-alliance-sync.css", import.meta.url), "utf8");

test("admin alliance page aborts and ignores stale roster responses", () => {
  assert.match(component, /rosterAbort\.current\?\.abort\(\)/);
  assert.match(component, /requestId!==rosterRequest\.current/);
  assert.match(component, /controller\.signal/);
  assert.match(component, /mounted\.current&&requestId===rosterRequest\.current/);
});

test("roster refresh preserves only selected IDs still eligible for registration", () => {
  assert.match(component, /const valid=new Set\(next\.filter\(m=>!m\.alreadyRegistered\)\.map\(m=>m\.playerId\)\)/);
  assert.match(component, /setSelected\(current=>current\.filter\(id=>valid\.has\(id\)\)\)/);
});

test("roster errors are recoverable and isolated from configuration loading", () => {
  assert.match(component, /rosterError&&<div className="aas-alert aas-alert-error aas-roster-alert"/);
  assert.match(component, /onClick=\{\(\)=>void openRoster\(c,\{refresh:true\}\)\}/);
  assert.match(component, /Could not load the live roster/);
});

test("manual registration queues a durable job and displays server-backed progress", () => {
  assert.match(component, /action:"ADMIN_REGISTER_ALLIANCE_MEMBERS"/);
  assert.match(component, /action:"GET_ALLIANCE_REGISTRATION_JOB"/);
  assert.match(component, /action:"PROCESS_ALLIANCE_REGISTRATION_JOB"/);
  assert.match(component, /allianceRegistrationJob=/);
  assert.match(component, /aas-registration-progress/);
  assert.match(component, /aria-valuenow=/);
  assert.match(component, /Review failed registrations/);
});

test("selection controls operate on visible eligible members and report accurate counts", () => {
  assert.match(component, /const visibleEligible=useMemo/);
  assert.match(component, /const allVisibleSelected=visibleEligible\.length>0/);
  assert.match(component, /toggleVisible/);
  assert.match(component, /players need registration/);
});

test("unregister uses an accessible confirmation dialog instead of a browser-native prompt", () => {
  assert.match(component, /role="dialog" aria-modal="true"/);
  assert.match(component, /aria-labelledby="aas-confirm-title"/);
  assert.doesNotMatch(component, /window\.confirm/);
});

test("admin layout supports small screens, keyboard focus, and reduced motion", () => {
  assert.match(styles, /@media\(max-width:650px\)/);
  assert.match(styles, /@media\(max-width:380px\)/);
  assert.match(styles, /focus-visible/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
});

test("admin UI clearly distinguishes registered members, failures, and disabled syncs", () => {
  assert.match(component, /is-registered/);
  assert.match(component, /aas-result-warning/);
  assert.match(component, /aas-enabled.*is-disabled/);
  assert.match(component, /Last sync error/);
});


test("alliance sync page verifies administrator access before fetching private configurations", async () => {
  assert.match(component, /ensureAdminWorkspaceSession/);
  assert.match(component, /await ensureAdminWorkspaceSession\(\);const d=await request/);
  assert.match(component, /setAccessDenied\(isAdminAccessDenied\(e\)\)/);
  assert.match(component, /if\(accessDenied\)return/);
  assert.match(component, /profile\?returnTo=%2Fadmin%2Falliance-sync/);
  assert.doesNotMatch(component, /Inspect live rosters, repair missed player registrations, and manage sync configurations from one place\./);
});

test("registration progress is stored in Neon and resumable through server-side batches", async () => {
  const migration = await readFile(new URL("../migrations/neon/202610290001_alliance_manual_registration_jobs.sql", import.meta.url), "utf8");
  assert.match(migration, /alliance_manual_registration_jobs/);
  assert.match(migration, /processed_count/);
  assert.match(migration, /enable row level security/i);
  const adminData = await readFile(new URL("../lib/admin-data.js", import.meta.url), "utf8");
  assert.match(adminData, /PROCESS_ALLIANCE_REGISTRATION_JOB/);
  assert.match(adminData, /status='queued'/);
  assert.match(adminData, /registerPlayer/);
});
