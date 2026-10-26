import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const baseUrl = (process.env.UI_TEST_BASE_URL || "http://127.0.0.1:4173").replace(/\/+$/, "");
const moduleRoot = process.env.UI_TEST_MODULES;
if (!moduleRoot) {
  console.error("UI_TEST_MODULES is required. See docs/ui-regression.md for the pinned browser-test tool setup.");
  process.exit(2);
}

const { chromium } = await import(pathToFileURL(path.join(moduleRoot, "playwright", "index.mjs")).href);
const pixelmatchModule = await import(pathToFileURL(path.join(moduleRoot, "pixelmatch", "index.js")).href);
const pixelmatch = pixelmatchModule.default || pixelmatchModule;
const requireFromTools = createRequire(path.join(moduleRoot, "playwright", "package.json"));
const { PNG } = requireFromTools("pngjs");
const axeSource = fs.readFileSync(path.join(moduleRoot, "axe-core", "axe.min.js"), "utf8");

const snapshotDir = path.join(root, "tests", "visual", "snapshots");
const artifactDir = path.join(root, "test-results", "ui-regression");
fs.mkdirSync(artifactDir, { recursive: true });

const scenarios = [
  { name: "home-mobile", path: "/", heading: /automatic redemption/i, maxDiffRatio: 0.04 },
  { name: "support-open-mobile", path: "/", heading: /automatic redemption/i, supportOpen: true, maxDiffRatio: 0.045 },
  { name: "profile-anonymous-mobile", path: "/profile", heading: /^sign in$/i, visibleText: /continue with discord/i, maxDiffRatio: 0.04 },
  { name: "developer-anonymous-mobile", path: "/developer", heading: /developer api documentation/i, visibleText: /continue with discord/i, maxDiffRatio: 0.04 },
  { name: "admin-players-denied-mobile", path: "/admin/players", heading: /player database/i, visibleText: /sign in to view player data/i, waitFor: ".ap-access-card", maxDiffRatio: 0.04 }
];

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const failures = [];
const report = {
  baseUrl,
  viewport: { width: 393, height: 852, deviceScaleFactor: 1 },
  axeTags: wcagTags,
  scenarios: [],
  generatedAt: new Date().toISOString()
};

function fail(message) {
  failures.push(message);
  console.error("FAIL  " + message);
}

function pass(message) {
  console.log("PASS  " + message);
}

function publicFixtureResponse(url, request) {
  const method = request.method();
  const pathname = url.pathname;
  const query = url.searchParams;
  if (pathname === "/api/kingshot-admin-data") {
    if (query.get("public") === "maintenance") {
      return { status: 200, body: { maintenanceEnabled: false, message: "", endsAt: null, updatedAt: "2026-10-26T00:00:00.000Z" } };
    }
    if (query.get("public") === "announcements") return { status: 200, body: { announcements: [] } };
    return { status: 401, body: { error: "Administrator access required." } };
  }
  if (pathname === "/api/kingshot-health") {
    return { status: 200, body: { healthy: true, status: "COMPLETED", lastCompletedAt: "2026-10-26T13:30:00.000Z", locked: false } };
  }
  if (pathname === "/api/kingshot-player") {
    const developerRoute = query.get("developer");
    let action = "";
    try { action = request.postDataJSON()?.action || ""; } catch {}
    if (developerRoute === "account-keys") return { status: 200, body: { keys: [] } };
    if (developerRoute === "account-auth") {
      if (action === "dev-check") return { status: 200, body: { authenticated: false } };
      if (action === "profile-check") return { status: 200, body: { authenticated: false, role: "user", kind: "user" } };
      if (action === "profile-discord-url") return { status: 200, body: { url: "https://discord.com/oauth2/authorize?client_id=visual-test&response_type=code" } };
      if (method === "DELETE") return { status: 200, body: { ok: true } };
      return { status: 200, body: { authenticated: false, role: "guest", kind: "user" } };
    }
    return { status: 404, body: { error: "Player not found." } };
  }
  if (pathname === "/api/discord-user") {
    return { status: 200, body: { id: "871756466900598815", username: "judson00713", globalName: "Judson", avatar: null, avatarUrl: null, animated: false } };
  }
  if (pathname === "/api/ops-tools/visitor") return { status: 200, body: { ok: true } };
  if (pathname === "/api/kingshot-support" || pathname === "/api/ops-tools/support") {
    return { status: 200, body: { ok: true, tickets: [], messages: [], unread: 0 } };
  }
  if (pathname === "/api/custom-message") {
    return { status: 200, body: { ok: true, enabled: false, pushSupported: false, publicKey: null } };
  }
  return { status: 200, body: { ok: true } };
}

async function installFixtures(page) {
  await page.addInitScript(() => {
    try {
      sessionStorage.clear();
      localStorage.setItem("ks-install-dismissed", "1");
    } catch {}
  });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const fixture = publicFixtureResponse(url, route.request());
    await route.fulfill({
      status: fixture.status,
      contentType: "application/json; charset=utf-8",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify(fixture.body)
    });
  });
}

async function screenshotDiff(page, scenario) {
  const actualBuffer = await page.screenshot({ type: "png", animations: "disabled", fullPage: false });
  const baselinePath = path.join(snapshotDir, scenario.name + ".png");
  if (process.env.UI_UPDATE_SNAPSHOTS === "1") {
    fs.writeFileSync(baselinePath, actualBuffer);
    fs.writeFileSync(path.join(artifactDir, scenario.name + ".baseline.png"), actualBuffer);
    pass("updated visual baseline " + scenario.name);
    return { ratio: 0, changedPixels: 0, width: 393, height: 852, updated: true };
  }
  if (!fs.existsSync(baselinePath)) throw new Error("Missing baseline: " + baselinePath);

  const expected = PNG.sync.read(fs.readFileSync(baselinePath));
  const actual = PNG.sync.read(actualBuffer);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    fs.writeFileSync(path.join(artifactDir, scenario.name + ".actual.png"), actualBuffer);
    throw new Error("Screenshot dimensions changed for " + scenario.name + ": expected " + expected.width + "x" + expected.height + ", received " + actual.width + "x" + actual.height);
  }
  const diff = new PNG({ width: actual.width, height: actual.height });
  const changedPixels = pixelmatch(expected.data, actual.data, diff.data, actual.width, actual.height, {
    threshold: 0.16,
    includeAA: false,
    alpha: 0.5
  });
  const ratio = changedPixels / (actual.width * actual.height);
  if (ratio > scenario.maxDiffRatio) {
    fs.writeFileSync(path.join(artifactDir, scenario.name + ".actual.png"), actualBuffer);
    fs.writeFileSync(path.join(artifactDir, scenario.name + ".diff.png"), PNG.sync.write(diff));
    throw new Error("Visual difference for " + scenario.name + " is " + (ratio * 100).toFixed(2) + "%, above " + (scenario.maxDiffRatio * 100).toFixed(2) + "% (" + changedPixels + " changed pixels).");
  }
  pass("visual snapshot " + scenario.name + " (" + (ratio * 100).toFixed(2) + "% changed)");
  return { ratio, changedPixels, width: actual.width, height: actual.height, updated: false };
}

async function axeScan(page, scenario) {
  await page.addScriptTag({ path: path.join(moduleRoot, "axe-core", "axe.min.js") });
  const results = await page.evaluate(async tags => {
    const scanned = await window.axe.run(document, {
      runOnly: { type: "tag", values: tags }
    });
    return {
      violations: scanned.violations.map(item => ({
        id: item.id,
        impact: item.impact || "unknown",
        help: item.help,
        helpUrl: item.helpUrl,
        nodes: item.nodes.map(node => ({
          target: node.target,
          html: (node.html || "").slice(0, 500),
          summary: (node.failureSummary || "").slice(0, 400)
        })).slice(0, 12)
      })),
      passedRules: scanned.passes.length,
      incompleteRules: scanned.incomplete.length
    };
  }, wcagTags);

  const severe = results.violations.filter(item => item.impact === "critical" || item.impact === "serious");
  const warningCount = results.violations.length - severe.length;
  for (const issue of results.violations) {
    const targets = issue.nodes.map(node => node.target.join(" ")).join(", ");
    const message = issue.id + " [" + issue.impact + "]: " + issue.help + " (" + issue.nodes.length + " affected nodes; " + targets + ")";
    if (issue.impact === "critical" || issue.impact === "serious") {
      fail(scenario.name + " accessibility: " + message);
    } else {
      console.warn("WARN  " + scenario.name + " accessibility: " + message);
    }
  }
  if (severe.length === 0) pass("WCAG A/AA axe scan " + scenario.name + " (" + results.violations.length + " violations, " + results.passedRules + " rules passed)");
  return { ...results, severeViolationCount: severe.length, warningViolationCount: warningCount };
}

async function responsiveChecks(page, scenario) {
  const widths = [320, 360, 393, 768, 1280];
  const records = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: width <= 393 ? 852 : 900 });
    await page.waitForTimeout(80);
    const geometry = await page.evaluate(() => {
      const maxScroll = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
      const rect = element => {
        if (!element) return null;
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return null;
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
      };
      const prompt = rect(document.querySelector('aside[aria-label*="notification" i]'));
      const supportTrigger = rect(document.querySelector(".support-float-trigger"));
      const panel = rect(document.querySelector(".support-float-panel"));
      let overlayOverlap = false;
      if (prompt && supportTrigger) {
        overlayOverlap = Math.max(0, Math.min(prompt.right, supportTrigger.right) - Math.max(prompt.left, supportTrigger.left)) > 1 &&
          Math.max(0, Math.min(prompt.bottom, supportTrigger.bottom) - Math.max(prompt.top, supportTrigger.top)) > 1;
      }
      const supportPanelOverflow = Boolean(panel && (
        panel.left < -1 ||
        panel.right > innerWidth + 1 ||
        panel.width > innerWidth + 1
      ));
      return { viewportWidth: innerWidth, documentWidth: maxScroll, overlayOverlap, supportPanel: panel, supportPanelOverflow };
    });
    records.push(geometry);
    if (geometry.documentWidth > geometry.viewportWidth + 1) {
      fail(scenario.name + " has horizontal overflow at " + width + "px (document " + geometry.documentWidth + "px)");
    }
    if (geometry.overlayOverlap) {
      fail(scenario.name + " notification prompt overlaps the Support launcher at " + width + "px");
    }
    if (geometry.supportPanelOverflow) {
      fail(scenario.name + " Support panel exceeds the viewport at " + width + "px");
    }
  }
  if (!records.some(item => item.documentWidth > item.viewportWidth + 1 || item.overlayOverlap || item.supportPanelOverflow)) {
    pass("responsive layout " + scenario.name + " at 320, 360, 393, 768 and 1280px");
  }
  return records;
}

const browser = await chromium.launch({ headless: true });
try {
  for (const scenario of scenarios) {
    const result = { name: scenario.name, path: scenario.path, screenshot: null, accessibility: null, responsive: null, pageErrors: [] };
    const context = await browser.newContext({
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 1,
      colorScheme: "dark",
      reducedMotion: "reduce",
      serviceWorkers: "block"
    });
    const page = await context.newPage();
    page.on("pageerror", error => result.pageErrors.push(String(error.message || error)));
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Page.setBypassCSP", { enabled: true }).catch(() => {});
      await installFixtures(page);
      await page.goto(baseUrl + scenario.path, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.getByRole("heading", { level: 1 }).first().waitFor({ state: "visible", timeout: 15000 });
      if (scenario.waitFor) await page.locator(scenario.waitFor).waitFor({ state: "visible", timeout: 12000 });
      if (scenario.supportOpen) {
        await page.getByRole("button", { name: /Open support chat/i }).click({ timeout: 10000 });
        await page.locator(".support-float-panel").waitFor({ state: "visible", timeout: 8000 });
        await page.getByRole("heading", { name: "How can we help?" }).waitFor({ state: "visible", timeout: 8000 });
      }
      await page.waitForTimeout(850);
      const heading = (await page.getByRole("heading", { level: 1 }).first().innerText()).trim();
      if (!scenario.heading.test(heading)) {
        fail(scenario.name + " has unexpected H1 text: " + JSON.stringify(heading));
      } else {
        pass("expected heading on " + scenario.name);
      }
      if (scenario.visibleText && !await page.getByText(scenario.visibleText).first().isVisible().catch(() => false)) {
        fail(scenario.name + " did not render its expected account/access state");
      }
      if (scenario.supportOpen) {
        const topicTrigger = page.locator(".support-topic-trigger");
        result.supportPicker = await topicTrigger.evaluate(el => ({
          ariaLabel: el.getAttribute("aria-label"),
          labelledBy: el.getAttribute("aria-labelledby"),
          text: (el.innerText || "").trim(),
          visibleTopic: (el.querySelector("#support-topic-selected-value")?.textContent || "").trim(),
          textContent: (el.textContent || "").trim(),
          computedNameHint: el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") || "").split(/\s+/).map(id => document.getElementById(id)?.textContent || "").join(" ").trim()
        }));

        const visibleTopic = result.supportPicker.visibleTopic.replace(/\s+/g, " ").trim();
        const declaredName = (result.supportPicker.ariaLabel || result.supportPicker.computedNameHint || "").replace(/\s+/g, " ").trim();
        if (!visibleTopic) {
          fail("support topic picker has no visible selected topic");
        } else {
          const topicPattern = new RegExp(visibleTopic.replace(/[.*+?^${}()|[\]\\]/g, "\\        const visibleTopic = result.supportPicker.visibleTopic.replace(/\s+/g, " ").trim();
        const declaredName = (result.supportPicker.ariaLabel || result.supportPicker.computedNameHint || "").replace(/\s+/g, " ").trim();
        if (!visibleTopic) {
          fail("support topic picker has no visible selected topic");
        } else {
          const accessibleNameMatches = await page.getByRole("button", { name: visibleTopic, exact: true })
            .evaluateAll(elements => elements.some(el => el.matches(".support-topic-trigger")));
          if (!accessibleNameMatches) {
            fail("support topic picker accessible name does not match visible topic: " + JSON.stringify(visibleTopic));
          } else {
            pass("support topic picker accessible name matches visible topic");
          }
        }
        if (declaredName && visibleTopic && declaredName !== visibleTopic) {
          fail("support topic picker declared name differs from its visible topic: " + JSON.stringify(declaredName));
        }"), "i");
          const accessibleNameMatches = await page.getByRole("button", { name: topicPattern })
            .evaluateAll(elements => elements.some(el => el.matches(".support-topic-trigger")));
          if (!accessibleNameMatches) {
            fail("support topic picker accessible name does not contain the visible topic: " + JSON.stringify(visibleTopic));
          } else {
            pass("support topic picker accessible name contains the visible topic");
          }
        }
        const normalizedName = declaredName.toLowerCase();
        if (visibleTopic && (!normalizedName.includes(visibleTopic.toLowerCase()) || !normalizedName.includes("request category"))) {
          fail("support topic picker accessible name must include both the visible category label and selected topic: " + JSON.stringify(declaredName));
        }

        const dialogCount = await page.getByRole("dialog", { name: "Support centre", exact: true }).count();
        if (dialogCount !== 1) fail("support chat dialog does not expose the expected accessible name");

        const focusInside = await page.evaluate(() => {
          const panel = document.querySelector(".support-float-panel");
          return Boolean(panel && document.activeElement && panel.contains(document.activeElement));
        });
        if (!focusInside) fail("support dialog did not place focus inside the open panel");


      }

      result.screenshot = await screenshotDiff(page, scenario);
      result.accessibility = await axeScan(page, scenario);
      if (scenario.supportOpen) {
        const keyboardTrigger = page.locator(".support-topic-trigger");
        // Exercise the custom topic picker with the keyboard, not only with a mouse.
        await keyboardTrigger.focus();
        await page.keyboard.press("ArrowDown");
        const topicMenu = page.locator("#support-topic-options");
        await topicMenu.waitFor({ state: "visible", timeout: 3000 });
        let selectedOptionFocused = false;
        try {
          await page.waitForFunction(() => {
            const selected = document.querySelector('#support-topic-options [role="option"][aria-selected="true"]');
            return Boolean(selected && selected === document.activeElement);
          }, null, { timeout: 3000 });
          selectedOptionFocused = true;
        } catch {}
        if (!selectedOptionFocused) fail("opening the support topic picker with ArrowDown did not focus the selected option");
        await page.keyboard.press("Escape");
        await topicMenu.waitFor({ state: "hidden", timeout: 3000 });
        const focusReturned = await keyboardTrigger.evaluate(el => el === document.activeElement);
        if (!focusReturned) fail("Escape did not close the support topic picker and return focus to its trigger");
        else pass("support topic picker supports ArrowDown and Escape keyboard flow");
      }
      result.responsive = await responsiveChecks(page, scenario);
      if (result.pageErrors.length) {
        for (const error of result.pageErrors) fail(scenario.name + " JavaScript runtime error: " + error);
      } else {
        pass("no uncaught JavaScript errors on " + scenario.name);
      }
    } catch (error) {
      fail(scenario.name + " test could not complete: " + (error instanceof Error ? error.stack || error.message : String(error)));
    } finally {
      await context.close();
    }
    report.scenarios.push(result);
  }
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(artifactDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
if (failures.length) {
  console.error("\nUI regression suite failed: " + failures.length + " failure(s). See test-results/ui-regression/report.json and diff images.");
  process.exitCode = 1;
} else {
  console.log("\nUI regression suite passed: " + scenarios.length + " routes, WCAG A/AA scans, five responsive widths, and screenshot baselines.");
}
