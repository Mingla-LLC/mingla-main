import {
  assertEquals,
  assertObjectMatch,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AdApiError } from "../adChannel.ts";
import {
  buildTikTokAdBody,
  tiktokFetchSparkPosts,
  tiktokSparkPostsFromResponse,
} from "../tiktok.ts";

const CLIENT = {
  platform: "tiktok" as const,
  token: "secret-never-log",
  advertiserId: "7627974536397766673",
  apiBase: "https://business-api.tiktok.com",
  apiVersion: "v1.3",
};

Deno.test("#3697 normalizes only real @usemingla Spark post ids", () => {
  const result = tiktokSparkPostsFromResponse({
    cursor: "next",
    has_more: true,
    video_list: [{
      item_id: "7462384762384762384",
      item_type: "VIDEO",
      text: "Mingla tonight",
      status: "AVAILABLE",
      video_info: {
        poster_url: "https://example.com/poster.jpg",
        preview_url: "https://example.com/preview.mp4",
        duration: 12.5,
      },
    }, { item_id: "not-a-provider-id" }],
  });
  assertEquals(result.posts.length, 1);
  assertObjectMatch(result.posts[0], {
    itemId: "7462384762384762384",
    text: "Mingla tonight",
    durationSeconds: 12.5,
  });
  assertEquals(result.cursor, "next");
  assertEquals(result.hasMore, true);
});

Deno.test("#3697 reads linked TT_USER posts without a provider write", async () => {
  let seenUrl = "";
  let seenMethod = "";
  const result = await tiktokFetchSparkPosts(CLIENT, {
    identityId: "b3f0f8f4-1beb-5c23-8a2c-9f440cec58a5",
  }, {
    fetchImpl: (url, init) => {
      seenUrl = String(url);
      seenMethod = init?.method ?? "";
      return Promise.resolve(
        new Response(
          JSON.stringify({
            code: 0,
            message: "OK",
            data: {
              video_list: [{
                item_id: "7462384762384762384",
                item_type: "VIDEO",
                text: "Tonight",
              }],
            },
          }),
          { status: 200 },
        ),
      );
    },
  });
  assertEquals(seenMethod, "GET");
  assertEquals(
    seenUrl.includes("/open_api/v1.3/identity/video/get/"),
    true,
  );
  assertEquals(seenUrl.includes("identity_type=TT_USER"), true);
  assertEquals(result.posts.map((post) => post.itemId), [
    "7462384762384762384",
  ]);
});

Deno.test("#3697 Spark Pull uses the organic post and stays paused", () => {
  const body = buildTikTokAdBody(
    CLIENT.advertiserId,
    "7462384762384762000",
    {
      adName: "@usemingla organic post",
      identityType: "TT_USER",
      identityId: "b3f0f8f4-1beb-5c23-8a2c-9f440cec58a5",
      tiktokItemId: "7462384762384762384",
      imageIds: [],
      adText: "",
      landingPageUrl: "https://usemingla.com/e/tonight",
      callToAction: "Get tickets",
    },
  );
  const creative = (body.creatives as Record<string, unknown>[])[0];
  assertObjectMatch(creative, {
    identity_type: "TT_USER",
    tiktok_item_id: "7462384762384762384",
    operation_status: "DISABLE",
  });
  assertEquals("video_id" in creative, false);
  assertEquals("image_ids" in creative, false);
  assertEquals("ad_text" in creative, false);
});

Deno.test("#3697 Spark Pull rejects a browser-invented post id", async () => {
  await assertRejects(
    () =>
      Promise.resolve().then(() =>
        buildTikTokAdBody(CLIENT.advertiserId, "7462384762384762000", {
          adName: "bad post",
          identityType: "TT_USER",
          identityId: "b3f0f8f4-1beb-5c23-8a2c-9f440cec58a5",
          tiktokItemId: "not-real",
          imageIds: [],
          adText: "",
          landingPageUrl: "https://usemingla.com/e/tonight",
        })
      ),
    AdApiError,
    "existing @usemingla TikTok post ID",
  );
});
