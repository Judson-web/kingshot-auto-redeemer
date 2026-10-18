import test from "node:test";
import assert from "node:assert/strict";
import { extractMightPulseAvatarFrame, extractMightPulseAvatarFrameFromPlayerData, resolveMightPulseProfileUid, validateFrameAssetId } from "../lib/mightpulse-avatar-frame.js";

test("extracts the equipped avatar frame ID and readable label", () => {
  const html = '<div class="gov-portrait has-frame"><img class="gov-avatar-frame" id="profileAvatarFrame" alt="Cosmic Heart Avatar Frame" src="https://www.mightpulse.com/assets/icons/skin_icon_6080310.png" title="Cosmic Heart Avatar Frame"></div>';
  assert.deepEqual(extractMightPulseAvatarFrame(html), {
    assetId: "6080310",
    name: "Cosmic Heart Avatar Frame",
  });
});

test("treats missing or unequipped frame as no frame", () => {
  assert.equal(extractMightPulseAvatarFrame('<img id="profileAvatarFrame" alt="N/A">'), null);
  assert.equal(extractMightPulseAvatarFrame("<html><body>No profile frame here</body></html>"), null);
  assert.equal(extractMightPulseAvatarFrame(null), null);
});

test("rejects arbitrary hosts, paths, and query-bearing frame URLs", () => {
  const cases = [
    '<img id="profileAvatarFrame" src="https://evil.example/assets/icons/skin_icon_6080310.png">',
    '<img id="profileAvatarFrame" src="https://www.mightpulse.com/other/skin_icon_6080310.png">',
    '<img id="profileAvatarFrame" src="https://www.mightpulse.com/assets/icons/skin_icon_6080310.png?redirect=evil">',
    '<img id="profileAvatarFrame" src="javascript:alert(1)">',
  ];
  for (const html of cases) assert.equal(extractMightPulseAvatarFrame(html), null);
});

test("validates frame assets as digits only", () => {
  assert.equal(validateFrameAssetId("6080310"), "6080310");
  assert.equal(validateFrameAssetId("123456789012"), "123456789012");
  for (const assetId of ["123", "abc6080310", "6080310?url=https://evil.example", "../6080310", "1234567890123", ""]) {
    assert.equal(validateFrameAssetId(assetId), null);
  }
});

test("resolves the MightPulse internal UID by exact governor ID", () => {
  assert.equal(resolveMightPulseProfileUid({
    results: [
      { uid: 4751274, fid: 17261054, nick_name: "GAX" },
      { uid: 4751275, fid: 17261055, nick_name: "Other" },
    ],
  }, "17261054"), "4751274");
});

test("does not resolve a partial or unrelated governor ID", () => {
  assert.equal(resolveMightPulseProfileUid({ results: [{ uid: 4751274, fid: 17261054 }] }, "1726105"), null);
  assert.equal(resolveMightPulseProfileUid({ results: [{ uid: "https://evil.example", fid: 17261054 }] }, "17261054"), null);
  assert.equal(resolveMightPulseProfileUid({ results: [] }, "17261054"), null);
});

test("resolves the internal UID from the authenticated API wrapper", () => {
  assert.equal(resolveMightPulseProfileUid({
    uid: 4751274,
    governor_id: 17261054,
    player: { fid: 17261054 },
  }, "17261054"), "4751274");
  assert.equal(resolveMightPulseProfileUid({
    uid: 4751274,
    governor_id: 17261055,
  }, "17261054"), null);
});

test("resolves the internal UID when MightPulse wraps the player record", () => {
  assert.equal(resolveMightPulseProfileUid({
    player: { uid: 4751274, fid: 17261054 },
  }, "17261054"), "4751274");

  assert.equal(resolveMightPulseProfileUid({
    data: { player: { id: 4751274, governor_id: "17261054" } },
  }, "17261054"), "4751274");

  assert.equal(resolveMightPulseProfileUid({
    data: { results: [{ id: 4751274, fid: "17261054" }] },
  }, "17261054"), "4751274");
});


test("extracts equipped avatar frame from MightPulse player JSON", () => {
  assert.deepEqual(extractMightPulseAvatarFrameFromPlayerData({
    uid: 4751274,
    fid: 17261054,
    skins: [
      { id: 6080310, name: "Cosmic Heart Avatar Frame", icon: "/assets/icons/skin_icon_6080310.png", skintype: 4 },
      { id: 6080123, name: "City Skin", icon: "/assets/icons/skin_icon_6080123.png", skintype: 1 },
    ],
  }), { assetId: "6080310", name: "Cosmic Heart Avatar Frame" });
});

test("rejects absent, starter, untrusted, or mismatched avatar frames in player JSON", () => {
  assert.equal(extractMightPulseAvatarFrameFromPlayerData({ skins: [] }), null);
  assert.equal(extractMightPulseAvatarFrameFromPlayerData({
    skins: [{ id: 6080010, name: "Starter Avatar Frame", icon: "/assets/icons/skin_icon_6080010.png", skintype: 4 }],
  }), null);
  assert.equal(extractMightPulseAvatarFrameFromPlayerData({
    skins: [{ id: 6080310, name: "Cosmic Heart Avatar Frame", icon: "https://evil.example/assets/icons/skin_icon_6080310.png", skintype: 4 }],
  }), null);
  assert.equal(extractMightPulseAvatarFrameFromPlayerData({
    skins: [{ id: 6080311, name: "Cosmic Heart Avatar Frame", icon: "/assets/icons/skin_icon_6080310.png", skintype: 4 }],
  }), null);
});
