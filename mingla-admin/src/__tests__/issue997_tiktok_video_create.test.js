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
  it("VIDEO_CREATE_ENABLED turns tiktok ON (meta/snap unchanged; google/reddit still OFF)", () => {
    assert.equal(VIDEO_CREATE_ENABLED.tiktok, true);
    assert.equal(VIDEO_CREATE_ENABLED.meta, true);
    assert.equal(VIDEO_CREATE_ENABLED.snapchat, true);
    assert.equal(VIDEO_CREATE_ENABLED.google, false);
    assert.equal(VIDEO_CREATE_ENABLED.reddit, false);
  });

  // Fails-on-revert: removing "tiktok" from VIDEO_CREATE_PLATFORMS fails this.
  it("VIDEO_CREATE_PLATFORMS includes tiktok (still meta/snap, never google)", () => {
    assert.deepEqual([...VIDEO_CREATE_PLATFORMS], ["meta", "snapchat", "tiktok"]);
  });

  it("a READY tiktok video channel is BUILDABLE; google/reddit stay excluded", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ["meta", "snapchat", "tiktok", "google", "reddit"],
      channels: okChannels(["meta", "snapchat", "tiktok", "google", "reddit"]),
      kind: "video",
      preparationByPlatform: {
        meta: { state: "ready" },
        snapchat: { state: "ready" },
        tiktok: { state: "ready" },
      },
    });
    assert.ok(buildable.includes("tiktok"), "READY tiktok video must be buildable");
    assert.deepEqual(buildable.sort(), ["meta", "snapchat", "tiktok"]);
    assert.deepEqual(excluded.map((e) => e.platform).sort(), ["google", "reddit"]);
    assert.equal(excluded.find((e) => e.platform === "google").reason, "approximation_only");
    assert.equal(excluded.find((e) => e.platform === "reddit").reason, "video_not_creatable");
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
    assert.equal(gate.excluded.find((x) => x.platform === "google").reason, "approximation_only");
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
