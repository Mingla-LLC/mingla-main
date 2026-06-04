/**
 * ORCH-1073 — admin suspend/delete adds two claim states to the business
 * banner: `suspended` (interactive — same to-do/resubmit loop as follow_up,
 * distinct copy) and `revoked` (static "removed" notice).
 */
import { describe, expect, test } from "@jest/globals";

import {
  venueClaimBannerVariant,
  venueClaimBannerCopy,
} from "../venueClaimBannerLogic";

describe("venueClaimBannerVariant — ORCH-1073 states", () => {
  test("suspended → 'suspended' variant (interactive)", () => {
    expect(
      venueClaimBannerVariant({
        claim_status: "suspended",
        rejection_reason: null,
        claim_follow_up_at: "2026-06-04T00:00:00Z",
      }),
    ).toBe("suspended");
  });

  test("suspended with no follow-up stamp still resolves to 'suspended'", () => {
    expect(
      venueClaimBannerVariant({
        claim_status: "suspended",
        rejection_reason: null,
        claim_follow_up_at: null,
      }),
    ).toBe("suspended");
  });

  test("revoked → 'revoked' variant (static removed notice)", () => {
    expect(
      venueClaimBannerVariant({
        claim_status: "revoked",
        rejection_reason: null,
        claim_follow_up_at: null,
      }),
    ).toBe("revoked");
  });

  test("verified is unaffected (regression guard)", () => {
    expect(
      venueClaimBannerVariant({
        claim_status: "verified",
        rejection_reason: null,
        claim_follow_up_at: null,
      }),
    ).toBe("verified");
  });
});

describe("venueClaimBannerCopy — ORCH-1073 states", () => {
  test("suspended copy is distinct from follow_up and mentions resubmit", () => {
    const suspended = venueClaimBannerCopy("suspended");
    const followUp = venueClaimBannerCopy("follow_up");
    expect(suspended?.title).toBe("Listing suspended");
    expect(suspended?.body.toLowerCase()).toContain("resubmit");
    expect(suspended?.title).not.toBe(followUp?.title);
  });

  test("revoked copy reads as removed", () => {
    const revoked = venueClaimBannerCopy("revoked");
    expect(revoked?.title).toBe("Listing removed");
    expect(revoked?.body.toLowerCase()).toContain("removed");
  });
});
