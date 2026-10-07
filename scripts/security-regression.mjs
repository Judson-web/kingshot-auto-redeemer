import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");
const checks=[];

function assertCheck(name,condition,detail=""){
 checks.push({name,ok:Boolean(condition),detail});
}

const auto=read("api/kingshot-auto.js");
const register=read("internal/kingshot/register.js");
const support=read("lib/support.js");
const adminData=read("lib/admin-data.js");
const adminLogin=read("lib/admin-login.js");
const discordInteractions=read("lib/discord-interactions.js");
const health=read("lib/health.js");
const logs=read("lib/health.js");

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
 auto.includes("runWorkerShard") &&
 auto.includes("Promise.all(assignments.map")
);
assertCheck(
 "Worker shards use durable per-slot claims",
 auto.includes('rpc("claim_kingshot_worker_slot"') &&
 auto.includes('rpc("finish_kingshot_worker_slot"') &&
 auto.includes("WORKER_REQUEST_TIMEOUT_MS=4*60*1000")
);
assertCheck(
 "Worker shard endpoint requires internal authorization",
 auto.includes('if(mode==="worker")') &&
 auto.includes('if(!workerAuthorized)return res.status(401).json({error:"Unauthorized"});')
);
assertCheck(
 "Worker pool preserves bounded per-shard concurrency",
 auto.includes("const PLAYER_CONCURRENCY=6;") &&
 auto.includes("runWithConcurrency(assigned,p=>redeemForPlayer(p,codes),PLAYER_CONCURRENCY,{deadline})") &&
 auto.includes("WORKER_MAX_RUNTIME_MS=4*60*1000")
);
assertCheck(
 "Worker heartbeat keeps long cycles observable",
 auto.includes('heartbeat_kingshot_worker_run') &&
 auto.includes('workerToken')
);
assertCheck(
 "Worker summaries include per-code handling diagnostics",
 auto.includes("handledCodeCounts") &&
 auto.includes("codeCounts") &&
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
 register.includes("process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY"));
assertCheck("Support uses server-only Supabase credential",
 support.includes("process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY"));
assertCheck("Worker has scheduler/authorization guard",
 /X-Kingshot-Scheduler-Token|KINGSHOT_SCHEDULER_TOKEN|scheduler/i.test(auto));
assertCheck("Registration has request rate limiting",
 register.includes('rateLimit(req,res,"register",60,60000)'));
assertCheck("Support has request rate limiting",
 support.includes('rateLimit(req,res,"support",6,60000)'));
assertCheck("Admin login has request rate limiting",
 adminLogin.includes('rateLimit(req,res,"admin-login",5,900000)'));
assertCheck("Admin data validates an admin session before privileged work",
 adminData.includes("kingshot_admin_validate_session"));
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
