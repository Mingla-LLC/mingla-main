// MINGLA-INVARIANT: I-4238-META-VERTICAL-VIDEO | issue #4238 | a Host video uploaded only as 9:16 reaches Meta as one ordinary video ad (video_data) instead of being refused for missing 1:1 / 4:5 placement stills.
/**
 * #4238 — Tinoe's Yard trial (18 Nov 2026). Every Host video is vertical
 * (aspect 0.5625) with no square or 4:5 stills, so admin-ad-create-campaign
 * refused Meta create with meta_placement_variants_required ["1:1","4:5"]
 * and no Host video ad could reach Meta.
 *
 * FAILS-ON-REVERT:
 *  - fillMetaPlacementsFromVerticalVideo must fill empty 1:1 / 4:5 slots with
 *    the vertical video, and leave images and real stills alone.
 *  - buildMetaCreativeBody must send one video in every slot as video_data,
 *    with no asset_feed_spec.
 *  - both create paths in admin-ad-create-campaign must call the filler
 *    before deciding coverage is missing.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildMetaCreativeBody,
  fillMetaPlacementsFromVerticalVideo,
  type MetaPlacementAssets,
  singleMetaPlacementVideo,
} from "../meta.ts";

const video = {
  kind: "video" as const,
  videoId: "vid_ty01",
  thumbnailImageHash: "thumb_1",
};

Deno.test("#4238 a vertical-only video fills the square and 4:5 slots", () => {
  const filled = fillMetaPlacementsFromVerticalVideo({ "9:16": video });
  assertEquals(filled, { "1:1": video, "4:5": video, "9:16": video });
  assertEquals(singleMetaPlacementVideo(filled as MetaPlacementAssets), video);
});

Deno.test("#4238 real stills and image creatives are left alone", () => {
  const square = {
    kind: "image" as const,
    imageUrl: "https://media.example/sq.jpg",
  };
  const portrait = {
    kind: "image" as const,
    imageUrl: "https://media.example/45.jpg",
  };
  const withStills = { "1:1": square, "4:5": portrait, "9:16": video };
  assertEquals(fillMetaPlacementsFromVerticalVideo(withStills), withStills);
  assertEquals(singleMetaPlacementVideo(withStills), null);

  const partial = fillMetaPlacementsFromVerticalVideo({
    "1:1": square,
    "9:16": video,
  });
  assertEquals(partial, { "1:1": square, "4:5": video, "9:16": video });
  assertEquals(singleMetaPlacementVideo(partial as MetaPlacementAssets), null);

  const image = {
    kind: "image" as const,
    imageUrl: "https://media.example/v.jpg",
  };
  assertEquals(fillMetaPlacementsFromVerticalVideo({ "9:16": image }), {
    "9:16": image,
  });
  assertEquals(fillMetaPlacementsFromVerticalVideo({}), {});
});

Deno.test("#4238 one video everywhere is sent as an ordinary video ad", () => {
  const body = buildMetaCreativeBody("page_1", {
    destUrl: "https://host.usemingla.com/e/tinoes-yard/2nd-edition",
    message: "Last tickets",
    headline: "Tinoe's Yard",
    metaPlacementAssets: { "1:1": video, "4:5": video, "9:16": video },
    callToActionType: "BUY_TICKETS",
  });
  const spec = body.object_story_spec as Record<
    string,
    Record<string, unknown>
  >;
  assertEquals(spec.video_data.video_id, "vid_ty01");
  assertEquals(spec.video_data.image_hash, "thumb_1");
  assertEquals(body.asset_feed_spec, undefined);
  const cta = spec.video_data.call_to_action as Record<
    string,
    Record<string, unknown>
  >;
  assertEquals(
    cta.value.link,
    "https://host.usemingla.com/e/tinoes-yard/2nd-edition",
  );
});

Deno.test("#4238 mixed placements still use the placement asset feed", () => {
  const body = buildMetaCreativeBody("page_1", {
    destUrl: "https://host.usemingla.com/e/b/e",
    message: "m",
    metaPlacementAssets: {
      "1:1": { kind: "image", imageUrl: "https://media.example/sq.jpg" },
      "4:5": { kind: "image", imageUrl: "https://media.example/45.jpg" },
      "9:16": video,
    },
  });
  assert(body.asset_feed_spec, "asset_feed_spec kept for real stills");
  const spec = body.object_story_spec as Record<string, unknown>;
  assertEquals(spec.video_data, undefined);
});

Deno.test("#4238 both create paths fill from the vertical video before refusing", async () => {
  const source = await Deno.readTextFile(
    new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
  );
  const stage = source.indexOf("stage_creative_meta_coverage:");
  const single = source.indexOf("const missingMetaRatios");
  assert(stage > 0 && single > 0);
  const stageFill = source.lastIndexOf(
    "fillMetaPlacementsFromVerticalVideo(assets)",
    stage,
  );
  const singleFill = source.lastIndexOf(
    "fillMetaPlacementsFromVerticalVideo(resolvedPlacementAssets)",
    single,
  );
  assert(
    stageFill > 0 && stage - stageFill < 600,
    "stage path fills before coverage check",
  );
  assert(
    singleFill > 0 && single - singleFill < 400,
    "single path fills before coverage check",
  );
});
