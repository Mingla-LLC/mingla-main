// ISSUE-997 D2 — INDEPENDENT TESTER adversarial suite (frontend↔edge CROSS-SURFACE
// parity for the Google Demand Gen video-create gate flip).
//
// DIFFERENT ANGLE from every existing D2 test. The implementor admin happy-path
// (issue997_google_video_create.test.js) and the re-pointed adversarial
// (issue997_google_video_prepare.adversarial.tester.test.js) both test the admin
// gate maps IN ISOLATION. This suite instead attacks the SEAM BETWEEN the admin
// frontend gate and the EDGE source of truth (supabase/functions/_shared/
// adCreativePrepare.ts) — the P4 divergence #997 D2 explicitly reconciled:
//
//   - the frontend capability label for EVERY preparable platform must EQUAL the
//     edge capabilityFor() return parsed FROM the edge source (google's label was
//     the P4 mismatch: frontend "preview_only" vs edge "create_and_approx_preview");
//   - google is BOTH preparable (edge PreparationPlatform + isPreparationPlatform)
//     AND creatable (frontend VIDEO_CREATE_PLATFORMS); reddit is in NEITHER on
//     EITHER surface — no split-brain across the two codebases;
//   - the retired "approximation_only" exclusion reason is DEAD — never emitted at
//     runtime for any platform/state through any exported gate (a regression guard);
//   - a non-creatable platform's gate is readiness-INDEPENDENT: reddit fed a READY
//     prep is STILL excluded (the create gate short-circuits before the ready check).
//
// Pure/source-only; zero provider calls, zero ad objects, zero spend. Reads the
// edge .ts as text (it does not run in node) — a genuine cross-surface assertion.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  emptyPreparation,
  PREPARATION_ORDER,
  readyVideoSubset,
  VIDEO_CREATE_PLATFORMS,
  videoPreparationGate,
} from "../lib/adBuilder/preparationState.js";
import {
  partitionFundedCreative,
  VIDEO_CREATE_ENABLED,
} from "../lib/adBuilder/creativeGate.js";

const okChannel = (platform) => ({ platform, ok: true, needsTranscode: false });
const okChannels = (platforms) => platforms.map(okChannel);

// ── Parse the EDGE source of truth (adCreativePrepare.ts) ─────────────────────

const edgeSource = readFileSync(
  new URL(
    "../../../supabase/functions/_shared/adCreativePrepare.ts",
    import.meta.url,
  ),
  "utf8",
);

// capabilityFor(): explicit `if (platform === "X") return "Y";` guards + the
// trailing unguarded `return "Z";` fallback (which is what tiktok falls through to).
function edgeCapabilityFor(platform) {
  const body = edgeSource.slice(
    edgeSource.indexOf("export function capabilityFor"),
    edgeSource.indexOf("export function toPreparationState"),
  );
  const explicit = {};
  for (const m of body.matchAll(/if \(platform === "(\w+)"\) return "([a-z_]+)";/g)) {
    explicit[m[1]] = m[2];
  }
  const fallback = body.match(/^\s*return "([a-z_]+)";/m);
  return explicit[platform] ?? (fallback ? fallback[1] : undefined);
}

// The edge PreparationPlatform union — the source-of-truth set of preparable platforms.
function edgePreparationPlatforms() {
  const m = edgeSource.match(
    /export type PreparationPlatform =\s*([^;]+);/,
  );
  assert.ok(m, "could not find the edge PreparationPlatform type");
  return [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]);
}

describe("ISSUE-997 D2 ADV · frontend↔edge cross-surface parity (the P4 reconciliation)", () => {
  // Fails-on-revert: reverting emptyPreparation('google') to "preview_only" breaks
  // the google row of this parity (frontend != edge again = the P4 divergence).
  it("the frontend capability label EQUALS the edge capabilityFor() for every preparable platform", () => {
    for (const platform of ["meta", "snapchat", "tiktok", "google"]) {
      const frontend = emptyPreparation(platform).capability;
      const edge = edgeCapabilityFor(platform);
      assert.equal(
        frontend,
        edge,
        `capability split-brain for ${platform}: frontend=${frontend} edge=${edge}`,
      );
    }
    // The specific P4 fix: google is create_and_approx_preview on BOTH surfaces.
    assert.equal(emptyPreparation("google").capability, "create_and_approx_preview");
    assert.equal(edgeCapabilityFor("google"), "create_and_approx_preview");
  });

  it("google is preparable on the EDGE (PreparationPlatform + isPreparationPlatform) and creatable on the FRONTEND; reddit is in NEITHER", () => {
    const edgePrep = edgePreparationPlatforms();
    // Edge preparable set.
    assert.ok(edgePrep.includes("google"), "edge must list google as preparable");
    assert.equal(edgePrep.includes("reddit"), false, "reddit is never preparable on the edge");
    // Edge runtime guard admits google (source assertion).
    assert.ok(
      /value === "google"/.test(edgeSource),
      "edge isPreparationPlatform must admit google",
    );
    assert.equal(
      /value === "reddit"/.test(edgeSource),
      false,
      "edge isPreparationPlatform must NOT admit reddit",
    );
    // Frontend creatable + preparable sets agree with the edge for google/reddit.
    assert.ok(VIDEO_CREATE_PLATFORMS.includes("google"));
    assert.ok(PREPARATION_ORDER.includes("google"));
    assert.equal(VIDEO_CREATE_PLATFORMS.includes("reddit"), false);
    assert.equal(PREPARATION_ORDER.includes("reddit"), false);
    // creatable ⊆ preparable across surfaces (you cannot create what neither can prepare).
    for (const p of VIDEO_CREATE_PLATFORMS) {
      assert.ok(edgePrep.includes(p), `${p} is frontend-creatable but not edge-preparable`);
    }
  });

  // Fails-on-revert: restoring google:false in VIDEO_CREATE_ENABLED re-excludes a
  // READY google as video_not_creatable → resurrects the retired reason path.
  it("the retired 'approximation_only' exclusion reason is DEAD — never emitted at runtime for any platform/state", () => {
    const states = ["not_started", "uploading", "processing", "ready", "failed", "timed_out"];
    const reasonsSeen = new Set();
    for (const state of states) {
      const { excluded } = partitionFundedCreative({
        fundedPlatforms: ["meta", "snapchat", "tiktok", "google", "reddit"],
        channels: okChannels(["meta", "snapchat", "tiktok", "google", "reddit"]),
        kind: "video",
        preparationByPlatform: Object.fromEntries(
          ["meta", "snapchat", "tiktok", "google", "reddit"].map((p) => [p, { state }]),
        ),
      });
      for (const e of excluded) reasonsSeen.add(e.reason);
      const gate = videoPreparationGate({
        fundedPlatforms: ["meta", "snapchat", "tiktok", "google", "reddit"],
        rows: Object.fromEntries(
          ["meta", "snapchat", "tiktok", "google", "reddit"].map((p) => [p, { state }]),
        ),
      });
      for (const x of gate.excluded) reasonsSeen.add(x.reason);
    }
    assert.equal(
      reasonsSeen.has("approximation_only"),
      false,
      `the retired approximation_only reason resurfaced: ${[...reasonsSeen].join(", ")}`,
    );
  });
});

describe("ISSUE-997 D2 ADV · google readiness gates create; reddit never can", () => {
  it("google is buildable ONLY when READY; every non-ready state excludes it as preparation_<state> (never a fabricated success)", () => {
    for (const state of ["not_started", "uploading", "processing", "failed", "timed_out"]) {
      const { buildable, excluded } = partitionFundedCreative({
        fundedPlatforms: ["google"],
        channels: [okChannel("google")],
        kind: "video",
        preparationByPlatform: { google: { state } },
      });
      assert.deepEqual(buildable, [], `google must NOT build when ${state}`);
      assert.equal(
        excluded.find((e) => e.platform === "google").reason,
        `preparation_${state}`,
      );
    }
    // Only READY builds.
    const ready = partitionFundedCreative({
      fundedPlatforms: ["google"],
      channels: [okChannel("google")],
      kind: "video",
      preparationByPlatform: { google: { state: "ready" } },
    });
    assert.deepEqual(ready.buildable, ["google"]);
    assert.deepEqual(ready.excluded, []);
  });

  it("reddit fed a READY prep is STILL excluded — the create gate is readiness-INDEPENDENT for a non-creatable platform", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ["reddit", "google"],
      channels: okChannels(["reddit", "google"]),
      kind: "video",
      // Reddit's prep is READY, yet reddit is not in VIDEO_CREATE_ENABLED.
      preparationByPlatform: { reddit: { state: "ready" }, google: { state: "ready" } },
    });
    assert.equal(buildable.includes("reddit"), false, "reddit can never build a video");
    assert.ok(buildable.includes("google"));
    assert.equal(
      excluded.find((e) => e.platform === "reddit").reason,
      "video_not_creatable",
    );
    // And the gate surface agrees: reddit is video_excluded, google is READY.
    const gate = videoPreparationGate({
      fundedPlatforms: ["reddit", "google"],
      rows: { reddit: { state: "ready" }, google: { state: "ready" } },
    });
    assert.equal(gate.excluded.find((x) => x.platform === "reddit").reason, "video_excluded");
    assert.ok(readyVideoSubset({ fundedPlatforms: ["reddit", "google"], rows: { reddit: { state: "ready" }, google: { state: "ready" } } }).includes("google"));
    assert.equal(
      readyVideoSubset({ fundedPlatforms: ["reddit", "google"], rows: { reddit: { state: "ready" }, google: { state: "ready" } } }).includes("reddit"),
      false,
    );
  });
});
