/**
 * issue #4522 W-11 — a host never reads a raw server code when publishing.
 * Calls the REAL `mapPublishErrorToState` (what TripCreatorWizard runs on a
 * publish refusal before the Review step's banner shows `message`).
 *
 * Only the Review screen's own visual children are replaced (cover preview,
 * theme controls, payout card, guide sections, brand hook): they pull animation
 * modules this node run cannot load and none of them takes part in the mapping.
 *
 * FAILS ON REVERT: drop the `invalid_cover_media_triplet` case, or let the
 * default branch pass `rawMessage` through unfiltered.
 */
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../offering/LazyPublicParts", () => ({ TripPreview: () => null }));
jest.mock("../../theme/ThemeSheetLazy", () => ({ ThemeSheet: () => null }));
jest.mock("../../theme/ThemeControlRow", () => ({ ThemeControlRow: () => null }));
jest.mock("../../offering/StripeBlockedCard", () => ({ StripeBlockedCard: () => null }));
jest.mock("../TripGuideReviewSections", () => ({ TripGuideReviewSections: () => null }));
jest.mock("../../../hooks/useBrands", () => ({ useBrand: () => ({ data: null }) }));

import { mapPublishErrorToState } from "../TripCreatorStep5Review";

const FRIENDLY_RETRY = "Couldn't publish. Tap Publish to try again.";

describe("mapPublishErrorToState — no raw codes for a host", () => {
  test("invalid_cover_media_triplet maps to the friendly cover error on step 1", () => {
    const out = mapPublishErrorToState("invalid_cover_media_triplet", "invalid_cover_media_triplet");
    expect(out.message).toBe("Choose a cover with a stable preview image before publishing.");
    expect(out.pointsToStep).toBe(1);
  });

  test.each(["some_new_server_code", "publish_failed", "trip_plan_v2_invalid"])(
    "an unknown bare server code (%s) reads as a plain retry line",
    (raw) => {
      const out = mapPublishErrorToState("publish_failed", raw);
      expect(out.message).toBe(FRIENDLY_RETRY);
      expect(out.message).not.toContain(raw);
    },
  );

  test("an empty message also reads as the plain retry line", () => {
    expect(mapPublishErrorToState("publish_failed", "").message).toBe(FRIENDLY_RETRY);
  });

  test.each(["The bank is still being checked.", "Add a title"])(
    "a server sentence written for people (%s) is still shown as sent",
    (raw) => {
      expect(mapPublishErrorToState("publish_failed", raw).message).toBe(raw);
    },
  );
});
