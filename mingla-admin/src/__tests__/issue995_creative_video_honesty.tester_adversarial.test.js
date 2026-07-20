// ISSUE-995 [Campaign Builder creative] Wave 3 of #977 — TESTER adversarial suite.
//
// A DIFFERENT ANGLE than the 31-test implementor suite
// (issue995_creative_video_variants.test.js):
//
//   * The implementor's video-payload tests build a video creative whose
//     `imageUrl` is already `null`, then assert `image_url === undefined`. With
//     a null source they can NEVER catch a *stale, non-null* image_url leaking
//     into a video payload — the exact silent-downgrade-to-an-image-ad hazard.
//   * They assert the video payload SHAPE, but never check that honest shape
//     against what the create endpoint actually ACCEPTS (the #997 VIDEO-CREATE
//     WIRING GAP): Meta's create block reads only image_url | image_hash |
//     video_id and IGNORES creative_library_id + kind (admin-ad-create-campaign
//     /index.ts:2443-2451).
//   * Their proceed-with-passing test uses a MIXED set with one buildable
//     channel; they never pin the safety FLOOR (all funded channels failing ⇒
//     no build-0) nor partition TOTALITY (a funded channel silently dropped
//     from BOTH buildable and excluded would be BUILT by runCreate — which
//     skips only `excluded` — forcing a rejected creative through).
//
// This suite attacks those three gaps. Grounded by live payload/partition
// introspection; fails-on-revert verified by true line-deletion of the
// payload.js videoRef block and creativeGate.creativeReady's needsTranscode
// clause.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildCreatePayload } from "../lib/adBuilder/payload.js";
import { partitionFundedCreative, creativeReady } from "../lib/adBuilder/creativeGate.js";

// ── Shared fixture ──────────────────────────────────────────────────────────
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

const ALL_PLATFORMS = ["meta", "tiktok", "reddit", "snapchat", "google"];
const STALE = "https://stale-image-from-a-prior-image-pick.jpg";

// A video creative that ALSO carries a leftover, non-null imageUrl — the
// adversarial state the implementor's null-imageUrl fixture cannot exercise.
const staleVideoCreative = {
  kind: "video",
  imageUrl: STALE,
  creativeLibraryId: "cr-lib-1",
  aiGenerated: true,
  brandName: "Brand",
};

// ── A. VIDEO HONESTY: a stale image_url NEVER leaks into a video payload ─────
describe("ISSUE-995 tester-adversarial · a video is never silently downgraded to an image ad", () => {
  for (const platform of ALL_PLATFORMS) {
    it(`${platform}: a non-null stale imageUrl NEVER appears anywhere in the video creative`, () => {
      const p = buildCreatePayload(platform, baseState(staleVideoCreative));
      // The stale URL must not survive as image_url…
      assert.equal(p.creative.image_url, undefined, `${platform} leaked a stale image_url onto a video`);
      // …nor hidden under any other creative key (deep scan of the whole node).
      assert.equal(
        JSON.stringify(p.creative).includes(STALE),
        false,
        `${platform} smuggled the stale image URL into the video creative`,
      );
      // The honest video marker is present.
      assert.equal(p.creative.kind, "video", `${platform} video must be marked kind:"video"`);
    });
  }
});

// ── B. CREATE-COMPATIBILITY CONTRACT (documents the #997 gap) ───────────────
// admin-ad-create-campaign/index.ts (Meta branch, lines 2446-2451) accepts a
// media descriptor ONLY via one of these keys; it never reads creative_library_id
// or kind. Encoded verbatim so the contract is explicit here.
const META_CREATE_ACCEPTED_MEDIA_KEYS = ["image_url", "image_hash", "video_id"];

describe("ISSUE-995 tester-adversarial · honest video shape is create-incompatible; image is create-compatible", () => {
  it("IMAGE meta payload carries a usable image_url (create-compatible, unregressed)", () => {
    const img = { kind: "image", imageUrl: "https://cdn/real.jpg", creativeLibraryId: "cr-lib-1", aiGenerated: true, brandName: "Brand" };
    const p = buildCreatePayload("meta", baseState(img));
    const present = META_CREATE_ACCEPTED_MEDIA_KEYS.filter((k) => typeof p.creative[k] === "string" && p.creative[k]);
    assert.ok(present.includes("image_url"), "image meta payload must carry image_url the create endpoint accepts");
    assert.equal(p.creative.image_url, "https://cdn/real.jpg");
  });

  it("VIDEO meta payload carries NONE of Meta's accepted media keys → create returns creative_media_required", () => {
    const p = buildCreatePayload("meta", baseState(staleVideoCreative));
    const present = META_CREATE_ACCEPTED_MEDIA_KEYS.filter((k) => typeof p.creative[k] === "string" && p.creative[k]);
    // The library ref is the ONLY media descriptor a video carries — and Meta's
    // create block ignores it. This is the documented #997 wiring gap: the shape
    // is HONEST (no fake image), but it cannot yet create a video ad on Meta.
    assert.deepEqual(present, [], "a video meta payload must not carry any create-accepted image media");
    assert.equal(p.creative.creative_library_id, "cr-lib-1", "the video's only media ref is the library id (which Meta create ignores)");
  });
});

// ── C. PROCEED-WITH-PASSING SAFETY FLOOR + partition totality ───────────────
describe("ISSUE-995 tester-adversarial · all-failing cannot build (no build-0) and the partition is total", () => {
  // Every funded channel fails, one of them via the ok:true+needsTranscode trap.
  const allFailing = [
    { platform: "meta", ok: false, needsTranscode: false },      // hard reject
    { platform: "tiktok", ok: true, needsTranscode: true },      // needs_transcode (ok:true trap)
    { platform: "snapchat", ok: false, needsTranscode: false },  // hard reject
    // reddit deliberately absent from channels → not_validated
  ];
  const funded = ["meta", "tiktok", "snapchat", "reddit"];

  it("all funded channels failing ⇒ buildable is EMPTY (no build-0 slips through)", () => {
    const { buildable } = partitionFundedCreative({ fundedPlatforms: funded, channels: allFailing });
    assert.deepEqual(buildable, [], "no channel may be buildable when every funded channel fails");
  });

  it("the partition is TOTAL — no funded channel is silently dropped from both sides", () => {
    const { buildable, excluded } = partitionFundedCreative({ fundedPlatforms: funded, channels: allFailing });
    const covered = new Set([...buildable, ...excluded.map((e) => e.platform)]);
    for (const platform of funded) {
      assert.ok(covered.has(platform), `${platform} was dropped from BOTH buildable and excluded — runCreate would build it`);
    }
    assert.equal(buildable.length + excluded.length, funded.length, "buildable ∪ excluded must exactly cover the funded set");
  });

  it("the needs_transcode trap channel (ok:true) is EXCLUDED, never buildable", () => {
    const { buildable, excluded } = partitionFundedCreative({ fundedPlatforms: funded, channels: allFailing });
    assert.equal(buildable.includes("tiktok"), false, "an ok:true+needs_transcode channel must not be built");
    const tt = excluded.find((e) => e.platform === "tiktok");
    assert.equal(tt?.reason, "needs_transcode");
    assert.equal(creativeReady({ platform: "tiktok", ok: true, needsTranscode: true }), false);
  });
});
