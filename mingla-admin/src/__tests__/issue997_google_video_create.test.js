// ISSUE-997 D2 implementor regression — Google Demand Gen video create enabled
// through the Campaign Builder (the finale that makes Google video creatable).
// Pure/source-only; zero provider calls, zero ad objects. Fails-on-revert targets
// are called out per test. ONLY Reddit video create stays fail-closed.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  emptyPreparation,
  readyVideoSubset,
  VIDEO_CREATE_PLATFORMS,
  videoPreparationGate,
} from "../lib/adBuilder/preparationState.js";
import {
  partitionFundedCreative,
  VIDEO_CREATE_ENABLED,
} from "../lib/adBuilder/creativeGate.js";

const okChannels = (platforms) =>
  platforms.map((platform) => ({ platform, ok: true, needsTranscode: false }));

describe("ISSUE-997 D2 · Google Demand Gen video create is wired through the builder", () => {
  // Fails-on-revert: restoring VIDEO_CREATE_ENABLED.google to false fails this.
  it("VIDEO_CREATE_ENABLED turns google ON (meta/snap/tiktok unchanged; only reddit OFF)", () => {
    assert.equal(VIDEO_CREATE_ENABLED.google, true);
    assert.equal(VIDEO_CREATE_ENABLED.meta, true);
    assert.equal(VIDEO_CREATE_ENABLED.snapchat, true);
    assert.equal(VIDEO_CREATE_ENABLED.tiktok, true);
    // Reddit is the ONLY platform still fail-closed for video create.
    assert.equal(VIDEO_CREATE_ENABLED.reddit, false);
  });

  // Fails-on-revert: removing "google" from VIDEO_CREATE_PLATFORMS fails this.
  it("VIDEO_CREATE_PLATFORMS includes google (meta/snap/tiktok/google; never reddit)", () => {
    assert.deepEqual([...VIDEO_CREATE_PLATFORMS], ["meta", "snapchat", "tiktok", "google"]);
    assert.equal(VIDEO_CREATE_PLATFORMS.includes("reddit"), false);
  });

  // Fails-on-revert: reverting emptyPreparation("google") to "preview_only" fails
  // this. Reconciles the P4 divergence with the edge capabilityFor("google").
  it("emptyPreparation('google').capability === 'create_and_approx_preview' (matches the edge)", () => {
    assert.equal(emptyPreparation("google").capability, "create_and_approx_preview");
    // Meta/Snap unchanged; tiktok still the cosmetic preview_only default.
    assert.equal(emptyPreparation("meta").capability, "create_and_real_preview");
    assert.equal(emptyPreparation("snapchat").capability, "create_and_approx_preview");
    assert.equal(emptyPreparation("tiktok").capability, "preview_only");
  });

  it("a READY google video channel is BUILDABLE; only reddit stays excluded", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ["meta", "snapchat", "tiktok", "google", "reddit"],
      channels: okChannels(["meta", "snapchat", "tiktok", "google", "reddit"]),
      kind: "video",
      preparationByPlatform: {
        meta: { state: "ready" },
        snapchat: { state: "ready" },
        tiktok: { state: "ready" },
        google: { state: "ready" },
      },
    });
    assert.ok(buildable.includes("google"), "READY google video must be buildable");
    assert.deepEqual(buildable.sort(), ["google", "meta", "snapchat", "tiktok"]);
    // Reddit is the ONLY excluded platform now — video_not_creatable.
    assert.deepEqual(excluded.map((e) => e.platform), ["reddit"]);
    assert.equal(excluded.find((e) => e.platform === "reddit").reason, "video_not_creatable");
  });

  it("a NOT-READY google video channel is excluded as preparation_<state>, never approximation_only", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ["google"],
      channels: okChannels(["google"]),
      kind: "video",
      preparationByPlatform: { google: { state: "processing" } },
    });
    assert.deepEqual(buildable, []);
    const g = excluded.find((e) => e.platform === "google");
    assert.equal(g.reason, "preparation_processing");
    assert.notEqual(g.reason, "approximation_only");
  });

  it("readyVideoSubset + videoPreparationGate surface a READY google as creatable", () => {
    const rows = {
      meta: { state: "ready" },
      snapchat: { state: "failed" },
      tiktok: { state: "ready" },
      google: { state: "ready" },
    };
    assert.deepEqual(
      readyVideoSubset({
        fundedPlatforms: ["meta", "snapchat", "tiktok", "google"],
        rows,
      }).sort(),
      ["google", "meta", "tiktok"],
    );
    const gate = videoPreparationGate({
      fundedPlatforms: ["meta", "snapchat", "tiktok", "google", "reddit"],
      rows,
    });
    assert.ok(gate.ready.includes("google"), "READY google is in the video-create subset");
    // A READY google is NOT excluded — the stale approximation_only reason is gone.
    assert.equal(gate.excluded.find((x) => x.platform === "google"), undefined);
    // Reddit stays hard-excluded from video create.
    assert.equal(gate.excluded.find((x) => x.platform === "reddit").reason, "video_excluded");
  });
});
