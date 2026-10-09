import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");
const checks=[];

function assertCheck(name,condition,detail=""){
 checks.push({name,ok:Boolean(condition),detail});
}

const auto=read("api/kingshot-auto.ts");
const worker=read("internal/kingshot/worker.ts");
const workerCode=auto+"\n"+worker;
const register=read("internal/kingshot/register.ts");
const registerHandler=read("api/kingshot-register.ts");
const support=read("lib/support.ts");
const adminData=read("lib/admin-data.ts");
const adminDataRoute=read("api/admin-tools/data.ts");
const adminLogin=read("api/admin-tools/login.ts");
const customMessage=read("api/custom-message.ts");
const mainApp=read("src/main.tsx");
const discordInteractions=read("lib/discord-interactions.ts");
const health=read("lib/health.ts");
const logs=read("lib/health.ts");

assertCheck("Logs API is GET-only and server-side",
 logs.includes('if(req.method!=="GET")') &&
 logs.includes("SUPABASE_SERVICE_ROLE_KEY") &&
 !logs.includes("SUPABASE_ANON_KEY"));
assertCheck("Logs API returns sanitized operational data only",
 logs.includes("safeWorker") &&
 logs.includes("safeScraper") &&
 logs.includes("redemptionFailures:Array.isArray(summary.redemptionFailures)") &&
 !logs.includes("player_id"));


assertCheck(
 "Worker keeps the handled-status terminal set",
 auto.includes('const HANDLED_STATUSES=new Set(["SUCCESS","RECEIVED","SAME TYPE EXCHANGE","TIME_ERROR","CDK_NOT_FOUND","USAGE_LIMIT"]);')
);
assertCheck(
 "Worker processes only the newest outstanding code per player",
 auto.includes("newest outstanding code for each player per run") &&
 auto.includes("const item=codes.find(code=>!handled.has(code.code.toUpperCase()));")
);
assertCheck(
 "Worker pool fans redemption work across three internal shards",
 auto.includes("const WORKER_COUNT=3;") &&
 workerCode.includes("runWorkerShard") &&
 auto.includes("Promise.all(assignments.map")
);
assertCheck(
 "Worker shards use durable per-slot claims",
 workerCode.includes("claim_kingshot_worker_slot") &&
 workerCode.includes("finish_kingshot_worker_slot") &&
 workerCode.includes("maxRuntimeMs")
);
assertCheck(
 "Worker shard endpoint requires internal authorization",
 auto.includes('if(mode==="worker")') &&
 auto.includes('if(!workerAuthorized)return res.status(401).json({error:"Unauthorized"});')
);
assertCheck(
 "Worker pool preserves bounded per-shard concurrency",
 auto.includes("const PLAYER_CONCURRENCY=6;") &&
 workerCode.includes("runWithConcurrency(assigned, player => redeemForPlayer(player, codes), options.concurrency, { deadline })") &&
 auto.includes("WORKER_MAX_RUNTIME_MS=4*60*1000")
);
assertCheck(
 "Worker heartbeat keeps long cycles observable",
 auto.includes('heartbeat_kingshot_worker_run') &&
 auto.includes('workerToken')
);
assertCheck(
 "Worker summaries include per-code handling diagnostics",
 workerCode.includes("handledCodeCounts") &&
 workerCode.includes("codeCounts") &&
 auto.includes("redemptionCode:item.code")
);
assertCheck(
 "Worker summaries include runtime and scraper health",
 auto.includes("cycleDurationMs") &&
 auto.includes("sourceHealth") &&
 auto.includes("sourceHealthPct")
);
assertCheck(
 "Worker summaries include redemption speed telemetry",
 auto.includes("redemptionTelemetry") &&
 auto.includes("codeTelemetry") &&
 auto.includes("firstResultLatencyMs") &&
 auto.includes("avgRedemptionLatencyMs") &&
 auto.includes("first_seen_at")
);
assertCheck(
 "Worker has anomaly detection for unhealthy cycles",
 auto.includes("anomalyReasons") &&
 auto.includes("over 30% of players failed validation") &&
 auto.includes("scraper source health below 50%")
);
assertCheck(
 "Global expired-code lookup fails open instead of crashing the worker",
 auto.includes('list_kingshot_expired_gift_codes",{}).catch(error=>')
);
assertCheck(
 "Expired codes are filtered before redemption",
 auto.includes("const activeCodes=codes.filter(item=>{") && auto.includes("!sourceExpired&&!expiredCodes.has(item.code.toUpperCase())")
);
assertCheck(
 "Worker health endpoint uses a server-only Supabase credential",
 health.includes("process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY")
);
assertCheck(
 "Worker health endpoint rejects stale worker state",
 health.includes('state.last_status==="COMPLETED"||state.last_status==="RUNNING"') &&
 health.includes("ageMs<=12*60*1000")
);

assertCheck("Worker uses server-only Supabase credential",
 auto.includes("process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY"));
assertCheck("Registration uses server-only Supabase credential",
 /process\.env\.SUPABASE_SERVICE_ROLE_KEY\s*\|\|\s*process\.env\.SUPABASE_SECRET_KEY/.test(register));
assertCheck("Support uses server-only Supabase credential",
 /process\.env\.SUPABASE_SERVICE_ROLE_KEY\s*\|\|\s*process\.env\.SUPABASE_SECRET_KEY/.test(support));
assertCheck("Worker has scheduler/authorization guard",
 /X-Kingshot-Scheduler-Token|KINGSHOT_SCHEDULER_TOKEN|scheduler/i.test(auto));
assertCheck("Registration has request rate limiting",
 /rateLimit\(req,\s*res,\s*"register",\s*60,\s*60000\)/.test(registerHandler));
assertCheck("Support has request rate limiting",
 /rateLimit\(req,\s*res,\s*"support",\s*6,\s*60000\)/.test(support));
assertCheck("Admin login has request rate limiting",
 /rateLimit\(req,\s*res,\s*"admin-login",\s*5,\s*900000\)/.test(adminLogin));
assertCheck("Admin data is an isolated TypeScript API entrypoint",
 adminDataRoute.includes('from "../../lib/admin-data.ts"') &&
 !fs.existsSync(path.join(root,"api","admin-tools","[...path].ts")) &&
 !fs.existsSync(path.join(root,"api","admin-tools","[...path].js")));
assertCheck("Admin login is a direct TypeScript API entrypoint without runtime TypeScript imports",
 adminLogin.includes('from "../../lib/request-rate-limit.ts"') &&
 !adminLogin.includes('from "../../lib/admin-login.ts"'));
assertCheck("Admin data validates an admin session before privileged work",
 adminData.includes("kingshot_admin_validate_session"));
assertCheck("Maintenance gate escapes infinite preflight after bounded status failures",
 mainApp.includes("MAX_CONSECUTIVE_STATUS_FAILURES=3") &&
 mainApp.includes("consecutiveFailures>=MAX_CONSECUTIVE_STATUS_FAILURES") &&
 mainApp.includes("maintenanceEnabled:false"));
assertCheck("Malformed admin cookies cannot break logout or authentication checks",
 adminLogin.includes("Ignore malformed client cookies") &&
 adminData.includes("try{return decodeURIComponent(part.slice(name.length+1))}catch{return\"\"}"));

assertCheck(
 "Malformed custom-message session cookies fail closed instead of throwing",
 customMessage.includes("try{value=decodeURIComponent(raw.slice(COOKIE.length+1))}catch{return false}")
);
assertCheck("Admin player listing passes a session token hash",
 adminData.includes('rpc("kingshot_admin_list_players",{p_token_hash:tokenHash})'));
assertCheck("Admin session cookie is HttpOnly/Secure/Strict",
 adminLogin.includes("HttpOnly; Secure; SameSite=Strict"));
assertCheck("Admin login uses a cryptographically random session token",
 adminLogin.includes("randomBytes(32)"));
assertCheck("Admin access-key path delegates verification to the key RPC",
 adminLogin.includes("kingshot_admin_create_session_with_key") &&
 !adminLogin.includes('"kingshot_admin_create_session"'));

assertCheck("Discord interaction handler does not embed a Supabase publishable key",
 !/sb_publishable_[A-Za-z0-9_-]+/.test(discordInteractions));

assertCheck(
 "Discord interactions reject stale signed requests to limit replay",
 discordInteractions.includes("MAX_TIMESTAMP_AGE_SECONDS = 5 * 60") &&
 discordInteractions.includes("isFreshTimestamp(timestamp)")
);
assertCheck(
 "Discord interaction bodies are size-limited before JSON parsing",
 discordInteractions.includes("MAX_BODY_BYTES = 1_000_000") &&
 discordInteractions.includes("RequestBodyTooLargeError") &&
 discordInteractions.includes("status(413)")
);
assertCheck(
 "Discord registration callback uses a configured HTTPS origin instead of forwarded host headers",
 discordInteractions.includes("APP_BASE_URL") &&
 discordInteractions.includes('target.protocol !== "https:"') &&
 !discordInteractions.includes("x-forwarded-host") &&
 !discordInteractions.includes("x-forwarded-proto")
);
assertCheck(
 "Discord interaction command handlers avoid untyped any",
 !/\\bany\\b/.test(discordInteractions)
);

const migrationDir=path.join(root,"supabase","migrations");
const migrations=fs.existsSync(migrationDir)
 ? fs.readdirSync(migrationDir)
   .filter(name=>name.endsWith(".sql"))
   .sort()
   .map(name=>read(path.join("supabase","migrations",name)))
   .join("\n")
 : "";

assertCheck(
 "Zero-argument admin player RPC is revoked from public roles",
 /revoke all on function public\.kingshot_admin_list_players\(\) from public, anon, authenticated/i.test(migrations)
);
assertCheck(
 "Support RPC is revoked from public roles",
 /revoke all on function public\.submit_kingshot_support_ticket\(text,text\) from public, anon, authenticated/i.test(migrations)
);
assertCheck(
 "Registration RPC is revoked from public roles",
 /revoke all on function public\.register_kingshot_player_v2\(text,text,text,text\) from public, anon, authenticated/i.test(migrations)
);
assertCheck(
 "Worker claim RPC is revoked from public roles",
 /revoke all on function public\.claim_kingshot_worker_run\(\) from public, anon, authenticated/i.test(migrations)
);
assertCheck(
 "Worker pool claim RPC is revoked from public roles",
 /revoke all on function public\.claim_kingshot_worker_slot\(integer\) from public, anon, authenticated/i.test(migrations)
);
assertCheck(
 "Worker pool finish RPC is revoked from public roles",
 /revoke all on function public\.finish_kingshot_worker_slot\(integer,uuid,text,text,jsonb\) from public, anon, authenticated/i.test(migrations)
);
assertCheck(
 "Admin SECURITY DEFINER RPCs are revoked from public roles",
 migrations.includes("revoke all on function public.kingshot_admin_upsert_announcement")
);
assertCheck(
 "pg_net relocation is reproducible in migrations",
 /drop extension if exists pg_net/i.test(migrations) &&
 /create extension pg_net schema extensions/i.test(migrations)
);

const failed=checks.filter(item=>!item.ok);
for(const item of checks){
 console.log(`${item.ok?"PASS":"FAIL"}  ${item.name}${item.detail?": "+item.detail:""}`);
}
if(failed.length){
 console.error(`\nSecurity regression checks failed: ${failed.length}/${checks.length}`);
 process.exit(1);
}
console.log(`\nSecurity regression checks passed: ${checks.length}/${checks.length}`);
