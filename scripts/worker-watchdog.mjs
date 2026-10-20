import { findStalledRecoveryQueue } from "../lib/recovery-queue-health.js";

const configuredUrl = process.env.KINGSHOT_HEALTH_URL || "https://kingshot-autoredeemer.vercel.app/api/kingshot-health";
const healthUrl = new URL(configuredUrl);
healthUrl.searchParams.delete("logs");

const response = await fetch(healthUrl, {
  headers: { accept: "application/json" },
  signal: AbortSignal.timeout(10000)
});
const body = await response.text();
console.log("Worker health HTTP " + response.status + ": " + body);

if (!response.ok) process.exit(1);

let healthData;
try {
  healthData = JSON.parse(body);
} catch {
  process.exit(1);
}
if (healthData?.healthy !== true) process.exit(1);

// The lightweight health route can be green while a result-write recovery item
// is stuck. Read its sanitized diagnostics separately and fail closed if that
// operational signal is unavailable.
const diagnosticsUrl = new URL(healthUrl);
diagnosticsUrl.searchParams.set("logs", "1");
const diagnosticsResponse = await fetch(diagnosticsUrl, {
  headers: { accept: "application/json" },
  signal: AbortSignal.timeout(20000)
});
if (!diagnosticsResponse.ok) {
  console.error("Worker recovery diagnostics HTTP " + diagnosticsResponse.status);
  process.exit(1);
}

let diagnostics;
try {
  diagnostics = await diagnosticsResponse.json();
} catch {
  console.error("Worker recovery diagnostics returned invalid JSON.");
  process.exit(1);
}

const queue = diagnostics?.recoveryQueue;
if (!diagnostics?.ok || !queue) {
  console.error("Worker recovery queue diagnostics are missing.");
  process.exit(1);
}

console.log("Redemption recovery queue:", JSON.stringify({
  pendingRecord: queue.pendingRecord?.count,
  pendingRecordOldestAgeSeconds: queue.pendingRecord?.oldestAgeSeconds,
  inFlight: queue.inFlight?.count,
  inFlightOldestAgeSeconds: queue.inFlight?.oldestAgeSeconds,
  needsReview: queue.needsReview?.count,
  unresolved: queue.unresolved
}));

const issues = findStalledRecoveryQueue(queue);
if (issues.length) {
  for (const issue of issues) console.error("Worker recovery watchdog:", issue);
  process.exit(1);
}
