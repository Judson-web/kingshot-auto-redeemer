import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEVELOPER_ATTRIBUTION, withDevMetadata } from "../lib/developer-contact.js";

test("developer attribution is public contact metadata only", () => {
  assert.deepEqual(DEVELOPER_ATTRIBUTION, { name: "Judson", discord: "@judson00713", url: "https://discord.com/users/871756466900598815" });
});

test("withDevMetadata adds a top-level dev object without changing endpoint data", () => {
  const source = { data: { ok: true, status: "SUCCESS" }, meta: { requestId: "test-id" } };
  const result = withDevMetadata(source);
  assert.deepEqual(result.data, source.data);
  assert.deepEqual(result.meta, source.meta);
  assert.deepEqual(result.dev, DEVELOPER_ATTRIBUTION);
  assert.equal(withDevMetadata(null), null);
  assert.equal(withDevMetadata([]).length, 0);
});

test("V3, legacy, enrollment and public redemption routes expose dev metadata", async () => {
  const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
  const [http, player, redemption, legacy, registration, publicRedemption] = await Promise.all([
    read("../lib/api-v3/http.ts"), read("../lib/api-v3/player-handler.ts"), read("../lib/api-v3/redemption-handler.ts"),
    read("../lib/developer-api.ts"), read("../api/kingshot-register.ts"), read("../api/kingshot-redeem.js")
  ]);
  assert.match(http, /json\(withDevMetadata\(/);
  assert.match(player, /json\(withDevMetadata\(/);
  assert.match(redemption, /withDevMetadata\(c\.response_body\)/);
  assert.match(redemption, /json\(responseBody\)/);
  assert.match(legacy, /attachDevMetadata\(res\)/);
  assert.match(registration, /attachDevMetadata\(res\)/);
  assert.match(publicRedemption, /attachDevMetadata\(res\)/);
});

test("OpenAPI declares dev on strict V3 response contracts and legacy lookup", async () => {
  const text = await readFile(new URL("../public/openapi.json", import.meta.url), "utf8");
  const spec = JSON.parse(text);
  assert.equal(spec.info.contact.url, DEVELOPER_ATTRIBUTION.url);
  for (const name of ["ApiV3ErrorResponse", "ApiV3PlayerResponse", "ApiV3RedemptionResponse", "PlayerLookupResponse"]) {
    assert.ok(spec.components.schemas[name].required.includes("dev"), name + " requires dev");
    assert.equal(spec.components.schemas[name].properties.dev.$ref, "#/components/schemas/DeveloperAttribution");
  }
});

test("maintainer card uses the live Discord PFP and administrator frame", async () => {
  const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
  const [page, styles] = await Promise.all([read("../src/DeveloperApp.tsx"), read("../src/developer-redesign.css")]);
  assert.match(page, /api\/discord-user\?id=/);
  assert.match(page, /api\/discord-avatar\?id=/);
  assert.match(page, /site-account-admin/);
  assert.match(page, /site-account-role-mark/);
  assert.match(page, /Open Discord profile/);
  assert.match(page, /does not sign you in or create an account/);
  assert.match(styles, /dev-maintainer-avatar \.site-account-avatar-frame/);
  assert.match(styles, /\.dev-maintainer-actions a\.dev-maintainer-discord:not\(\.dev-nav-link\)/);
  assert.match(styles, /\.dev-maintainer-actions a\.dev-maintainer-discord:not\(\.dev-nav-link\) > svg/);
  assert.match(styles, /stroke: #20180b !important/);
  const profile = await read("../src/ProfileApp.tsx");
  const profileStyles = await read("../src/profile-redesign.css");
  assert.match(profile, /profile-login-purpose/);
  assert.match(profile, /profile-developer-contact/);
  assert.match(profileStyles, /\.profile-developer-contact/);
});
