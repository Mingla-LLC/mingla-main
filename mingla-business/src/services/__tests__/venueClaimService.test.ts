import { describe, expect, test } from "@jest/globals";

import {
  venueClaimBannerCopy,
  venueClaimBannerVariant,
} from "../venueClaimBannerLogic";

describe("venueClaimService", () => {
  test("venueClaimBannerVariant for physical pending_review", () => {
    expect(
      venueClaimBannerVariant({
        kind: "physical",
        claim_status: "pending_review",
        rejection_reason: null,
        claim_follow_up_at: null,
      }),
    ).toBe("pending_review");
  });

  test("venueClaimBannerVariant for follow_up", () => {
    expect(
      venueClaimBannerVariant({
        kind: "physical",
        claim_status: "pending_review",
        rejection_reason: null,
        claim_follow_up_at: "2026-05-19T12:00:00Z",
      }),
    ).toBe("follow_up");
  });

  test("popup brands hide banner", () => {
    expect(
      venueClaimBannerVariant({
        kind: "popup",
        claim_status: "pending_review",
        rejection_reason: null,
        claim_follow_up_at: null,
      }),
    ).toBeNull();
  });

  test("venueClaimBannerCopy includes rejection reason", () => {
    const copy = venueClaimBannerCopy("rejected", "Could not verify by phone");
    expect(copy?.body).toBe("Could not verify by phone");
  });
});
