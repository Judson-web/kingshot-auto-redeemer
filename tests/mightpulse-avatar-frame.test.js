import test from "node:test";
import assert from "node:assert/strict";
import { extractMightPulseAvatarFrame, validateFrameAssetId } from "../lib/mightpulse-avatar-frame.js";

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
