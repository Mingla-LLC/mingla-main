import { assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(
  new URL("../../admin-ad-create-campaign/index.ts", import.meta.url),
);

Deno.test("#3697 Spark create stays TikTok-only and uses the frozen organic post", () => {
  assertMatch(source, /tiktok_spark_requires_tiktok_placement/);
  assertMatch(source, /tiktok_spark_destination_unsupported/);
  assertMatch(source, /tiktok_spark_event_identity_required/);
  assertMatch(
    source,
    /if \(!usesTikTokSparkT && !imageIdT && !imageUrlT\)/,
  );
  assertMatch(
    source,
    /usesTikTokSparkT \? "tiktok" : body\.tiktok_placement/,
  );
  assertMatch(
    source,
    /const adTextCheckT = usesTikTokSparkT[\s\S]*?validateTikTokAdText\(adTextT\)/,
  );
  assertMatch(source, /assertTikTokSparkPostsOwned/);
});
