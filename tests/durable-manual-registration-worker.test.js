import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const worker=await readFile(new URL("../internal/kingshot/alliance-sync-worker.ts",import.meta.url),"utf8");
const scheduler=await readFile(new URL("../.github/workflows/alliance-sync-scheduler.yml",import.meta.url),"utf8");
const adminData=await readFile(new URL("../lib/admin-data.js",import.meta.url),"utf8");
const ui=await readFile(new URL("../src/AdminAllianceSyncApp.tsx",import.meta.url),"utf8");

test("durable queue runs through the existing cron-authenticated worker route",()=>{
 assert.match(worker,/JOB_SECRET=process.env.ALLIANCE_SYNC_CRON_SECRET/);
 assert.match(worker,/processManualRegistrationJobs/);
 assert.match(scheduler,/kingshot-alliance-sync-worker\?mode=manual-registration/);
 assert.match(scheduler,/api\\/kingshot-alliance-sync-worker\\?mode=manual-registration/);
 assert.match(scheduler,/Drain durable manual registration queue/);
});

test("durable queue uses compare-and-swap claims, fresh roster checks, and persisted per-player progress",()=>{
 assert.match(worker,/updated_at=\$\{candidate\.updated_at\}::timestamptz/);
 assert.match(worker,/updated_at<now\(\)-interval '120 seconds'/);
 assert.match(worker,/status='queued'/);
 assert.match(worker,/loadRoster\(String\(job\.kingdom_id\),String\(job\.alliance_tag\)\)/);
 assert.match(worker,/processed_count=processed_count\+1/);
 assert.match(worker,/results=coalesce\(results,'\[\]'::jsonb\)\|\|/);
 assert.match(worker,/ids\.slice\(offset,offset\+5\)/);
});

test("browser-driven registration remains available and is still the default",()=>{
 assert.match(adminData,/updated_at<now\(\)-interval '120 seconds'/);
 assert.match(ui,/serverSideRegistration=false/);
 assert.match(ui,/ADMIN_REGISTER_ALLIANCE_MEMBER/);
 assert.match(ui,/ADMIN_REGISTER_ALLIANCE_MEMBERS/);
 assert.match(ui,/Browser-driven: registers selected players one at a time/);
 assert.match(ui,/scheduled worker continues when this page is closed/);
});
