export interface SubmissionVenue {
  id: string;
  brandId: string;
  placePoolId: string | null;
  claimStatus: string;
}

interface AcquireVenueInput {
  brandId: string;
  rememberedVenueId: string | null;
}

interface AcquireVenueDependencies {
  fetchVenue: (venueId: string) => Promise<SubmissionVenue | null>;
  createVenue: () => Promise<string>;
  rememberVenue: (venueId: string) => void;
}

export interface AcquiredSubmissionVenue {
  venueId: string;
  /** Non-null means Tier 1 already completed before the interrupted retry. */
  placePoolId: string | null;
  resumed: boolean;
}

/**
 * Issue #1467 — acquire exactly one own-brand pending venue for a create
 * submission saga. The remembered ID is only a pointer: the server-backed
 * venue read remains the authority before any downstream write resumes.
 */
export async function acquireVenueForSubmission(
  input: AcquireVenueInput,
  dependencies: AcquireVenueDependencies,
): Promise<AcquiredSubmissionVenue> {
  if (input.rememberedVenueId === null) {
    const venueId = await dependencies.createVenue();
    dependencies.rememberVenue(venueId);
    return { venueId, placePoolId: null, resumed: false };
  }

  const venue = await dependencies.fetchVenue(input.rememberedVenueId);
  if (
    venue === null ||
    venue.id !== input.rememberedVenueId ||
    venue.brandId !== input.brandId ||
    venue.claimStatus !== "pending_review"
  ) {
    throw new Error(
      "We couldn't safely resume this venue submission. Start over or contact support.",
    );
  }

  return {
    venueId: venue.id,
    placePoolId: venue.placePoolId,
    resumed: true,
  };
}
