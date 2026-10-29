import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const worker=await readFile(new URL("../internal/kingshot/alliance-sync-worker.ts",import.meta.url),"utf8");
const scheduler=await readFile(new URL("../.github/workflows/alliance-sync-scheduler.yml",import.meta.url),"utf8");
const adminData=await readFile(new URL("../lib/admin-data.js",import.meta.url),"utf8");
const ui=await readFile(new URL("../src/AdminAllianceSyncApp.tsx",import.meta.url),"utf8");
const migration=await readFile(new URL("../supabase/migrations/20261029150000_move_manual_alliance_registration_queue_to_supabase.sql",import.meta.url),"utf8");

test("durable queue runs through the existing cron-authenticated worker route",()=>{
 assert.match(worker,/JOB_SECRET=process.env.ALLIANCE_SYNC_CRON_SECRET/);
 assert.match(worker,/processManualRegistrationJobs/);
 assert.match(scheduler,/kingshot-alliance-sync-worker\?mode=manual-registration/);
 assert.match(scheduler,/Drain durable manual registration queue/);
});

test("durable queue uses Supabase atomic claims and persists per-player progress",()=>{
 assert.match(worker,/rpc\/claim_alliance_manual_registration_job/);
 assert.match(worker,/rpc\/record_alliance_manual_registration_result/);
 assert.match(worker,/loadRoster\(String\(job\.kingdom_id\),String\(job\.alliance_tag\)\)/);
 assert.match(worker,/ids\.slice\(offset,offset\+5\)/);
 assert.match(migration,/for update skip locked/);
 assert.match(migration,/alliance_manual_registration_one_active_per_config/);
 assert.match(migration,/enable row level security/);
 assert.match(migration,/grant execute on function public\.claim_alliance_manual_registration_job\(\) to service_role/);
});

test("admin queue reads and writes Supabase while normal alliance sync stays separate",()=>{
 assert.match(adminData,/storage:"supabase"/);
 assert.match(adminData,/alliance_manual_registration_jobs/);
 assert.doesNotMatch(adminData,/select \\* from public\\.alliance_manual_registration_jobs/);
 assert.match(ui,/serverSideRegistration\]=useState\(false\)/);
 assert.match(ui,/ADMIN_REGISTER_ALLIANCE_MEMBER/);
 assert.match(ui,/ADMIN_REGISTER_ALLIANCE_MEMBERS/);
 assert.match(ui,/Browser-driven: registers selected players one at a time/);
 assert.match(ui,/scheduled worker continues when this page is closed/);
});
