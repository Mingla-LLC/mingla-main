import { venueBookingSetupCopy } from "../venueBookingSetupCopy";

describe("Issue #1463 category-aware venue booking setup copy", () => {
  it("names rooms and reservable places for Stay listings", () => {
    expect(venueBookingSetupCopy("stay", false)).toBe(
      "You can set rooms, reservable places, availability and fees after you're live.",
    );
  });

  it("preserves table language for restaurant listings", () => {
    expect(venueBookingSetupCopy("restaurant", false)).toBe(
      "You can set tables, times and fees after you're live.",
    );
  });

  it("keeps the post-approval setup message after reservations are enabled", () => {
    expect(venueBookingSetupCopy("stay", true)).toBe(
      "We'll walk you through setup after approval.",
    );
  });
});
