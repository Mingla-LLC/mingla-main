import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { communitySupportTabFromHash } from "../lib/communitySupportNavigation.js";

// MINGLA-INVARIANT: I-3720-CUTOVER-ROUTE-RETIREMENT | issue #3720 | Cutover deep links resolve to the safe Overview section instead of rendering an unavailable panel.
Deno.test("#3720 retired Cutover links land on Overview", () => {
  const visibleTabs = new Set([
    "overview",
    "announcements",
    "roadmap",
    "moderation",
    "support",
    "product",
    "feature-guide",
    "brand-groups",
    "email",
    "team",
    "availability",
  ]);

  assertEquals(
    communitySupportTabFromHash("#/community-support?tab=cutover", visibleTabs),
    "overview",
  );
  assertEquals(
    communitySupportTabFromHash("#/community-support?tab=support", visibleTabs),
    "support",
  );
});
