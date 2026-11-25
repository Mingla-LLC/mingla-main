/**
 * #4490 (08-O3 fix 2) — which venues a venue-only member sees on Home.
 *
 * ONE owner for the "Your venues" list. The read behind it (`venue_listings`
 * through the "venue listings scoped staff can read" policy, #4188) already
 * returns exactly the venues the member holds a grant at, whatever the
 * grant (sell, check-in, Till device, kitchen and bar, bookings, money).
 * The list therefore never filters by venue type: a venue is listed because
 * the member was given access, not because it is a Stay or a restaurant
 * (a Kitchen/bar or Till login at a Play and games venue got "No venue
 * access yet" before this).
 */

import { VENUE_TYPE_LABELS } from "@mingla/brand-rendering/venueTypeLabels";

import type { VenueListing } from "../../services/venueListingsService";

export function listVenueStaffVenues(
  listings: readonly VenueListing[] | null | undefined,
): VenueListing[] {
  return [...(listings ?? [])];
}

/** The type's own label ("Stay", "Restaurant", "Play and games", ...). */
export function venueStaffCardType(venue: Pick<VenueListing, "venueCategory">): string {
  const labels = VENUE_TYPE_LABELS as Readonly<Record<string, string>>;
  return labels[venue.venueCategory] ?? "Venue";
}

export function venueStaffCardIcon(
  venue: Pick<VenueListing, "venueCategory">,
): "home" | "notebook" {
  return venue.venueCategory === "stay" ? "home" : "notebook";
}
