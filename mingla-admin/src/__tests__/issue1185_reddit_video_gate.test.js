// ISSUE-1185 [Reddit video Phase B] implementor regression — Reddit paused-video
// enabled through the Campaign Builder. Pure/source-only; zero provider calls,
// zero ad objects, zero spend. Fails-on-revert targets are called out per test.
//
// Reddit is the FIRST no-prepare video platform: unlike Meta/Snap/TikTok/Google it
// never uploads the clip to the provider and waits for a READY ref. It is handed
// the canonical hosted master URL + poster off the #866 library row and downloads
// them itself, so the build gate must skip the preparation-ready requirement for it
// while still gating on the byte-probe matrix (a Reddit VIDEO post requires a poster).
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { VIDEO_CREATE_PLATFORMS } from "../lib/adBuilder/preparationState.js";
import {
  partitionFundedCreative,
  VIDEO_CREATE_ENABLED,
  VIDEO_CREATE_NO_PREPARE,
} from "../lib/adBuilder/creativeGate.js";

const okChannels = (platforms) =>
  platforms.map((platform) => ({ platform, ok: true, needsTranscode: false }));

describe("ISSUE-1185 · Reddit video create is wired through the builder (no-prepare)", () => {
  // Fails-on-revert: restoring VIDEO_CREATE_ENABLED.reddit to false fails this.
  it("VIDEO_CREATE_ENABLED turns reddit ON — every platform is now video-creatable", () => {
    assert.equal(VIDEO_CREATE_ENABLED.reddit, true);
    assert.equal(VIDEO_CREATE_ENABLED.meta, true);
    assert.equal(VIDEO_CREATE_ENABLED.snapchat, true);
    assert.equal(VIDEO_CREATE_ENABLED.tiktok, true);
    assert.equal(VIDEO_CREATE_ENABLED.google, true);
  });

  // Fails-on-revert: removing "reddit" from VIDEO_CREATE_NO_PREPARE fails this.
  it("VIDEO_CREATE_NO_PREPARE names reddit (and only reddit) as the URL-hosted, no-prepare platform", () => {
    assert.deepEqual([...VIDEO_CREATE_NO_PREPARE], ["reddit"]);
  });

  // Reddit does NOT prepare, so it must stay OUT of the prepare queue/subset.
  it("VIDEO_CREATE_PLATFORMS (the prepare queue) still EXCLUDES reddit", () => {
    assert.equal(VIDEO_CREATE_PLATFORMS.includes("reddit"), false);
    assert.deepEqual([...VIDEO_CREATE_PLATFORMS], ["meta", "snapchat", "tiktok", "google"]);
  });

  // The crux of #1185: a funded reddit video channel that passed the byte-probe
  // (poster present ⇒ ok) is BUILDABLE even with NO preparation row — the
  // prepare-ready gate does not apply to a no-prepare platform.
  // Fails-on-revert: dropping the VIDEO_CREATE_NO_PREPARE skip re-subjects reddit to
  // the prepare-ready gate, so with no prep row it is excluded preparation_not_started
  // and this assertion fails.
  it("a poster-present reddit video channel is BUILDABLE with NO preparation row", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ["reddit"],
      channels: okChannels(["reddit"]),
      kind: "video",
      preparationByPlatform: {}, // reddit never prepares — no row exists
    });
    assert.deepEqual(buildable, ["reddit"]);
    assert.deepEqual(excluded, []);
  });

  // A reddit video with NO poster fails the matrix (ok:false) → excluded, never built.
  // The matrix (adCreativeMatrix.validateReddit) rejects a posterless VIDEO; here we
  // model its verdict (ok:false) to prove the gate still honours it.
  it("a poster-less reddit video channel (matrix ok:false) is EXCLUDED, never built", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ["reddit"],
      channels: [{ platform: "reddit", ok: false, needsTranscode: false }],
      kind: "video",
      preparationByPlatform: {},
    });
    assert.deepEqual(buildable, []);
    assert.equal(excluded.find((e) => e.platform === "reddit").reason, "blocked");
  });

  // All five platforms build together: the prepared four + reddit (no-prepare).
  it("reddit joins meta/snap/tiktok/google as buildable — the full funded set builds", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ["meta", "snapchat", "tiktok", "google", "reddit"],
      channels: okChannels(["meta", "snapchat", "tiktok", "google", "reddit"]),
      kind: "video",
      preparationByPlatform: {
        meta: { state: "ready" },
        snapchat: { state: "ready" },
        tiktok: { state: "ready" },
        google: { state: "ready" },
        // reddit: deliberately absent — it needs no preparation
      },
    });
    assert.deepEqual(buildable.sort(), ["google", "meta", "reddit", "snapchat", "tiktok"]);
    assert.deepEqual(excluded, []);
  });

  // A prepared sibling that is NOT ready is still excluded (the no-prepare skip is
  // reddit-ONLY — it must not leak to meta/snap/tiktok/google).
  it("the no-prepare skip is reddit-ONLY — a NOT-READY tiktok is still excluded preparation_<state>", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ["tiktok", "reddit"],
      channels: okChannels(["tiktok", "reddit"]),
      kind: "video",
      preparationByPlatform: { tiktok: { state: "processing" } },
    });
    assert.deepEqual(buildable, ["reddit"]);
    assert.equal(excluded.find((e) => e.platform === "tiktok").reason, "preparation_processing");
  });

  // Image (kind omitted) partition is UNREGRESSED for reddit.
  it("image (kind omitted) partition is UNREGRESSED for reddit", () => {
    const { buildable } = partitionFundedCreative({
      fundedPlatforms: ["reddit"],
      channels: okChannels(["reddit"]),
    });
    assert.deepEqual(buildable, ["reddit"]);
  });
});
