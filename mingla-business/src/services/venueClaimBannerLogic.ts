/**
 * Ve3 — pure venue claim banner helpers (jest-testable without supabase).
 */

import type { BrandClaimStatus } from "../types/brand";

export interface VenueClaimStatusRow {
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
        title: "Venue claim",
        body: "Your venue claim is being reviewed. Usually within 4 business hours.",
      };
    case "follow_up":
      // ORCH-1064 (F-3 fix) — MUST differ from plain pending. DESIGN §2.5: the
      // openCount≥1 copy (the openCount===0 "all addressed" variant is selected
      // in the component from the badge count; this pure fn returns the ≥1 copy).
      return {
        title: "Updates requested",
        body:
          "The Mingla team asked for a few changes. A few tweaks will get you live — tap to see what to fix.",
      };
    case "rejected":
      return {
        title: "Venue claim",
        body: "Your venue claim was declined. Tap to see why or try a different venue.",
      };
    case "verified":
      return {
        title: "Verified location",
        body: "Verified location ✓ — your brand has the Verified badge on your public page.",
      };
    default:
      return null;
  }
}
