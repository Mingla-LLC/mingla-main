import { describe, expect, test } from "@jest/globals";

import {
  venueClaimBannerCopy,
  venueClaimBannerVariant,
} from "../venueClaimBannerLogic";

describe("venueClaimService", () => {
  test("venueClaimBannerVariant shows pending review without brand-kind gating", () => {
    expect(
      venueClaimBannerVariant({
        claim_status: "pending_review",
        rejection_reason: null,
        claim_follow_up_at: null,
      }),
    ).toBe("pending_review");
  });

  test("venueClaimBannerVariant for follow_up", () => {
    expect(
      venueClaimBannerVariant({
        claim_status: "pending_review",
        rejection_reason: null,
        claim_follow_up_at: "2026-05-19T12:00:00Z",
      }),
    ).toBe("follow_up");
  });

  test("venueClaimBannerVariant shows verified without brand-kind gating", () => {
    expect(
      venueClaimBannerVariant({
        claim_status: "verified",
        rejection_reason: null,
        claim_follow_up_at: null,
      }),
    ).toBe("verified");
  });

  test("venueClaimBannerCopy uses locked rejected copy", () => {
    const copy = venueClaimBannerCopy("rejected", "Could not verify by phone");
    expect(copy?.body).toBe(
      "Your venue claim was declined. Tap to see why or try a different venue.",
    );
  });
});
