// ISSUE-995 [Campaign Builder creative] Wave 3 of #977 — REWORK suite
// (tester CONDITIONAL PASS, 2 honesty gaps).
//
// The video-CREATE wiring gap is deferred to #997 (admin-ad-create-campaign
// never calls resolveCreativeRef). Until then, a video ad actually FAILS at
// create on Meta/TikTok/Snap/Reddit (honest 422) AND fires a FABRICATED
// "Created" for a text-only ad on Google. So #998 makes video PREVIEW-ONLY and
// honest:
//   P1 — selecting video surfaces an unmissable "not available yet" signal and
//        the build path is blocked (every funded channel is excluded);
//   P2 — a video funded to Google is never a "Created"/success (it's excluded),
//        and the operator-facing copy never repeats the raw matrix's false
//        "We'll upload this to YouTube for you" promise.
//
// FAILS-ON-REVERT (true line-deletion — see the ORCH report):
//   - deleting creativeGate's `if (kind === "video" && !VIDEO_CREATE_ENABLED)`
//     block makes a video channel buildable → the P1/P2 partition tests FAIL;
//   - deleting creativeCopy's youtube_hosted rule falls back to the misleading
//     "won't block the build" copy → the humanize honesty test FAILS.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  partitionFundedCreative,
  VIDEO_CREATE_ENABLED,
} from "../lib/adBuilder/creativeGate.js";
import { humanizeCreativeCheck } from "../lib/adBuilder/creativeCopy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(p, "utf8");

const ALL = ["meta", "tiktok", "snapchat", "google", "reddit"];
const allPassing = ALL.map((platform) => ({ platform, ok: true, needsTranscode: false }));

// ── P1: #1184 narrows the former blanket block to exact READY platforms ──────
describe("ISSUE-995 rework · Phase A video create remains platform-honest", () => {
  // [TEST-MOD-APPROVED ORCH-1185] #997 C/D2 wired TikTok + Google, and #1185 wired
  // Reddit paused-video create — so the "reddit: false" assertion is now superseded
  // too. Every platform is video-creatable.
  it("video create is enabled for every platform (Meta/Snap/TikTok/Google + Reddit via #1185)", () => {
    assert.deepEqual(VIDEO_CREATE_ENABLED, {
      meta: true,
      snapchat: true,
      tiktok: true,
      google: true,
      reddit: true,
    });
  });

  // [TEST-MOD-APPROVED ORCH-1185] Reddit is a NO-PREPARE video platform (#1185): it
  // builds from its #866-hosted clip with no prep row, so a READY Meta/Snap/TikTok
  // set now ALSO includes reddit as buildable; only Google (no ready prep here) stays
  // excluded.
  it("exact READY Meta/Snap/TikTok rows become buildable — reddit joins (no prep needed)", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ALL,
      channels: allPassing,
      kind: "video",
      preparationByPlatform: {
        meta: { state: "ready" },
        snapchat: { state: "ready" },
        tiktok: { state: "ready" },
      },
    });
    assert.deepEqual(buildable.sort(), ["meta", "reddit", "snapchat", "tiktok"]);
    assert.deepEqual(excluded.map((e) => e.platform).sort(), ["google"]);
  });

  it("the partition stays TOTAL for video (buildable ∪ excluded = funded)", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ALL,
      channels: allPassing,
      kind: "video",
      preparationByPlatform: { meta: { state: "ready" } },
    });
    assert.equal(buildable.length + excluded.length, ALL.length);
  });
});

// ── P2: a video on Google never yields a "Created" success without a READY prep ─
describe("ISSUE-995 rework · a video funded to Google is never a fabricated success", () => {
  // [TEST-MOD-APPROVED ORCH-0997] D2 wired Google Demand Gen video create, so a
  // Google video is no longer excluded as approximation_only — but with NO ready
  // preparation it is still EXCLUDED (preparation_not_started), never a fabricated
  // "Created". The no-fake-success invariant holds via the readiness gate.
  it("Google (ok:true) with NO ready prep is EXCLUDED for a video, never buildable → runCreate skips it", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ["google", "meta"],
      channels: [
        { platform: "google", ok: true, needsTranscode: false },
        { platform: "meta", ok: true, needsTranscode: false },
      ],
      kind: "video",
    });
    assert.equal(buildable.includes("google"), false, "Google video must not be buildable without a READY prep");
    const g = excluded.find((e) => e.platform === "google");
    assert.equal(g.reason, "preparation_not_started");
  });

  it("the youtube_hosted check copy is honest — no fabricated 'we'll upload it for you'", () => {
    const h = humanizeCreativeCheck({
      platform: "google",
      rule: "video.youtube_hosted",
      level: "warn",
      confidence: "OFFICIAL",
      message: "We'll upload this to YouTube for you — Google can only run YouTube-hosted video. It'll be unlisted.",
    });
    // The false promise must not appear in the operator-facing copy…
    assert.doesNotMatch(`${h.friendly} ${h.action}`, /we'll upload|upload this to youtube|won't block the build/i);
    // …and it must say Google is skipped / not available.
    assert.match(`${h.friendly} ${h.action}`, /skip|isn't available|not available|coming/i);
    // The raw API-shaped requirement is still preserved for the details toggle.
    assert.match(h.technical, /youtube_hosted/);
  });
});

// ── Image path is UNREGRESSED (no kind, or kind:"image", behaves as before) ──
describe("ISSUE-995 rework · image builds are unaffected", () => {
  const mixed = [
    { platform: "meta", ok: true, needsTranscode: false },
    { platform: "google", ok: false, needsTranscode: false },
  ];

  it("no kind arg → image semantics (a passing channel still builds)", () => {
    const { buildable, excluded } = partitionFundedCreative({ fundedPlatforms: ["meta", "google"], channels: mixed });
    assert.deepEqual(buildable, ["meta"]);
    assert.deepEqual(excluded.map((e) => e.platform), ["google"]);
  });

  it('kind:"image" → identical to no-kind', () => {
    const a = partitionFundedCreative({ fundedPlatforms: ["meta", "google"], channels: mixed });
    const b = partitionFundedCreative({ fundedPlatforms: ["meta", "google"], channels: mixed, kind: "image" });
    assert.deepEqual(a, b);
  });
});

// ── Source wiring (fails-on-revert on the component/page honesty signals) ────
describe("ISSUE-995 rework · component + page honesty wiring", () => {
  const stepCreative = read(path.join(ADMIN_SRC, "components/campaign-builder/StepCreative.jsx"));
  const page = read(path.join(ADMIN_SRC, "pages/CampaignBuilderPage.jsx"));

  it("StepCreative labels Phase A truth and embeds preparation", () => {
    assert.match(stepCreative, /Video Phase A/);
    assert.match(stepCreative, /VideoPreparationPanel/);
  });

  it("StepCreative names the create-capable platforms", () => {
    assert.match(stepCreative, /Meta and Snapchat can build after/);
  });

  it("CampaignBuilderPage passes creative.kind into the build partition", () => {
    assert.match(page, /kind:\s*creative\.kind/);
  });

  it("CampaignBuilderPage gives video its preparation gate reason", () => {
    assert.match(page, /Prepare at least one video platform/);
  });
});
