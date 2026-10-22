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
      "reach",
      "frequency",
      "conversion_purchases",
      "conversion_page_views",
    ]
  ) {
    assert(fields.has(field), `missing ${field}`);
  }
});
