// ISSUE-997 C — INDEPENDENT TESTER adversarial suite (admin builder gates).
//
// DIFFERENT ANGLE than the implementor happy-path (issue997_tiktok_video_create.test.js,
// which proves a READY tiktok BUILDS). This suite attacks the NEGATIVE space of the
// gate — the safety invariants that must hold no matter what a caller feeds:
//   • Google + Reddit video create stay HARD fail-closed even when their prep says
//     "ready" AND their channel validation passes — the core scope-D-not-built guard.
//   • A READY tiktok prep can NEVER override a FAILING / transcode-pending channel.
//   • A tiktok whose prep is NOT ready (every non-ready state, incl. missing) is
//     excluded as preparation_<state>, never buildable, never "preview_only".
//   • The gate tables are frozen — a runtime mutation to enable google/reddit is a
//     no-op.
//   • The video partition stays TOTAL (buildable ∪ excluded === funded) — no platform
//     is silently dropped once tiktok joins.
//
// Pure/synchronous; zero provider calls, zero ad objects, zero spend.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  readyVideoSubset,
  VIDEO_CREATE_PLATFORMS,
  videoPreparationGate,
} from "../lib/adBuilder/preparationState.js";
import {
  partitionFundedCreative,
  VIDEO_CREATE_ENABLED,
} from "../lib/adBuilder/creativeGate.js";

const ALL = ["meta", "snapchat", "tiktok", "google", "reddit"];
const okChannels = (platforms) =>
  platforms.map((platform) => ({ platform, ok: true, needsTranscode: false }));
const allReady = (platforms) =>
  Object.fromEntries(platforms.map((p) => [p, { state: "ready" }]));

describe("ISSUE-997 C adversarial · Google/Reddit video create can NEVER build", () => {
  // THE core safety invariant. Even handed a READY prep AND a passing channel for
  // every platform, Google and Reddit must land in `excluded`, never `buildable`.
  // Fails-on-revert: flipping creativeGate VIDEO_CREATE_ENABLED.google → true makes
  // google buildable here → RED.
  it("google + reddit stay excluded with a READY prep and passing channels", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ALL,
      channels: okChannels(ALL),
      kind: "video",
      preparationByPlatform: allReady(ALL),
    });
    assert.equal(buildable.includes("google"), false, "google must never build a video");
    assert.equal(buildable.includes("reddit"), false, "reddit must never build a video");
    const reasonOf = (p) => excluded.find((e) => e.platform === p)?.reason;
    assert.equal(reasonOf("google"), "approximation_only");
    assert.equal(reasonOf("reddit"), "video_not_creatable");
    // The flag table itself keeps them OFF (frozen — see below).
    assert.equal(VIDEO_CREATE_ENABLED.google, false);
    assert.equal(VIDEO_CREATE_ENABLED.reddit, false);
    // And tiktok, correctly wired, DOES build alongside meta/snap.
    assert.deepEqual(buildable.sort(), ["meta", "snapchat", "tiktok"]);
  });

  it("videoPreparationGate keeps google/reddit excluded even when marked READY in rows", () => {
    const gate = videoPreparationGate({
      fundedPlatforms: ALL,
      rows: allReady(ALL), // google & reddit LIE that they are ready
    });
    // They are not in VIDEO_CREATE_PLATFORMS, so they never enter `ready`.
    assert.equal(gate.ready.includes("google"), false);
    assert.equal(gate.ready.includes("reddit"), false);
    const reasonOf = (p) => gate.excluded.find((e) => e.platform === p)?.reason;
    assert.equal(reasonOf("google"), "approximation_only");
    assert.equal(reasonOf("reddit"), "video_excluded");
    // tiktok, being in the subset AND ready, continues.
    assert.ok(gate.ready.includes("tiktok"));
    assert.equal(gate.canContinue, true);
  });
});

describe("ISSUE-997 C adversarial · a READY tiktok prep is NOT a free pass", () => {
  // A prepared video ref does not override the byte-probe channel validation. A
  // blocked channel stays excluded even with a READY prep.
  it("a READY tiktok with a FAILING channel is excluded (blocked), never buildable", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ["tiktok"],
      channels: [{ platform: "tiktok", ok: false, needsTranscode: false }],
      kind: "video",
      preparationByPlatform: { tiktok: { state: "ready" } },
    });
    assert.deepEqual(buildable, []);
    assert.equal(excluded.find((e) => e.platform === "tiktok").reason, "blocked");
  });

  it("a READY tiktok that still needs transcode is excluded (needs_transcode)", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ["tiktok"],
      channels: [{ platform: "tiktok", ok: true, needsTranscode: true }],
      kind: "video",
      preparationByPlatform: { tiktok: { state: "ready" } },
    });
    assert.deepEqual(buildable, []);
    assert.equal(excluded.find((e) => e.platform === "tiktok").reason, "needs_transcode");
  });

  // Every NON-ready prep state (and a missing row) excludes tiktok as
  // preparation_<state> — never "preview_only", never buildable.
  it("a NOT-ready tiktok (every state incl. missing) is excluded preparation_<state>", () => {
    for (const state of ["not_started", "uploading", "processing", "failed", "timed_out"]) {
      const { buildable, excluded } = partitionFundedCreative({
        fundedPlatforms: ["tiktok"],
        channels: okChannels(["tiktok"]),
        kind: "video",
        preparationByPlatform: { tiktok: { state } },
      });
      assert.deepEqual(buildable, [], `state=${state} must not build`);
      const reason = excluded.find((e) => e.platform === "tiktok").reason;
      assert.equal(reason, `preparation_${state}`, `state=${state} reason`);
      assert.notEqual(reason, "preview_only");
    }
    // A missing preparation row → preparation_not_started.
    const missing = partitionFundedCreative({
      fundedPlatforms: ["tiktok"],
      channels: okChannels(["tiktok"]),
      kind: "video",
      preparationByPlatform: {},
    });
    assert.deepEqual(missing.buildable, []);
    assert.equal(
      missing.excluded.find((e) => e.platform === "tiktok").reason,
      "preparation_not_started",
    );
  });
});

describe("ISSUE-997 C adversarial · gate tables are immutable + partition is total", () => {
  it("VIDEO_CREATE_ENABLED / VIDEO_CREATE_PLATFORMS are frozen — enabling google/reddit is a no-op", () => {
    assert.ok(Object.isFrozen(VIDEO_CREATE_ENABLED));
    assert.ok(Object.isFrozen(VIDEO_CREATE_PLATFORMS));
    // Attempt to smuggle google on at runtime — must not stick.
    try {
      VIDEO_CREATE_ENABLED.google = true;
      VIDEO_CREATE_PLATFORMS.push("google");
    } catch {
      // strict mode throws on a frozen write — also acceptable.
    }
    assert.equal(VIDEO_CREATE_ENABLED.google, false);
    assert.equal(VIDEO_CREATE_ENABLED.reddit, false);
    assert.equal(VIDEO_CREATE_PLATFORMS.includes("google"), false);
    assert.deepEqual([...VIDEO_CREATE_PLATFORMS], ["meta", "snapchat", "tiktok"]);
  });

  it("the video partition stays TOTAL once tiktok joins (buildable ∪ excluded === funded)", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ALL,
      channels: okChannels(ALL),
      kind: "video",
      preparationByPlatform: allReady(ALL),
    });
    const covered = [...buildable, ...excluded.map((e) => e.platform)].sort();
    assert.deepEqual(covered, [...ALL].sort());
    // no platform appears in BOTH sets
    for (const p of buildable) {
      assert.equal(excluded.find((e) => e.platform === p), undefined, `${p} in both sets`);
    }
  });

  it("readyVideoSubset never surfaces google/reddit even when funded and 'ready'", () => {
    const subset = readyVideoSubset({ fundedPlatforms: ALL, rows: allReady(ALL) });
    assert.deepEqual(subset.sort(), ["meta", "snapchat", "tiktok"]);
    assert.equal(subset.includes("google"), false);
    assert.equal(subset.includes("reddit"), false);
  });
});
