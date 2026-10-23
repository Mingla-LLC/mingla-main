import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compatibleMetaValidateReference } from "../metaValidateReference.ts";

Deno.test("#3697 Meta validate-only skips a newer campaign with a different goal", () => {
  const reference = compatibleMetaValidateReference([
    {
      external_campaign_id: "recent-link-clicks",
      ad_sets: [{ optimization_goal: "LINK_CLICKS" }],
    },
    {
      external_campaign_id: "older-landing-page-views",
      ad_sets: [{ optimization_goal: "LANDING_PAGE_VIEWS" }],
    },
  ], "LANDING_PAGE_VIEWS");

  assertEquals(reference, "older-landing-page-views");
});

Deno.test("#3697 Meta validate-only refuses mixed-goal and empty reference campaigns", () => {
  const reference = compatibleMetaValidateReference([
    {
      external_campaign_id: "mixed-cbo",
      ad_sets: [
        { optimization_goal: "LANDING_PAGE_VIEWS" },
        { optimization_goal: "LINK_CLICKS" },
      ],
    },
    { external_campaign_id: "no-local-ad-sets", ad_sets: [] },
    {
      external_campaign_id: "only-link-clicks",
      ad_sets: [{ optimization_goal: "LINK_CLICKS" }],
    },
  ], "LANDING_PAGE_VIEWS");

  assertEquals(reference, null);
});
