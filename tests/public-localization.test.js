import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import en from "../src/shared/translations/en.js";
import ko from "../src/shared/translations/ko.js";

test("English and Korean dictionaries stay complete and key-aligned", () => {
  const enKeys = Object.keys(en).sort();
  const koKeys = Object.keys(ko).sort();
  assert.deepEqual(koKeys, enKeys);
  for (const key of enKeys) {
    assert.equal(typeof en[key], "string", `English translation for ${key} must be a string`);
    assert.equal(typeof ko[key], "string", `Korean translation for ${key} must be a string`);
    assert.ok(en[key].trim(), `English translation for ${key} must not be empty`);
    assert.ok(ko[key].trim(), `Korean translation for ${key} must not be empty`);
  }
});

test("public-facing secondary copy uses localized dictionary entries", async () => {
  const [developer, legal, support] = await Promise.all([
    readFile(new URL("../src/DeveloperApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/LegalApp.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/SupportWidget.tsx", import.meta.url), "utf8")
  ]);
  for (const key of [
    "developer.featureSummary", "developer.tagPlayerLookup", "developer.tagManualRedemption",
    "developer.tagAutoEnrollment", "developer.tagJsonResponses", "developer.tagBearerAuth",
    "developer.autoEnrollmentDescription", "developer.fieldDigits", "developer.fieldSafeCharacters",
    "developer.fieldKingdomId", "developer.maintainerAvatarLabel"
  ]) assert.ok(developer.includes(key), `Developer page should use ${key}`);
  assert.ok(legal.includes('t("legal.note"'), "Legal disclaimer should follow the selected language");
  assert.ok(support.includes('t("support.unreadRepliesAriaSuffix"'), "Unread reply accessibility text should be localized");
  assert.ok(support.includes('st("openConversation"'), "Support notification action should be localized");
  assert.ok(support.includes('st("ticketPrefix"'), "Support ticket notification prefix should be localized");
  assert.ok(!developer.includes("Enrolls a player in the existing scheduled auto-redeem workflow. One player per request."), "Developer enrollment copy must not remain hardcoded in JSX");
  assert.ok(!legal.includes('<p className="legal-note">This page is a plain-language'), "Legal disclaimer must not remain hardcoded in JSX");
});

test("developer metadata follows language changes and copy buttons retain translated labels", async () => {
  const developer = await readFile(new URL("../src/DeveloperApp.tsx", import.meta.url), "utf8");
  assert.match(developer, /const \{ t, language \} = useSiteLanguage\(\)/);
  assert.match(developer, /t\("meta\.developerTitle"/);
  assert.match(developer, /t\("meta\.developerDescription"/);
  assert.match(developer, /\}, \[language\]\);/);
  assert.ok(developer.includes('label="Copy example"'), "CopyButton owns the translated display label");
  assert.ok(developer.includes('label="Copy path"'), "CopyButton owns the translated display label");
  const main = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  assert.ok(main.includes('placeholder={t("manual.playerIdPlaceholder"'), "Manual Player ID example should be localized");
  assert.ok(main.includes('placeholder={t("manual.giftCodePlaceholder"'), "Manual gift-code example should be localized");
  assert.ok(main.includes('placeholder={t("auto.playerIdsPlaceholder"'), "Auto registration example should be localized");
});
