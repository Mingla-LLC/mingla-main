import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AdApiError } from "../adChannelCore.ts";
import { buildSnapchatAdSquadBody } from "../snapchat.ts";
import { tiktokPlacementsForCreative } from "../tiktok.ts";

Deno.test("#3697 every Snap ad squad carries the configured pixel", () => {
  const body = buildSnapchatAdSquadBody(
    "d0ef28bd-30da-42f4-a313-7327a8359df0",
    {
      name: "traffic",
      optimizationGoal: "SWIPES",
      countries: ["NG"],
      budgetCents: 500,
      pixelId: "af5f8fc4-1ef6-41e7-81c5-042b7be7df38",
    },
  );
  assertEquals(body.pixel_id, "af5f8fc4-1ef6-41e7-81c5-042b7be7df38");
});

Deno.test("#3697 TikTok-only placement is video-only; Pangle explicitly admits images", () => {
  assertEquals(tiktokPlacementsForCreative("tiktok", "video"), [
    "PLACEMENT_TIKTOK",
  ]);
  assertEquals(tiktokPlacementsForCreative("tiktok_pangle", "image"), [
    "PLACEMENT_TIKTOK",
    "PLACEMENT_PANGLE",
  ]);
  const error = assertThrows(
    () => tiktokPlacementsForCreative("tiktok", "image"),
    AdApiError,
  );
  assertEquals((error as AdApiError).code, "tiktok_video_required");
  assertEquals(
    (error as AdApiError).message,
    "TikTok placement needs a video creative. Select TikTok + Pangle to use an image.",
  );
});
