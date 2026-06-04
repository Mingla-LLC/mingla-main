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
  // ORCH-1073 — admin suspend/delete. `suspended` is INTERACTIVE (same to-do
  // sheet + resubmit loop as `follow_up`); `revoked` is a static "removed" notice.
  | "suspended"
  | "revoked"
  | null;

export function venueClaimBannerVariant(
  row: VenueClaimStatusRow | null | undefined,
): VenueClaimBannerVariant {
  if (row === null || row === undefined) return null;
  if (row.claim_status === "verified") return "verified";
  if (row.claim_status === "rejected") return "rejected";
  if (row.claim_status === "revoked") return "revoked";
  // ORCH-1073 — a suspended listing always carries a follow-up stamp + a to-do
  // round (admin_suspend_listing), so it routes through the interactive tile.
  if (row.claim_status === "suspended") return "suspended";
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
    case "suspended":
      // ORCH-1073 — distinct from follow_up: an admin took the live listing down.
      return {
        title: "Listing suspended",
        body:
          "An admin suspended your listing. Tap to see what to fix, then resubmit to go back live.",
      };
    case "revoked":
      return {
        title: "Listing removed",
        body: "Your listing was removed from Mingla. Reach out to support if you think this was a mistake.",
      };
    default:
      return null;
  }
}
