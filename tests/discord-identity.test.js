import assert from "node:assert/strict";
import test from "node:test";
import { isDiscordOwner, verifiedDiscordId } from "../lib/discord-identity.js";
const ownerId = "871756466900598815";

test("owner check accepts verified Discord identity and configured owner ID", () => {
  const user = { app_metadata: { providers: ["discord"] }, identities: [{ provider: "discord", identity_data: { provider_id: ownerId } }] };
  assert.equal(verifiedDiscordId(user), ownerId);
  assert.equal(isDiscordOwner(user, ownerId), true);
});

test("owner check rejects an ID present only in editable user metadata", () => {
  const user = { app_metadata: { providers: ["discord"] }, user_metadata: { provider_id: ownerId, sub: ownerId, id: ownerId }, identities: [{ provider: "discord", identity_data: { provider_id: "999999999999999999" } }] };
  assert.equal(isDiscordOwner(user, ownerId), false);
});

test("owner check rejects missing or non-Discord provider identities", () => {
  assert.equal(isDiscordOwner({ user_metadata: { id: ownerId } }, ownerId), false);
  assert.equal(isDiscordOwner({ app_metadata: { providers: ["github"] } }, ownerId), false);
  assert.equal(isDiscordOwner({ identities: [{ provider: "discord", identity_data: { id: "someone-else" } }] }, ownerId), false);
});
