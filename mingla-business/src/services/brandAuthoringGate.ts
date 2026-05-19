/**
 * Ve1 — block event/trip draft creation until physical venue brands are verified.
 */

import { supabase } from "./supabase";

export class PhysicalVenueNotVerifiedError extends Error {
  readonly code = "physical_venue_not_verified" as const;

  constructor() {
    super(
      "This venue is still pending review. You can create events after Mingla verifies it — usually within 4 business hours.",
    );
    this.name = "PhysicalVenueNotVerifiedError";
  }
}

export async function assertBrandCanAuthorOfferings(
  brandId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("brands")
    .select("kind, claim_status")
    .eq("id", brandId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error !== null) throw error;
  if (data === null) {
    throw new Error("Brand not found");
  }

  const row = data as {
    kind: string;
    claim_status: string | null;
  };

  if (
    row.kind === "physical" &&
    row.claim_status !== "verified"
  ) {
    throw new PhysicalVenueNotVerifiedError();
  }
}
