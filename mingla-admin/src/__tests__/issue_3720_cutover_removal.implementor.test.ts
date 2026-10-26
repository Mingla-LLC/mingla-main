import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { redirectHash } from "../lib/adminRoutes.js";
import { pageTabFromHash } from "../lib/supportCommunityTabs.js";

// MINGLA-INVARIANT: I-3720-CUTOVER-ROUTE-RETIREMENT | issue #3720 | Cutover deep links resolve to a safe page instead of rendering an unavailable panel (#4130 Wave 6: the Support inbox, since Overview was retired).
Deno.test("#3720 retired Cutover links land on the Support inbox", () => {
  // #4130 Wave 6: was "land on Overview"; the console split into Support and
  // Community, and an unknown or retired console tab opens Support's inbox.
  assertEquals(redirectHash("#/community-support?tab=cutover"), "#/support");
  assertEquals(pageTabFromHash("#/support?tab=cutover", "support"), "support");
  assertEquals(pageTabFromHash("#/community?tab=cutover", "community"), "announcements");
  assertEquals(redirectHash("#/community-support?tab=support"), "#/support");
});
