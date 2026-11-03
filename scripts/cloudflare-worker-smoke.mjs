import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = Number(process.env.WORKER_SMOKE_PORT || 8787);
const baseUrl = (process.env.WORKER_PREVIEW_URL || `http://127.0.0.1:${port}`).replace(/\/$/, "");
const remote = Boolean(process.env.WORKER_PREVIEW_URL);
let child;

async function request(path, init) {
  const response = await fetch(baseUrl + path, { ...init, signal: AbortSignal.timeout(8000) });
  return response;
}

async function checkJson(path, expectedStatus, predicate, init) {
  const response = await request(path, init);
  assert.equal(response.status, expectedStatus, `${path}: unexpected HTTP status`);
  const contentType = response.headers.get("content-type") || "";
  assert.match(contentType, /application\/json/i, `${path}: expected JSON response`);
  const body = await response.json();
  assert.ok(predicate(body), `${path}: response contract mismatch: ${JSON.stringify(body)}`);
  console.log(`PASS ${init?.method || "GET"} ${path} -> ${response.status}`);
  return body;
}

async function waitForServer() {
  const deadline = Date.now() + 45_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`wrangler dev exited early (${child.exitCode})`);
    }
    try {
      const response = await fetch(baseUrl + "/site.webmanifest", { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Worker preview did not start: ${String(lastError || "startup timeout")}`);
}

try {
  if (!remote) {
    child = spawn("npx", ["--yes", "wrangler@4", "dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--config", "wrangler.jsonc"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk.toString(); });
    child.stderr.on("data", chunk => { output += chunk.toString(); });
    child.on("error", error => { output += String(error); });
    await waitForServer();
    console.log("Worker local runtime started.");
  }

  const root = await request("/");
  assert.equal(root.status, 200, "frontend root should be served by Worker Assets");
  console.log("PASS GET / -> 200");

  const manifestResponse = await request("/site.webmanifest");
  assert.equal(manifestResponse.status, 200, "PWA manifest should be served");
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, "standalone", "PWA manifest must retain standalone display");
  assert.equal(manifest.start_url, "/", "PWA manifest must retain root start URL");
  console.log("PASS GET /site.webmanifest -> 200 (PWA manifest)");

  await checkJson("/api/ops-tools/visitor", 200,
    body => body && (body.countryCode === null || /^[A-Z]{2}$/.test(body.countryCode)));

  await checkJson("/api/discord-avatar", 400,
    body => body?.code === "invalid_avatar_request");

  await checkJson("/api/discord-avatar", 405,
    body => body?.code === "method_not_allowed", { method: "POST" });

  await checkJson("/api/discord-user?id=invalid", 400,
    body => body?.code === "invalid_discord_user_id");

  if (remote) {
    const registration = await checkJson(
      "/api/kingshot-player?developerPath=alliance-lookup&mode=registration-status&ids=12345",
      200,
      body => body && Array.isArray(body.registeredIds) && body.registeredIds.every(id => typeof id === "string"),
    );
    assert.ok(registration.registeredIds.length <= 1, "registration status must only return requested IDs");
    const health = await request("/api/ops-tools/health");
    assert.ok([200, 503].includes(health.status), "health endpoint must return a documented health status");
    const healthBody = await health.json();
    assert.equal(typeof healthBody.healthy, "boolean", "health response must expose healthy boolean");
    console.log(`PASS GET /api/ops-tools/health -> ${health.status}`);
  } else {
    await checkJson("/api/kingshot-player?developerPath=alliance-lookup&mode=registration-status&ids=12345",
      503, body => body?.code === "registration_status_unavailable");
  }

  console.log(remote ? "Cloudflare deployed-preview smoke tests passed." : "Cloudflare Worker local smoke tests passed.");
} catch (error) {
  console.error(error);
  if (child) console.error("Wrangler output:\n" + (child.stdout ? "" : ""));
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 3000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
}
