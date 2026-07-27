// ISSUE-997 D1 implementor regression — Google joins the PREPARATION queue while
// Google video CREATE stays fail-closed. Pure/source-only; zero provider calls,
// zero ad objects. Fails-on-revert targets called out per test.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createPreparationSession,
  pendingQueue,
  PREPARATION_ORDER,
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

describe("ISSUE-997 D1 · Google video preparation is wired; create stays fail-closed", () => {
  // Fails-on-revert: removing "google" from PREPARATION_ORDER fails this.
  it("PREPARATION_ORDER now walks meta→snapchat→tiktok→google", () => {
    assert.deepEqual([...PREPARATION_ORDER], [
      "meta",
      "snapchat",
      "tiktok",
      "google",
    ]);
  });

  it("a funded google video is QUEUED for preparation", () => {
    const session = createPreparationSession("creative-d1");
    assert.ok(
      Object.prototype.hasOwnProperty.call(session.rows, "google"),
      "the session must carry a google preparation row",
    );
    const queue = pendingQueue({
      fundedPlatforms: ["google"],
      rows: session.rows,
    });
    assert.deepEqual(queue, ["google"], "a funded google video must be prepared");
  });

  // [TEST-MOD-APPROVED ORCH-0997] D2 wired Google Demand Gen video create, so the
  // D1-era "google create stays fail-closed / prepared-READY google is
  // approximation_only" assertions are obsolete. Updated to the new truth (google
  // IS now in the video-create subset and a prepared-READY google IS buildable),
  // keeping meta/snap/tiktok intact and reddit still fail-closed. The D1
  // PREPARATION_ORDER + queued-google tests above are untouched.
  it("VIDEO_CREATE_PLATFORMS / VIDEO_CREATE_ENABLED now INCLUDE google (D2 create wired); only reddit OFF", () => {
    assert.deepEqual([...VIDEO_CREATE_PLATFORMS], ["meta", "snapchat", "tiktok", "google"]);
    assert.equal(VIDEO_CREATE_ENABLED.google, true);
    assert.equal(VIDEO_CREATE_ENABLED.meta, true);
    assert.equal(VIDEO_CREATE_ENABLED.snapchat, true);
    assert.equal(VIDEO_CREATE_ENABLED.tiktok, true);
    assert.equal(VIDEO_CREATE_ENABLED.reddit, false);
  });

  it("a prepared-READY google video is now BUILDABLE alongside tiktok", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ["tiktok", "google"],
      channels: okChannels(["tiktok", "google"]),
      kind: "video",
      preparationByPlatform: {
        tiktok: { state: "ready" },
        google: { state: "ready" }, // prepared → now creatable (Demand Gen)
      },
    });
    assert.deepEqual(buildable.sort(), ["google", "tiktok"]);
    assert.deepEqual(excluded, []);
  });

  it("readyVideoSubset + videoPreparationGate surface a READY google as creatable", () => {
    const rows = {
      meta: { state: "ready" },
      tiktok: { state: "ready" },
      google: { state: "ready" },
    };
    assert.deepEqual(
      readyVideoSubset({
        fundedPlatforms: ["meta", "tiktok", "google"],
        rows,
      }).sort(),
      ["google", "meta", "tiktok"],
    );
    const gate = videoPreparationGate({
      fundedPlatforms: ["meta", "tiktok", "google"],
      rows,
    });
    assert.equal(gate.ready.includes("google"), true);
    assert.equal(gate.excluded.find((x) => x.platform === "google"), undefined);
  });
});
