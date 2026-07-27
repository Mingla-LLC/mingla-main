// ISSUE-997 D1 — INDEPENDENT TESTER adversarial suite (frontend prepare/create gate).
//
// DIFFERENT ANGLE from the implementor admin test (issue997_google_video_prepare
// .test.js), which checked the PREPARATION_ORDER contents, a queued google row,
// the create lists, and one paired google+tiktok partition.
//
// This suite attacks the STRUCTURAL INVARIANT that a prepared-but-not-creatable
// google can NEVER leak into a buildable/creatable set through ANY exported path,
// under adversarial inputs:
//   - creatable ⊆ preparable, google ∈ preparable \ creatable, and the two
//     independent create-gate sources (VIDEO_CREATE_PLATFORMS vs
//     VIDEO_CREATE_ENABLED) AGREE — no split-brain that could admit google.
//   - the gate maps are FROZEN (a caller cannot mutate google in).
//   - google-ALONE (no sibling to mask a leak) is excluded as approximation_only.
//   - for EVERY preparation state — including "ready" — a funded google video is
//     excluded as approximation_only: the create gate short-circuits BEFORE the
//     ready check, so a READY google can never leak through.
//   - readyVideoSubset / videoPreparationGate never surface google (nor reddit).
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
} from "../lib/adBuilder/creativeGate.js";

const okChannel = (platform) => ({ platform, ok: true, needsTranscode: false });

describe("ISSUE-997 D1 ADV · a prepared google video can NEVER become creatable", () => {
  it("INVARIANT: creatable ⊆ preparable, and google is preparable-but-not-creatable", () => {
    // Everything creatable must be preparable (you cannot create what you cannot prepare).
    for (const p of VIDEO_CREATE_PLATFORMS) {
      assert.ok(
        PREPARATION_ORDER.includes(p),
        `${p} is creatable but not in PREPARATION_ORDER`,
      );
    }
    // Google is the ONE platform that is preparable yet deliberately not creatable.
    assert.ok(PREPARATION_ORDER.includes("google"), "google must be preparable");
    assert.equal(
      VIDEO_CREATE_PLATFORMS.includes("google"),
      false,
      "google must NOT be creatable in D1",
    );
  });

  it("the two create-gate SOURCES agree (no split-brain that could admit google)", () => {
    // VIDEO_CREATE_ENABLED[p] === true  <=>  p ∈ VIDEO_CREATE_PLATFORMS, for every
    // platform either source knows about. A mismatch on google would be a leak.
    const universe = new Set([
      ...VIDEO_CREATE_PLATFORMS,
      ...Object.keys(VIDEO_CREATE_ENABLED),
      "google",
    ]);
    for (const p of universe) {
      assert.equal(
        VIDEO_CREATE_ENABLED[p] === true,
        VIDEO_CREATE_PLATFORMS.includes(p),
        `create-gate sources disagree for ${p}`,
      );
    }
    assert.equal(VIDEO_CREATE_ENABLED.google, false);
  });

  it("the gate maps are FROZEN and google appears exactly once (no mutation-in)", () => {
    assert.ok(Object.isFrozen(PREPARATION_ORDER));
    assert.ok(Object.isFrozen(VIDEO_CREATE_PLATFORMS));
    assert.ok(Object.isFrozen(VIDEO_CREATE_ENABLED));
    assert.equal(PREPARATION_ORDER.filter((p) => p === "google").length, 1);
    // A frozen push is a silent no-op in sloppy mode / throws in strict — either
    // way google can't be duplicated and the create lists can't grow.
    const before = [...VIDEO_CREATE_PLATFORMS];
    try {
      VIDEO_CREATE_PLATFORMS.push("google");
    } catch (_e) { /* strict-mode throw is fine */ }
    assert.deepEqual([...VIDEO_CREATE_PLATFORMS], before);
    assert.equal(VIDEO_CREATE_PLATFORMS.includes("google"), false);
  });

  it("google ALONE (no sibling to mask a leak) is excluded as approximation_only", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ["google"],
      channels: [okChannel("google")],
      kind: "video",
      preparationByPlatform: { google: { state: "ready" } },
    });
    assert.deepEqual(buildable, []);
    assert.equal(excluded.length, 1);
    assert.equal(excluded[0].platform, "google");
    assert.equal(excluded[0].reason, "approximation_only");
  });

  it("for EVERY preparation state — INCLUDING ready — a funded google video stays approximation_only", () => {
    const states = [
      "not_started",
      ...ACTIVE_PREPARATION_STATES,
      ...TERMINAL_PREPARATION_STATES,
    ];
    for (const state of states) {
      const { buildable, excluded } = partitionFundedCreative({
        fundedPlatforms: ["google"],
        channels: [okChannel("google")], // channel validation PASSES...
        kind: "video",
        preparationByPlatform: { google: { state } },
      });
      // ...yet google is NEVER buildable and the reason is ALWAYS the create gate,
      // never a preparation_<state> reason — the enable-gate short-circuits first.
      assert.deepEqual(buildable, [], `google buildable at state=${state}`);
      assert.equal(
        excluded.find((e) => e.platform === "google").reason,
        "approximation_only",
        `wrong exclusion reason at state=${state}`,
      );
    }
  });

  it("readyVideoSubset never surfaces google (nor reddit), even amid ready siblings", () => {
    const rows = {
      meta: { state: "ready" },
      snapchat: { state: "ready" },
      tiktok: { state: "ready" },
      google: { state: "ready" },
      reddit: { state: "ready" },
    };
    const subset = readyVideoSubset({
      fundedPlatforms: ["meta", "snapchat", "tiktok", "google", "reddit"],
      rows,
    }).sort();
    assert.deepEqual(subset, ["meta", "snapchat", "tiktok"]);
    assert.equal(subset.includes("google"), false);
    assert.equal(subset.includes("reddit"), false);
  });

  it("videoPreparationGate agrees with creativeGate: google excluded as approximation_only", () => {
    const gate = videoPreparationGate({
      fundedPlatforms: ["tiktok", "google"],
      rows: { tiktok: { state: "ready" }, google: { state: "ready" } },
    });
    assert.deepEqual(gate.ready, ["tiktok"]);
    assert.ok(gate.canContinue); // tiktok carries it; google does not block
    const g = gate.excluded.find((x) => x.platform === "google");
    assert.equal(g.reason, "approximation_only");
    // Cross-source consistency: creativeGate reports the SAME reason for google.
    const part = partitionFundedCreative({
      fundedPlatforms: ["google"],
      channels: [okChannel("google")],
      kind: "video",
      preparationByPlatform: { google: { state: "ready" } },
    });
    assert.equal(
      part.excluded.find((e) => e.platform === "google").reason,
      g.reason,
    );
  });

  it("google IS prepared (queued + session row) — proving 'prepared, just not creatable'", () => {
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
    // ...but the SAME google, once ready, is still not in the create subset.
    assert.deepEqual(
      readyVideoSubset({
        fundedPlatforms: ["google"],
        rows: { google: { state: "ready" } },
      }),
      [],
    );
  });
});
