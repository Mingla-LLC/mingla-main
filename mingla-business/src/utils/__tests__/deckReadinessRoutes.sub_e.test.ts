import { describe, expect, test } from "@jest/globals";

import {
  DECK_READINESS_FIX_TO_FOCUS,
  routeForDeckReadinessFix,
} from "../deckReadinessRoutes";

describe("META-ORCH-1009 Sub-E deck-readiness fix routing", () => {
  test("maps every bouncer fix to the durable resume route with context", () => {
    expect(DECK_READINESS_FIX_TO_FOCUS).toEqual({
      edit_address: "basics",
      edit_website: "website",
      edit_hours: "hours",
      edit_cover: "cover",
      confirm_ai_outputs: "confirm",
      review_pipeline: "review",
    });

    for (const [fix, focus] of Object.entries(DECK_READINESS_FIX_TO_FOCUS)) {
      const route = routeForDeckReadinessFix({
        brandId: "brand-1",
        placePoolId: "place-1",
        fix,
      });
      expect(route).toContain("/venue/deck-readiness?");
      expect(route).toContain("brand_id=brand-1");
      expect(route).toContain("place_pool_id=place-1");
      expect(route).toContain(`fix=${fix}`);
      expect(route).toContain(`focus=${focus}`);
    }
  });

  test("unknown fixes fall back to review without dropping brand context", () => {
    const route = routeForDeckReadinessFix({
      brandId: "brand-1",
      placePoolId: null,
      fix: "future_fix",
    });
    expect(route).toContain("brand_id=brand-1");
    expect(route).toContain("fix=review_pipeline");
    expect(route).toContain("focus=review");
    expect(route).not.toContain("place_pool_id=");
  });
});
