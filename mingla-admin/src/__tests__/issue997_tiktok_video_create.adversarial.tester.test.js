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

describe("ISSUE-997 C/D2 adversarial · only Reddit video create can NEVER build", () => {
  // [TEST-MOD-APPROVED ORCH-0997] D2 wired Google Demand Gen video create, so the
  // [TEST-MOD-APPROVED ORCH-1185] #1185 wired Reddit paused-video create as the FIRST
  // no-prepare video platform: given a passing channel it builds from its #866-hosted
  // clip with no prep handoff. The C/D2-era "reddit can NEVER build" invariant is
  // superseded — every funded platform now builds. Fails-on-revert: reverting
  // creativeGate VIDEO_CREATE_ENABLED.reddit → false, OR dropping the
  // VIDEO_CREATE_NO_PREPARE skip, drops reddit from `buildable` here → RED.
  it("a READY google builds; reddit builds too (no-prepare) with passing channels", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ALL,
      channels: okChannels(ALL),
      kind: "video",
      preparationByPlatform: allReady(ALL),
    });
    assert.equal(buildable.includes("google"), true, "a READY google must build (Demand Gen)");
    assert.equal(
      buildable.includes("reddit"),
      true,
      "reddit builds from its #866-hosted clip (no prepare)",
    );
    assert.equal(VIDEO_CREATE_ENABLED.google, true);
    assert.equal(VIDEO_CREATE_ENABLED.reddit, true);
    // Every funded platform builds; nothing excluded.
    assert.deepEqual(buildable.sort(), ["google", "meta", "reddit", "snapchat", "tiktok"]);
    assert.deepEqual(excluded, []);
  });

  it("videoPreparationGate keeps reddit excluded even when marked READY in rows; a READY google continues", () => {
    const gate = videoPreparationGate({
      fundedPlatforms: ALL,
      rows: allReady(ALL), // reddit LIES that it is ready
    });
    // Reddit is not in VIDEO_CREATE_PLATFORMS, so it never enters `ready`.
    assert.equal(gate.ready.includes("reddit"), false);
    // Google IS now in the subset and ready → it continues, no longer excluded.
    assert.equal(gate.ready.includes("google"), true);
    const reasonOf = (p) => gate.excluded.find((e) => e.platform === p)?.reason;
    assert.equal(reasonOf("google"), undefined);
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
  // [TEST-MOD-APPROVED ORCH-1185] #1185 wired reddit ON as a NO-PREPARE platform, so
  // it is VIDEO_CREATE_ENABLED yet stays OUT of the prepare queue VIDEO_CREATE_PLATFORMS.
  // The immutability invariant is re-pointed: a runtime write can neither turn reddit
  // OFF in the enable table nor smuggle it INTO the prepare queue.
  it("VIDEO_CREATE_ENABLED / VIDEO_CREATE_PLATFORMS are frozen — runtime mutation is a no-op", () => {
    assert.ok(Object.isFrozen(VIDEO_CREATE_ENABLED));
    assert.ok(Object.isFrozen(VIDEO_CREATE_PLATFORMS));
    // Attempt to mutate at runtime — must not stick.
    try {
      VIDEO_CREATE_ENABLED.reddit = false; // cannot turn reddit off
      VIDEO_CREATE_PLATFORMS.push("reddit"); // cannot add reddit to the prepare queue
    } catch {
      // strict mode throws on a frozen write — also acceptable.
    }
    assert.equal(VIDEO_CREATE_ENABLED.reddit, true);
    // google stays wired ON (frozen).
    assert.equal(VIDEO_CREATE_ENABLED.google, true);
    assert.equal(VIDEO_CREATE_PLATFORMS.includes("reddit"), false);
    assert.deepEqual([...VIDEO_CREATE_PLATFORMS], ["meta", "snapchat", "tiktok", "google"]);
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

  it("readyVideoSubset surfaces google (never reddit) when funded and 'ready'", () => {
    const subset = readyVideoSubset({ fundedPlatforms: ALL, rows: allReady(ALL) });
    assert.deepEqual(subset.sort(), ["google", "meta", "snapchat", "tiktok"]);
    assert.equal(subset.includes("google"), true);
    assert.equal(subset.includes("reddit"), false);
  });
});
