/**
 * ORCH-1040 — brand-facing listing status, derived from the pipeline status +
 * the admin claim status. Pure + unit-tested. Translates the internal pipeline
 * enum (draft/processing/needs_fix/deck_eligible/failed) and the claim lifecycle
 * (none/pending_review/verified/rejected) into ONE friendly status the brand sees
 * on the listing management page.
 */
import type { BrandClaimStatus } from "../types/brand";
import type { BrandPlacePipelineState } from "../services/businessPlaceAuthoringService";

export type ListingTone = "neutral" | "info" | "warning" | "success";

export interface ListingStatusView {
  label: string;
  tone: ListingTone;
  hint: string;
}

export function listingStatusView(input: {
  hasVenue: boolean;
  status: BrandPlacePipelineState["status"] | null;
  claimStatus: BrandClaimStatus | undefined;
}): ListingStatusView {
  if (!input.hasVenue) {
    return {
      label: "No listing yet",
      tone: "neutral",
      hint: "Add your venue so Mingla can recommend it to the right people.",
    };
  }
  // Admin decisions take precedence over the pipeline status.
  if (input.claimStatus === "rejected" || input.status === "failed") {
    return {
      label: "Changes needed",
      tone: "warning",
      hint: "Make the requested changes and resubmit to go live.",
    };
  }
  if (input.claimStatus === "verified") {
    return {
      label: "Live on Mingla",
      tone: "success",
      hint: "Your venue is being recommended to people planning the right moments.",
    };
  }
  if (input.status === "deck_eligible" || input.claimStatus === "pending_review") {
    return {
      label: "In review",
      tone: "info",
      hint: "We're reviewing your listing — we'll let you know the moment it's live.",
    };
  }
  if (input.status === "needs_fix") {
    return {
      label: "Needs fixes",
      tone: "warning",
      hint: "A few things need fixing before your venue can go live.",
    };
  }
  if (input.status === "processing") {
    return {
      label: "Processing",
      tone: "info",
      hint: "We're processing your listing — this only takes a moment.",
    };
  }
  return {
    label: "Draft",
    tone: "neutral",
    hint: "Finish your listing and submit it to get recommended.",
  };
}
