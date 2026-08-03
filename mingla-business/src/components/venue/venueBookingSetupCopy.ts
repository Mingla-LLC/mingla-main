import type { VenueCategory } from "../../types/brand";

export function venueBookingSetupCopy(
  venueCategory: VenueCategory | null,
  wantsReservations: boolean,
): string {
  if (wantsReservations) {
    return "We'll walk you through setup after approval.";
  }
  if (venueCategory === "stay") {
    return "You can set rooms, reservable places, availability and fees after you're live.";
  }
  return "You can set tables, times and fees after you're live.";
}
