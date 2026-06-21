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
  it("T-1 — toggle OFF → Overview, Menu, Settings (no booking band)", () => {
    // ORCH-1186-C T-MOD-1: menu is a command-band capability present even when
    // reservations is OFF (not gated on the toggle). Reverting menu out of the
    // OFF branch flips this → FAIL (dead-tap / missing-module regression).
    expect(deriveVenueModules(false)).toEqual(["overview", "menu", "settings"]);
  });

  it("T-2 — toggle ON → Overview, booking band, Menu, Settings (settings last)", () => {
    // ORCH-1186-C T-MOD-2: menu sits between the booking band and settings.
    const mods = deriveVenueModules(true);
    expect(mods).toEqual([
      "overview",
      "tables",
      "availability",
      "reservations",
      "waitlist",
      "menu",
      "settings",
    ]);
    // booking modules present
    for (const m of VENUE_BOOKING_MODULES) {
      expect(mods).toContain(m);
    }
    // menu present, between waitlist and settings
    expect(mods.indexOf("menu")).toBeGreaterThan(mods.indexOf("waitlist"));
    expect(mods.indexOf("menu")).toBeLessThan(mods.indexOf("settings"));
    // settings stays last
    expect(mods[mods.length - 1]).toBe("settings");
  });

  it("T-2b — OFF has NONE of the booking modules (but DOES have menu)", () => {
    const mods = deriveVenueModules(false);
    for (const m of VENUE_BOOKING_MODULES) {
      expect(mods).not.toContain(m);
    }
    // ORCH-1186-C: menu is command-band, NOT gated on the reservations toggle.
    expect(mods).toContain("menu");
  });

  it("isBookingModule — only the four booking modules are booking modules", () => {
    expect(isBookingModule("tables")).toBe(true);
    expect(isBookingModule("availability")).toBe(true);
    expect(isBookingModule("reservations")).toBe(true);
    expect(isBookingModule("waitlist")).toBe(true);
    expect(isBookingModule("overview")).toBe(false);
    expect(isBookingModule("settings")).toBe(false);
    // ORCH-1186-C T-MOD-3: menu is command-band, NOT a booking module — so the
    // VenueSuiteShell booking-only "snap to overview" guard never fires on menu.
    expect(isBookingModule("menu")).toBe(false);
  });
});
