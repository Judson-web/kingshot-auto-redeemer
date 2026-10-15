import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");
const checks=[];

function assertCheck(name,condition,detail=""){
 checks.push({name,ok:Boolean(condition),detail});
}

const vercelConfig=JSON.parse(read("vercel.json"));
const configuredHeaders=vercelConfig.headers?.flatMap(rule=>rule.headers||[])||[];
const cspHeader=configuredHeaders.find(header=>header.key.toLowerCase()==="content-security-policy");
assertCheck("Deployment defines a baseline Content Security Policy", Boolean(cspHeader));
if(cspHeader){
 assertCheck("CSP limits outbound connections to first-party and required service origins",
  cspHeader.value.includes("connect-src 'self' https://*.supabase.co wss://*.supabase.co https://discord.com https://discordapp.com") &&
  !cspHeader.value.includes("connect-src 'self' https: wss:"));
}
if(cspHeader){
 const csp=cspHeader.value;
 for(const directive of ["default-src 'self'","base-uri 'self'","object-src 'none'","frame-ancestors 'none'","form-action 'self'","script-src 'self'","style-src 'self'","connect-src 'self'","worker-src 'self'","upgrade-insecure-requests"]){
  assertCheck(`CSP includes ${directive}`, csp.includes(directive));
 }
}

const auto=read("api/kingshot-auto.js");
const worker=read("internal/kingshot/worker.ts");
const workerCode=auto+"\n"+worker;
const register=read("internal/kingshot/register.ts");
const registerHandler=read("api/kingshot-register.ts");
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


const redemptionHistory=read("internal/kingshot/redemption-history.ts");
assertCheck(
 "Worker keeps handled redemption statuses centralized and tested",
 redemptionHistory.includes("HANDLED_REDEMPTION_STATUSES") &&
 redemptionHistory.includes('"STOVE_LV ERROR"') &&
 redemptionHistory.includes('"USER INFO ERROR"') &&
 fs.existsSync(path.join(root,"tests","redemption-history.test.js"))
);
assertCheck(
 "Worker processes only the newest outstanding code per player",
 auto.includes("newest outstanding code for each player per run") &&
 auto.includes("selectNextOutstandingCode(codes,handled)") &&
 redemptionHistory.includes("selectNextOutstandingCode")
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
 auto.includes("const PLAYER_CONCURRENCY=2;") &&
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
 auto.includes("activeCodes=codes.filter(item=>{") && auto.includes("!sourceExpired&&!expiredCodes.has(item.code.toUpperCase())")
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
 support.includes("process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY"));
assertCheck("Worker has scheduler/authorization guard",
 /X-Kingshot-Scheduler-Token|KINGSHOT_SCHEDULER_TOKEN|scheduler/i.test(auto));
assertCheck("Registration has request rate limiting",
 /rateLimit\(req,\s*res,\s*"register",\s*60,\s*60000\)/.test(registerHandler));
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

const developerApi = read("lib/developer-api.ts");
const developerRouter = read("api/kingshot-tools/[...path].js");
const playerFunction = read("api/kingshot-player.ts");
const developerUi = read("src/DeveloperApp.tsx");
const developerAccountUi = read("src/DeveloperAccountPanel.tsx");
const developerAuth = read("lib/developer-auth.ts");
const authProfileTriggerMigration = read("supabase/migrations/20261015120000_fix_auth_profile_trigger_permissions.sql");
const developerAccountApi = read("lib/developer-account.ts");
const accountMigration = read("supabase/migrations/20261014105114_developer_email_accounts.sql");
const developerMigration = read("supabase/migrations/20261014091531_developer_api_v2.sql");
assertCheck("Developer API is routed through an existing serverless function", playerFunction.includes('import developerApi from "../lib/developer-api.js"') && playerFunction.includes("if (developerPath) return developerApi(req, res, developerPath)") && !fs.existsSync(path.join(root, "api", "v1", "player.ts")));
assertCheck("Developer keys are generated with cryptographic randomness and stored hashed", developerApi.includes("randomBytes(32)") && developerApi.includes("sha256(secret)") && !developerApi.includes("key_plain"));
assertCheck("Legacy developer endpoints remain admin-session protected", developerApi.includes("kingshot_developer_list_keys") && developerApi.includes("kingshot_developer_create_key") && developerApi.includes("kingshot_developer_revoke_key"));
assertCheck("Discord OAuth is verified server-side before creating developer sessions", developerAuth.includes('action==="oauth"') && developerAuth.includes('/auth/v1/user') && developerAuth.includes('provider!=="discord"') && developerAuth.includes("OWNER_DISCORD_ID") && developerAuth.includes("kingshot_developer_account_session_create"));
assertCheck("Auth profile trigger uses a pinned security-definer function and blocks direct app-role execution", authProfileTriggerMigration.includes("SECURITY DEFINER") && authProfileTriggerMigration.includes("SET search_path = pg_catalog") && authProfileTriggerMigration.includes("REVOKE ALL ON FUNCTION public.handle_new_user()"));
assertCheck("Developer accounts keep isolated API-key ownership", developerAccountApi.includes("kingshot_developer_account_create_key") && accountMigration.includes("owner_user_id") && accountMigration.includes("p_session_hash"));
assertCheck("Developer account sessions use secure HttpOnly cookies", developerAuth.includes("HttpOnly; Secure; SameSite=Strict") && developerAuth.includes("randomBytes(32)"));
assertCheck("Account dashboard uses Discord-only OAuth and key management", developerAccountUi.includes("Continue with Discord") && !developerAccountUi.includes("Continue with GitHub") && !developerAccountUi.includes("signup") && developerAccountUi.includes('action:"oauth"') && developerAccountUi.includes("Create API key") && developerAccountUi.includes("Revoke"));
assertCheck("Developer account shows an animated session-check state and explicit clipboard feedback", developerAccountUi.includes("Checking your sign-in…") && developerAccountUi.includes("developer-auth-spinner") && developerAccountUi.includes("API key copied to clipboard.") && developerAccountUi.includes('copied?"Copied!":"Copy key"') && developerAccountUi.includes("Clipboard access is unavailable"));
assertCheck("Developer API has a database-backed per-IP issuance cap and quotas", developerMigration.includes("lifetime limit of two API keys") && developerMigration.includes("kingshot_developer_authorize_key") && developerMigration.includes("request_count"));
assertCheck("Developer portal route and API v1 rewrites are connected", vercelConfig.rewrites.some(item => item.source === "/developer" && item.destination === "/index.html") && vercelConfig.rewrites.some(item => item.source === "/api/v1/player" && item.destination === "/api/kingshot-player?developer=player") && developerUi.includes("/api/v1/player?id="));
assertCheck("Developer portal uses a responsive SaaS dashboard layout with account and documentation sections", developerUi.includes("Developer dashboard") && developerUi.includes("dev-layout") && developerUi.includes("dev-stat-grid") && developerUi.includes('id="quickstart"') && developerUi.includes('id="api-reference"') && developerUi.includes("@media(max-width:760px)"));
assertCheck("Developer documentation accurately describes Discord-managed API key lifecycle", developerUi.includes("Sign in with Discord to create and manage your own API keys") && !developerUi.includes("Sign in with GitHub to create and manage your own API keys") && !developerUi.includes("self-service key creation and a customer key-management dashboard are intentionally not available"));
assertCheck("Account auth and key APIs share the existing player serverless function", playerFunction.includes("developerAuth(req, res)") && playerFunction.includes("developerAccount(req, res)") && !fs.existsSync(path.join(root, "api", "developer-auth.ts")) && !fs.existsSync(path.join(root, "api", "developer-account.ts")));
assertCheck("Developer portal embeds account dashboard while keeping admin auth separate", developerUi.includes("DeveloperAccountPanel") && developerAccountUi.includes("/api/kingshot-player?developer=account-auth") && !developerAccountUi.includes("/api/kingshot-admin-login"));
assertCheck("Developer portal player lookup is admin-session protected", developerApi.includes('path === "admin-player"') && developerApi.includes('kingshot_developer_list_keys', developerApi.indexOf('path === "admin-player"')) && developerUi.includes("/api/v1/player?id="));

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
