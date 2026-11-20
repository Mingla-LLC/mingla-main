import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  snapchatAdSquadStatsPath,
  snapchatStatsWindow,
} from "../snapchatSpendStats.ts";

Deno.test("#3697 Snap stage stats request is ad-squad scoped and complete", () => {
  const window = snapchatStatsWindow(
    "UTC",
    new Date("2026-10-22T12:00:00Z"),
  );
  const path = snapchatAdSquadStatsPath("squad/id", window);
  assert(path.startsWith("adsquads/squad%2Fid/stats?"));
  const params = new URLSearchParams(path.split("?")[1]);
  assertEquals(params.get("granularity"), "DAY");
  const fields = new Set((params.get("fields") ?? "").split(","));
  for (
    const field of [
      "spend",
      "impressions",
      "swipes",
      "conversion_purchases",
      "conversion_page_views",
    ]
  ) {
    assert(fields.has(field), `missing ${field}`);
  }
});

// #4238 AC 11: Snap rejects uniques-type stats (reach, frequency) at DAY
// granularity; asking for them failed the whole call and no Snapchat stage
// rows landed.
Deno.test("#4238 Snap ad-squad stats never ask for reach or frequency", () => {
  const window = snapchatStatsWindow("UTC", new Date("2026-11-19T12:00:00Z"));
  const params = new URLSearchParams(
    snapchatAdSquadStatsPath("squad", window).split("?")[1],
  );
  const fields = new Set((params.get("fields") ?? "").split(","));
  assert(!fields.has("reach"), "reach must not be requested");
  assert(!fields.has("frequency"), "frequency must not be requested");
});
