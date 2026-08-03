// ISSUE-997 C implementor regression — TikTok paused-video enabled through the
// Campaign Builder. Pure/source-only; zero provider calls, zero ad objects.
// Fails-on-revert targets are called out per test. Scope D (Google video) is a
// separate sub-wave and is intentionally left OFF here.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  VIDEO_CREATE_PLATFORMS,
  readyVideoSubset,
  videoPreparationGate,
} from "../lib/adBuilder/preparationState.js";
import {
  partitionFundedCreative,
  VIDEO_CREATE_ENABLED,
} from "../lib/adBuilder/creativeGate.js";

const okChannels = (platforms) =>
  platforms.map((platform) => ({ platform, ok: true, needsTranscode: false }));

describe("ISSUE-997 C · TikTok video create is wired through the builder", () => {
  // Fails-on-revert: restoring VIDEO_CREATE_ENABLED.tiktok to false fails this.
  // [TEST-MOD-APPROVED ORCH-1185] #1185 wired Reddit paused-video create (the last
  // platform still OFF), so the C/D2-era "only reddit OFF" assertion is obsolete —
  // updated to the new truth (every platform ON), keeping tiktok (this file's
  // subject) buildable.
  it("VIDEO_CREATE_ENABLED turns tiktok ON (every platform ON — reddit wired by #1185)", () => {
    assert.equal(VIDEO_CREATE_ENABLED.tiktok, true);
    assert.equal(VIDEO_CREATE_ENABLED.meta, true);
    assert.equal(VIDEO_CREATE_ENABLED.snapchat, true);
    assert.equal(VIDEO_CREATE_ENABLED.google, true);
    assert.equal(VIDEO_CREATE_ENABLED.reddit, true);
  });

  // Fails-on-revert: removing "tiktok" from VIDEO_CREATE_PLATFORMS fails this.
  it("VIDEO_CREATE_PLATFORMS includes tiktok (meta/snap/tiktok/google; never reddit)", () => {
    assert.deepEqual([...VIDEO_CREATE_PLATFORMS], ["meta", "snapchat", "tiktok", "google"]);
  });

  // [TEST-MOD-APPROVED ORCH-1185] #1185 wired Reddit as a no-prepare video platform
  // (it builds from the #866-hosted clip with no prep row), so reddit is no longer
  // excluded here — it joins the buildable set. TikTok (this file's subject) is
  // unaffected.
  it("a READY tiktok video channel is BUILDABLE; reddit builds too (no prep row needed)", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ["meta", "snapchat", "tiktok", "google", "reddit"],
      channels: okChannels(["meta", "snapchat", "tiktok", "google", "reddit"]),
      kind: "video",
      preparationByPlatform: {
        meta: { state: "ready" },
        snapchat: { state: "ready" },
        tiktok: { state: "ready" },
        google: { state: "ready" },
        // reddit: no prep row — it needs none (no-prepare platform)
      },
    });
    assert.ok(buildable.includes("tiktok"), "READY tiktok video must be buildable");
    assert.deepEqual(buildable.sort(), ["google", "meta", "reddit", "snapchat", "tiktok"]);
    assert.deepEqual(excluded, []);
  });

  it("a NOT-READY tiktok video channel is excluded as preparation_<state>, never preview_only", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ["tiktok"],
      channels: okChannels(["tiktok"]),
      kind: "video",
      preparationByPlatform: { tiktok: { state: "processing" } },
    });
    assert.deepEqual(buildable, []);
    assert.equal(excluded.find((e) => e.platform === "tiktok").reason, "preparation_processing");
  });

  it("readyVideoSubset + videoPreparationGate include a READY tiktok", () => {
    const rows = {
      meta: { state: "ready" },
      snapchat: { state: "failed" },
      tiktok: { state: "ready" },
    };
    assert.deepEqual(
      readyVideoSubset({ fundedPlatforms: ["meta", "snapchat", "tiktok", "google"], rows }).sort(),
      ["meta", "tiktok"],
    );
    const gate = videoPreparationGate({
      fundedPlatforms: ["meta", "snapchat", "tiktok", "google", "reddit"],
      rows,
    });
    assert.ok(gate.ready.includes("tiktok"), "READY tiktok is in the video-create subset");
    // A READY tiktok is NOT excluded — so the stale preview_only reason is gone.
    assert.equal(gate.excluded.find((x) => x.platform === "tiktok"), undefined);
    // [TEST-MOD-APPROVED ORCH-0997] google is now creatable — with no ready row
    // here it is excluded as preparation_<state>, no longer approximation_only.
    assert.equal(gate.excluded.find((x) => x.platform === "google").reason, "preparation_not_started");
    assert.equal(gate.excluded.find((x) => x.platform === "reddit").reason, "video_excluded");
  });

  it("image (kind omitted) partition is UNREGRESSED for tiktok", () => {
    const { buildable } = partitionFundedCreative({
      fundedPlatforms: ["tiktok"],
      channels: okChannels(["tiktok"]),
    });
    assert.deepEqual(buildable, ["tiktok"]);
  });
});
