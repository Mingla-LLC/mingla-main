/**
 * Ve3 — pure venue claim banner helpers (jest-testable without supabase).
 */

import type { BrandClaimStatus } from "../types/brand";

export interface VenueClaimStatusRow {
  kind: string;
  claim_status: BrandClaimStatus | null;
  rejection_reason: string | null;
  claim_follow_up_at: string | null;
}

export type VenueClaimBannerVariant =
  | "pending_review"
  | "follow_up"
  | "rejected"
  | "verified"
  | null;

export function venueClaimBannerVariant(
  row: VenueClaimStatusRow | null | undefined,
): VenueClaimBannerVariant {
  if (row === null || row === undefined) return null;
  if (row.kind !== "physical") return null;
  if (row.claim_status === "verified") return "verified";
  if (row.claim_status === "rejected") return "rejected";
  if (row.claim_status === "pending_review") {
    if (row.claim_follow_up_at) return "follow_up";
    return "pending_review";
  }
  return null;
}

export function venueClaimBannerCopy(
  variant: VenueClaimBannerVariant,
  rejectionReason?: string,
): { title: string; body: string } | null {
  switch (variant) {
    case "pending_review":
      return {
        title: "Venue under review",
        body:
          "We are verifying your venue by phone — usually within 4 business hours.",
      };
    case "follow_up":
      return {
        title: "More information needed",
        body:
          "Our team needs more details about your venue claim. Watch for an email or in-app update.",
      };
    case "rejected":
      return {
        title: "Venue claim not approved",
        body:
          rejectionReason?.trim().length
            ? rejectionReason.trim()
            : "Contact support if you believe this was a mistake. You can submit a new claim with updated details.",
      };
    case "verified":
      return {
        title: "Venue verified",
        body: "Your venue is live. You can publish events and experiences.",
      };
    default:
      return null;
  }
}
