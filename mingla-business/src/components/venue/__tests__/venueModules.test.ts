/**
 * META-ORCH-1148 sub-ORCH 2.0 — deriveVenueModules unit tests.
 *
 * Fails-on-revert anchor I-PROPOSED-1148-RESERVATION-TOGGLE-GATES-SUITE: the
 * booking band (tables/availability/reservations/waitlist) is gated SOLELY on
 * the Reservations toggle. Reverting `deriveVenueModules` to show booking
 * modules unconditionally (or hide them when ON) flips T-1/T-2 → FAIL.
 */

import {
  deriveVenueModules,
  isBookingModule,
  VENUE_BOOKING_MODULES,
} from "../venueModules";

describe("deriveVenueModules", () => {
  it("T-1 — toggle OFF → only Overview + Settings (no booking band)", () => {
    expect(deriveVenueModules(false)).toEqual(["overview", "settings"]);
  });

  it("T-2 — toggle ON → Overview, booking band, Settings (settings last)", () => {
    const mods = deriveVenueModules(true);
    expect(mods).toEqual([
      "overview",
      "tables",
      "availability",
      "reservations",
      "waitlist",
      "settings",
    ]);
    // booking modules present
    for (const m of VENUE_BOOKING_MODULES) {
      expect(mods).toContain(m);
    }
    // settings stays last
    expect(mods[mods.length - 1]).toBe("settings");
  });

  it("T-2b — OFF has NONE of the booking modules", () => {
    const mods = deriveVenueModules(false);
    for (const m of VENUE_BOOKING_MODULES) {
      expect(mods).not.toContain(m);
    }
  });

  it("isBookingModule — only the four booking modules are booking modules", () => {
    expect(isBookingModule("tables")).toBe(true);
    expect(isBookingModule("availability")).toBe(true);
    expect(isBookingModule("reservations")).toBe(true);
    expect(isBookingModule("waitlist")).toBe(true);
    expect(isBookingModule("overview")).toBe(false);
    expect(isBookingModule("settings")).toBe(false);
  });
});
