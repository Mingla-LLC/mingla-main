// ISSUE-997 D2 — INDEPENDENT TESTER adversarial suite (frontend prepare/create gate).
//
// [TEST-MOD-APPROVED ORCH-0997] This suite was authored for D1, when a prepared
// google video was deliberately NOT creatable. D2 wires Google Demand Gen video
// create, so the "google can NEVER become creatable" invariant is obsolete. The
// suite is re-pointed to the NEW adversarial truth while keeping the same ATTACK
// ANGLES:
//   - creatable ⊆ preparable (you cannot create what you cannot prepare) — google
//     is now in BOTH sets; reddit is in NEITHER.
//   - the two independent create-gate sources (VIDEO_CREATE_PLATFORMS vs
//     VIDEO_CREATE_ENABLED) AGREE — no split-brain (a mismatch on google or reddit
//     would be a leak).
//   - the gate maps are FROZEN (a caller cannot mutate reddit in).
//   - a READY google video IS buildable (Demand Gen), but ONLY through the READY
//     gate: a not-ready google is excluded as preparation_<state>, never a
//     fabricated success.
//   - reddit builds a video at ANY preparation state (ORCH-1185 wired it as a
//     NO-PREPARE platform; prep state is irrelevant to it) — while the PREPARE
//     surface (readyVideoSubset / videoPreparationGate) still surfaces google and
//     never reddit, because reddit does not join the preparation flow.
//
// Pure/source-only; zero provider calls, zero ad objects, zero spend.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVE_PREPARATION_STATES,
  createPreparationSession,
  pendingQueue,
  PREPARATION_ORDER,
  readyVideoSubset,
  TERMINAL_PREPARATION_STATES,
  VIDEO_CREATE_PLATFORMS,
  videoPreparationGate,
} from "../lib/adBuilder/preparationState.js";
import {
  partitionFundedCreative,
  VIDEO_CREATE_ENABLED,
  VIDEO_CREATE_NO_PREPARE,
} from "../lib/adBuilder/creativeGate.js";

const okChannel = (platform) => ({ platform, ok: true, needsTranscode: false });

describe("ISSUE-997 D2 ADV · a READY google video IS creatable; only reddit stays fail-closed", () => {
  it("INVARIANT: creatable ⊆ preparable, and google is now BOTH preparable and creatable", () => {
    // Everything creatable must be preparable (you cannot create what you cannot prepare).
    for (const p of VIDEO_CREATE_PLATFORMS) {
      assert.ok(
        PREPARATION_ORDER.includes(p),
        `${p} is creatable but not in PREPARATION_ORDER`,
      );
    }
    // Google is now BOTH preparable and creatable (Demand Gen).
    assert.ok(PREPARATION_ORDER.includes("google"), "google must be preparable");
    assert.equal(
      VIDEO_CREATE_PLATFORMS.includes("google"),
      true,
      "google must be creatable in D2",
    );
    // Reddit is the last platform that is NEITHER wired for video create.
    assert.equal(VIDEO_CREATE_PLATFORMS.includes("reddit"), false);
  });

  // [TEST-MOD-APPROVED ORCH-1185] #1185 introduced the NO-PREPARE video class (reddit):
  // creatable but NOT in the prepare queue. So the create-gate invariant is restated:
  // a platform is VIDEO_CREATE_ENABLED IFF it is EITHER a prepare platform
  // (VIDEO_CREATE_PLATFORMS) OR a no-prepare platform (VIDEO_CREATE_NO_PREPARE); the two
  // are disjoint and together cover exactly the enabled set. No split-brain.
  it("the create-gate SOURCES agree — enabled === (prepare-queue ∪ no-prepare), disjoint", () => {
    const universe = new Set([
      ...VIDEO_CREATE_PLATFORMS,
      ...VIDEO_CREATE_NO_PREPARE,
      ...Object.keys(VIDEO_CREATE_ENABLED),
      "google",
      "reddit",
    ]);
    for (const p of universe) {
      const creatable = VIDEO_CREATE_PLATFORMS.includes(p) ||
        VIDEO_CREATE_NO_PREPARE.includes(p);
      assert.equal(
        VIDEO_CREATE_ENABLED[p] === true,
        creatable,
        `create-gate sources disagree for ${p}`,
      );
    }
    // The two creatable sets are DISJOINT — no platform both prepares and skips prepare.
    for (const p of VIDEO_CREATE_NO_PREPARE) {
      assert.equal(VIDEO_CREATE_PLATFORMS.includes(p), false, `${p} cannot be in both sets`);
    }
    assert.equal(VIDEO_CREATE_ENABLED.google, true);
    assert.equal(VIDEO_CREATE_ENABLED.reddit, true);
  });

  it("the gate maps are FROZEN and reddit can't be mutated in (no create-list growth)", () => {
    assert.ok(Object.isFrozen(PREPARATION_ORDER));
    assert.ok(Object.isFrozen(VIDEO_CREATE_PLATFORMS));
    assert.ok(Object.isFrozen(VIDEO_CREATE_ENABLED));
    assert.equal(PREPARATION_ORDER.filter((p) => p === "google").length, 1);
    assert.equal(VIDEO_CREATE_PLATFORMS.filter((p) => p === "google").length, 1);
    // A frozen push is a silent no-op in sloppy mode / throws in strict — either
    // way reddit can't be smuggled into the create list.
    const before = [...VIDEO_CREATE_PLATFORMS];
    try {
      VIDEO_CREATE_PLATFORMS.push("reddit");
    } catch { /* strict-mode throw is fine */ }
    assert.deepEqual([...VIDEO_CREATE_PLATFORMS], before);
    assert.equal(VIDEO_CREATE_PLATFORMS.includes("reddit"), false);
  });

  it("google ALONE (no sibling to mask a miss) with a READY prep is buildable", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ["google"],
      channels: [okChannel("google")],
      kind: "video",
      preparationByPlatform: { google: { state: "ready" } },
    });
    assert.deepEqual(buildable, ["google"]);
    assert.deepEqual(excluded, []);
  });

  it("google buildable ONLY when READY — every non-ready state excludes it as preparation_<state> (never a fabricated success)", () => {
    const nonReady = [
      "not_started",
      ...ACTIVE_PREPARATION_STATES,
      ...TERMINAL_PREPARATION_STATES.filter((s) => s !== "ready"),
    ];
    for (const state of nonReady) {
      const { buildable, excluded } = partitionFundedCreative({
        fundedPlatforms: ["google"],
        channels: [okChannel("google")], // channel validation PASSES...
        kind: "video",
        preparationByPlatform: { google: { state } },
      });
      // ...yet a not-ready google is NEVER buildable, and the reason is the
      // readiness gate (preparation_<state>), never a fabricated build.
      assert.deepEqual(buildable, [], `google buildable at state=${state}`);
      assert.equal(
        excluded.find((e) => e.platform === "google").reason,
        `preparation_${state}`,
        `wrong exclusion reason at state=${state}`,
      );
    }
    // A READY google IS buildable.
    const ready = partitionFundedCreative({
      fundedPlatforms: ["google"],
      channels: [okChannel("google")],
      kind: "video",
      preparationByPlatform: { google: { state: "ready" } },
    });
    assert.deepEqual(ready.buildable, ["google"]);
  });

  // [TEST-MOD-APPROVED ORCH-1185] #1185 wired Reddit as a NO-PREPARE platform: its
  // preparation state is IRRELEVANT (it never prepares). With a passing channel it is
  // buildable regardless of any prep-row state — the old "reddit fail-closed at every
  // state" invariant is superseded by "prep state does not gate reddit".
  it("reddit builds a video at ANY preparation state — prep state is irrelevant to a no-prepare platform", () => {
    const states = [
      "not_started",
      ...ACTIVE_PREPARATION_STATES,
      ...TERMINAL_PREPARATION_STATES,
    ];
    for (const state of states) {
      const { buildable, excluded } = partitionFundedCreative({
        fundedPlatforms: ["reddit"],
        channels: [okChannel("reddit")],
        kind: "video",
        preparationByPlatform: { reddit: { state } },
      });
      assert.deepEqual(buildable, ["reddit"], `reddit not buildable at state=${state}`);
      assert.deepEqual(
        excluded,
        [],
        `reddit must build regardless of prep state=${state}`,
      );
    }
  });

  it("readyVideoSubset surfaces google (never reddit), amid ready siblings", () => {
    const rows = {
      meta: { state: "ready" },
      snapchat: { state: "ready" },
      tiktok: { state: "ready" },
      google: { state: "ready" },
      reddit: { state: "ready" }, // reddit LIES that it is ready
    };
    const subset = readyVideoSubset({
      fundedPlatforms: ["meta", "snapchat", "tiktok", "google", "reddit"],
      rows,
    }).sort();
    assert.deepEqual(subset, ["google", "meta", "snapchat", "tiktok"]);
    assert.equal(subset.includes("google"), true);
    assert.equal(subset.includes("reddit"), false);
  });

  it("videoPreparationGate agrees with creativeGate: a READY google is in the create subset", () => {
    const gate = videoPreparationGate({
      fundedPlatforms: ["tiktok", "google"],
      rows: { tiktok: { state: "ready" }, google: { state: "ready" } },
    });
    assert.deepEqual(gate.ready.sort(), ["google", "tiktok"]);
    assert.ok(gate.canContinue);
    // A READY google is NOT excluded.
    assert.equal(gate.excluded.find((x) => x.platform === "google"), undefined);
    // Cross-source consistency: creativeGate ALSO builds the READY google.
    const part = partitionFundedCreative({
      fundedPlatforms: ["google"],
      channels: [okChannel("google")],
      kind: "video",
      preparationByPlatform: { google: { state: "ready" } },
    });
    assert.deepEqual(part.buildable, ["google"]);
  });

  it("google IS prepared (queued + session row) AND creatable once ready", () => {
    const session = createPreparationSession("creative-adv");
    assert.ok(
      Object.prototype.hasOwnProperty.call(session.rows, "google"),
      "session must carry a google preparation row",
    );
    // A funded google that hasn't started IS queued for preparation...
    assert.deepEqual(
      pendingQueue({ fundedPlatforms: ["google"], rows: session.rows }),
      ["google"],
    );
    // ...and the SAME google, once ready, IS now in the create subset.
    assert.deepEqual(
      readyVideoSubset({
        fundedPlatforms: ["google"],
        rows: { google: { state: "ready" } },
      }),
      ["google"],
    );
  });
});
