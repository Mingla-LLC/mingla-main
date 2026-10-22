import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertTikTokSparkPostsOwned,
  tiktokSparkSelection,
} from "../adTikTokSpark.ts";

const A = "7462384762384762384";
const B = "7462384762384762385";

Deno.test("#3697 uses one reviewed @usemingla post set across enabled stages", () => {
  assertEquals(tiktokSparkSelection({ tiktok_spark_post_ids: [A, B, A] }), {
    present: true,
    ok: true,
    ids: [A, B],
  });
});

Deno.test("#3697 Spark selection is 2–4 provider-shaped post ids", () => {
  for (const value of [[A], [A, "browser-made"], [A, B, "3", "4", "5"]]) {
    assertEquals(
      tiktokSparkSelection({ tiktok_spark_post_ids: value }).ok,
      false,
    );
  }
});

Deno.test("#3697 create re-reads ownership instead of trusting the browser", () => {
  assertTikTokSparkPostsOwned([A, B], [A, B]);
  assertThrows(
    () => assertTikTokSparkPostsOwned([A, B], [A]),
    Error,
    `tiktok_spark_post_not_owned:${B}`,
  );
});
