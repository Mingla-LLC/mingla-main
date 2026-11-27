import type { VenueOfferStatus } from "../../../../types/venueOffers";

import type { PackageStepId } from "./packageModel";

/**
 * #4490 truthful package navigation: a clickable step is still a save
 * boundary. It may navigate immediately only when the draft is clean.
 */
export async function canLeavePackageStep(input: {
  dirty: boolean;
  issue: string | null;
  step: PackageStepId;
  showIssue: () => void;
  save: (step: PackageStepId) => Promise<boolean>;
}): Promise<boolean> {
  if (!input.dirty) return true;
  if (input.issue !== null) {
    input.showIssue();
    return false;
  }
  return input.save(input.step);
}

export type PackageReviewAction = "block" | "close" | "publish" | "save";

/** Defensive even after guarded step navigation: restored/racing dirty Review
 * state must never turn Done into a silent discard. */
export function packageReviewAction(input: {
  status: VenueOfferStatus;
  dirty: boolean;
  dirtyStep: PackageStepId | null;
}): PackageReviewAction {
  if (input.dirty) {
    return input.dirtyStep !== null && input.dirtyStep !== "review"
      ? "save"
      : "block";
  }
  return input.status === "live" ? "close" : "publish";
}
