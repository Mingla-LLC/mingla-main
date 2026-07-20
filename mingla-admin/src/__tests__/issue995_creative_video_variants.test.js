// ISSUE-995 [Campaign Builder creative] Wave 3 of #977 — the IMPLEMENTOR
// happy-path regression suite (node:test — pure ESM logic + fs source
// assertions, the house admin pattern; the tester writes a separate adversarial
// angle).
//
// What this pins (ISSUE-977 Lane F, Seth finding #7):
//   1. VIDEO reaches the create payload as a library REF (creative_library_id +
//      kind:"video"), never an inline image_url; image payloads are unchanged.
//   2. PER-PLACEMENT report: a 9:16-only master PASSES Reels 9:16 and FAILS
//      Feed 1:1 — the placement-granular answer the per-platform matrix can't give.
//   3. PROCEED-WITH-PASSING: the funded set partitions into buildable vs
//      excluded, so a reject on one channel doesn't block the build.
//   4. needs_transcode is NOT "ready" (it's excluded), reconciling the matrix
//      `ok` vs resolveCreativeRef-blocks-needs_transcode mismatch.
//   5. VARIANT SLOTS: a covering pre-cropped variant makes a placement pass;
//      StepCreative sends `variants` to the byte-probe.
//   6. HUMANIZED rejects: the raw "550px < 600px floor / ratio 0.5046 [OFFICIAL]"
//      jargon becomes plain guidance, with the raw kept in `technical`.
//
// FAILS-ON-REVERT (proven by true line-deletion — see the ORCH report):
//   - deleting payload.js's videoRef block fails the video-payload tests;
//   - deleting creativeGate.creativeReady's `!needsTranscode` clause fails the
//     needs_transcode-not-ready test;
//   - deleting placements.placementVerdict's ratio-mismatch/variant branches
//     fails the per-placement + variant tests;
//   - deleting a creativeCopy RULE_PATTERN fails the humanize tests;
//   - reverting the StepCreative/CampaignBuilderPage wiring fails the source
//     assertions.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildCreatePayload } from "../lib/adBuilder/payload.js";
import {
  perPlacementReport,
  placementVerdict,
  placementSummaryByPlatform,
  placementsForPlatform,
  classifyRatio,
} from "../lib/adBuilder/placements.js";
import {
  creativeReady,
  creativeExclusionReason,
  partitionFundedCreative,
} from "../lib/adBuilder/creativeGate.js";
import { humanizeCreativeCheck } from "../lib/adBuilder/creativeCopy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(p, "utf8");

// ── Shared payload fixture ──────────────────────────────────────────────────
const goal = {
  metaObjective: "OUTCOME_TRAFFIC",
  metaOptimizationGoal: "LINK_CLICKS",
  platforms: {
    tiktok: { objective: "TRAFFIC" },
    reddit: { objective: "CLICKS" },
    snapchat: { objective: "TRAFFIC", optimization_goal: "SWIPES" },
    google: { objective: "SEARCH" },
  },
};
const baseState = (creative) => ({
  lane: "consumer",
  name: "Test campaign",
  goal,
  destination: { page_type: "event", brand_slug: "brand", entity_slug: "event" },
  audience: { countries: ["US"], cities: [], interests: [], ageMin: 18, ageMax: 65, gender: "all", radius: 10, distanceUnit: "mile" },
  budget: { dailyCentsForChannel: 1000 },
  copy: { primary: "come out", headline: "hey", description: "desc", cta: "LEARN_MORE", googleHeadlines: ["h1"], googleDescriptions: ["d1"], keywords: ["k1"], negativeKeywords: [] },
  specialAdCategory: "NONE",
  requestId: "req-1",
  creative,
});

const imageCreative = { kind: "image", imageUrl: "https://cdn/img.jpg", creativeLibraryId: "cr-lib-1", aiGenerated: true, brandName: "Brand" };
const videoCreative = { kind: "video", imageUrl: null, creativeLibraryId: "cr-lib-1", aiGenerated: true, brandName: "Brand" };

// ── 1. VIDEO reaches the payload as a library ref, image is unchanged ────────
describe("ISSUE-995 · video reaches the create payload as a library ref", () => {
  for (const platform of ["meta", "tiktok", "reddit", "snapchat", "google"]) {
    it(`${platform}: video sends creative_library_id + kind:"video" and NO image_url`, () => {
      const p = buildCreatePayload(platform, baseState(videoCreative));
      assert.equal(p.creative.kind, "video", `${platform} video payload must mark kind:"video"`);
      assert.equal(p.creative.creative_library_id, "cr-lib-1");
      assert.equal(p.creative.image_url, undefined, `${platform} video payload must NOT carry an inline image_url`);
    });
  }

  it("meta: image payload is unchanged (image_url present, no kind:video)", () => {
    const p = buildCreatePayload("meta", baseState(imageCreative));
    assert.equal(p.creative.image_url, "https://cdn/img.jpg");
    assert.notEqual(p.creative.kind, "video");
  });

  it("tiktok: image payload keeps image_url + optional library ref", () => {
    const p = buildCreatePayload("tiktok", baseState(imageCreative));
    assert.equal(p.creative.image_url, "https://cdn/img.jpg");
    assert.equal(p.creative.creative_library_id, "cr-lib-1");
    assert.notEqual(p.creative.kind, "video");
  });

  it("a video with no recorded row sends no creative_library_id (backend fails-close)", () => {
    const p = buildCreatePayload("tiktok", baseState({ kind: "video", creativeLibraryId: null, aiGenerated: true }));
    assert.equal(p.creative.kind, "video");
    assert.equal(p.creative.creative_library_id, undefined);
    assert.equal(p.creative.image_url, undefined);
  });
});

// ── 2. PER-PLACEMENT: a 9:16 master passes Reels, fails Feed 1:1 ─────────────
describe("ISSUE-995 · per-placement pass/fail (the answer per-platform can't give)", () => {
  const probe916 = { aspect_ratio: 0.5625, width: 1080, height: 1920 }; // 9:16

  it("a 9:16-only master PASSES Meta Stories & Reels and FAILS Meta Feed (1:1)", () => {
    const report = perPlacementReport({ probe: probe916, platforms: ["meta"] });
    const reels = report.find((r) => r.id === "meta_reels_9x16");
    const feed = report.find((r) => r.id === "meta_feed_1x1");
    assert.equal(reels.ok, true, "9:16 fits Stories & Reels");
    assert.equal(reels.status, "pass");
    assert.equal(feed.ok, false, "9:16 does NOT fit the square feed");
    assert.equal(feed.status, "crop");
  });

  it("placementSummaryByPlatform splits passing vs failing placements", () => {
    const report = perPlacementReport({ probe: probe916, platforms: ["meta"] });
    const [meta] = placementSummaryByPlatform(report);
    assert.ok(meta.passing.some((v) => v.id === "meta_reels_9x16"));
    assert.ok(meta.failing.some((v) => v.id === "meta_feed_1x1"));
  });

  it("a right-ratio-but-small master is flagged 'small', not 'pass'", () => {
    const tiny = { aspect_ratio: 1, width: 200, height: 200 }; // 1:1 but below Meta 600 floor
    const feed = placementVerdict(placementsForPlatform("meta").find((p) => p.id === "meta_feed_1x1"), tiny, []);
    assert.equal(feed.status, "small");
    assert.equal(feed.ok, false);
  });

  it("no probe → empty report (never fabricated)", () => {
    assert.deepEqual(perPlacementReport({ probe: null, platforms: ["meta"] }), []);
  });

  it("classifyRatio matches the matrix relative-delta device", () => {
    assert.equal(classifyRatio(0.5625, ["9:16", "1:1"]), "9:16");
    assert.equal(classifyRatio(0.5046, ["9:16", "1:1", "1.91:1"]), null); // Seth's 0.5046 case: off-list
  });
});

// ── 3+4. PROCEED-WITH-PASSING + needs_transcode reconciliation ──────────────
describe("ISSUE-995 · proceed-with-passing + needs_transcode is not 'ready'", () => {
  const channels = [
    { platform: "meta", ok: true, needsTranscode: false },
    { platform: "tiktok", ok: false, needsTranscode: false },
    { platform: "snapchat", ok: true, needsTranscode: true },
  ];

  it("partitions funded channels into buildable vs excluded", () => {
    const { buildable, excluded } = partitionFundedCreative({
      fundedPlatforms: ["meta", "tiktok", "snapchat"],
      channels,
    });
    assert.deepEqual(buildable, ["meta"]);
    assert.deepEqual(excluded.map((e) => e.platform).sort(), ["snapchat", "tiktok"]);
  });

  it("a needs_transcode channel is NOT ready (resolveCreativeRef blocks it at create)", () => {
    assert.equal(creativeReady({ platform: "snapchat", ok: true, needsTranscode: true }), false);
    assert.equal(creativeExclusionReason({ platform: "snapchat", ok: true, needsTranscode: true }), "needs_transcode");
  });

  it("a hard-reject channel is excluded as 'blocked'", () => {
    assert.equal(creativeReady({ platform: "tiktok", ok: false, needsTranscode: false }), false);
    assert.equal(creativeExclusionReason({ platform: "tiktok", ok: false, needsTranscode: false }), "blocked");
  });

  it("an unvalidated funded channel is excluded, never silently built", () => {
    const { buildable, excluded } = partitionFundedCreative({ fundedPlatforms: ["reddit"], channels });
    assert.deepEqual(buildable, []);
    assert.equal(excluded[0].reason, "not_validated");
  });
});

// ── 5. VARIANT SLOTS: a covering variant makes a placement pass ─────────────
describe("ISSUE-995 · variant slots rescue an off-ratio master", () => {
  const probe916 = { aspect_ratio: 0.5625, width: 1080, height: 1920 };

  it("a 1:1 variant makes Meta Feed (1:1) pass despite a 9:16 master", () => {
    const feed = placementsForPlatform("meta").find((p) => p.id === "meta_feed_1x1");
    const withoutVariant = placementVerdict(feed, probe916, []);
    const withVariant = placementVerdict(feed, probe916, ["1:1"]);
    assert.equal(withoutVariant.ok, false);
    assert.equal(withVariant.ok, true);
    assert.equal(withVariant.status, "variant");
  });

  it("the report reflects variants passed through", () => {
    const report = perPlacementReport({ probe: probe916, platforms: ["meta"], variantRatios: ["1:1"] });
    const feed = report.find((r) => r.id === "meta_feed_1x1");
    assert.equal(feed.ok, true);
  });
});

// ── 6. HUMANIZED rejects ────────────────────────────────────────────────────
describe("ISSUE-995 · reject copy is humanized (raw kept behind a toggle)", () => {
  it("min_width reject becomes plain guidance, no rule id / confidence tag in friendly", () => {
    const h = humanizeCreativeCheck({
      platform: "meta",
      rule: "image.min_width",
      level: "reject",
      confidence: "OFFICIAL",
      message: "This image is 550px wide — Meta's API floor is 600px width.",
    });
    assert.doesNotMatch(h.friendly, /image\.min_width|OFFICIAL|550/);
    assert.match(h.friendly, /small|smaller|resolution/i);
    assert.match(h.action, /higher|larger|resolution/i);
    assert.match(h.technical, /image\.min_width/);
    assert.match(h.technical, /\[OFFICIAL\]/);
  });

  it("ratio reject points at cropping / variants in plain English", () => {
    const h = humanizeCreativeCheck({
      platform: "meta",
      rule: "image.ratio",
      level: "needs_transcode",
      confidence: "OFFICIAL",
      message: "Ratio 0.5046 is not one of Meta's 4:5 / 1:1 / 1.91:1 / 9:16.",
    });
    assert.doesNotMatch(h.friendly, /0\.5046|OFFICIAL|image\.ratio/);
    assert.match(`${h.friendly} ${h.action}`, /crop|variant|shape/i);
  });

  it("audio_required reject is plain + actionable", () => {
    const h = humanizeCreativeCheck({
      platform: "tiktok",
      rule: "video.audio_required",
      level: "reject",
      confidence: "OFFICIAL",
      message: "This video has no sound…",
    });
    assert.match(h.friendly, /sound|audio/i);
    assert.match(h.action, /soundtrack|voiceover|audio/i);
  });

  it("badge maps tiers: reject→error, needs_transcode→warning, pass→success", () => {
    assert.equal(humanizeCreativeCheck({ level: "reject" }).badge, "error");
    assert.equal(humanizeCreativeCheck({ level: "needs_transcode" }).badge, "warning");
    assert.equal(humanizeCreativeCheck({ level: "pass" }).badge, "success");
  });
});

// ── Source assertions — the component/page wiring (fails-on-revert) ─────────
describe("ISSUE-995 · component + page wiring", () => {
  const stepCreative = read(path.join(ADMIN_SRC, "components/campaign-builder/StepCreative.jsx"));
  const page = read(path.join(ADMIN_SRC, "pages/CampaignBuilderPage.jsx"));
  const payload = read(path.join(ADMIN_SRC, "lib/adBuilder/payload.js"));

  it("StepCreative offers an image|video kind toggle", () => {
    assert.match(stepCreative, /creative-kind-/);
    assert.match(stepCreative, /kind:\s*"image"/);
    assert.match(stepCreative, /kind:\s*"video"/);
  });

  it("StepCreative sends the video refs to the byte-probe", () => {
    assert.match(stepCreative, /bunny_video_id:\s*creative\.bunnyVideoId/);
    assert.match(stepCreative, /poster_url:\s*creative\.posterUrl/);
    assert.match(stepCreative, /mp4_master_url:\s*creative\.mp4MasterUrl/);
  });

  it("StepCreative sends variant slots to the byte-probe", () => {
    assert.match(stepCreative, /variants/);
    assert.match(stepCreative, /variantsPayload/);
  });

  it("StepCreative renders humanized checks + per-placement report", () => {
    assert.match(stepCreative, /humanizeCreativeCheck/);
    assert.match(stepCreative, /perPlacementReport/);
    assert.match(stepCreative, /Technical details/);
  });

  it("CampaignBuilderPage gates on proceed-with-passing, not every()", () => {
    assert.match(page, /partitionFundedCreative/);
    assert.match(page, /creativePartition\.buildable\.length\s*>\s*0/);
    assert.doesNotMatch(page, /\.every\(\(c\)\s*=>\s*c\.ok\)/);
  });

  it("CampaignBuilderPage skips excluded channels in runCreate", () => {
    assert.match(page, /creativeExcluded\.has\(platform\)/);
  });

  it("CampaignBuilderPage passes creative.kind into the payload", () => {
    assert.match(page, /kind:\s*creative\.kind/);
  });

  it("payload.js builds a videoRef and omits image_url for video", () => {
    assert.match(payload, /creativeIsVideo\s*=\s*creative\?\.kind\s*===\s*"video"/);
    assert.match(payload, /videoRef/);
  });
});
