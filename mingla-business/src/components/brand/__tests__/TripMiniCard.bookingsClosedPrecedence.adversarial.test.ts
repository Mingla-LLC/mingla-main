/**
 * ORCH-0963 T-06 ADVERSARIAL — bookings-closed beats scarce-capacity badge.
 *
 * Attacks a DIFFERENT angle than T-05 (which attacks null handling): verifies
 * that when bookingsClosed=true AND spotsLeft<=5, only the "Booking closed"
 * badge renders — NEVER both badges + NEVER the scarcity badge alone.
 * "Booking closed" is the stronger truth signal; scarcity is a marketing
 * prompt that becomes misleading once bookings are off.
 *
 * Fails-on-revert: swapping the badge precedence so spotsLabel wins would
 * mean a buyer sees "2 spots left" on a trip they cannot actually book —
 * which is a Constitution #9 violation (fabricated affordance).
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

describe("ORCH-0963 T-06 ADVERSARIAL — Bookings-closed precedence over scarcity", () => {
  const pageSrc = readFileSync(
    join(__dirname, "..", "PublicBrandPage.tsx"),
    "utf8",
  );

  const tripCardBody = (() => {
    const m = pageSrc.match(
      /const\s+TripMiniCard:\s*React\.FC<TripMiniCardProps>\s*=\s*\(\{[\s\S]*?\n\};\n/,
    );
    if (m === null) throw new Error("TripMiniCard body not found");
    return m[0];
  })();

  test("T-06a bookingsClosed branch evaluated BEFORE spotsLabel branch", () => {
    // Pin the order: { trip.bookingsClosed ? <closed/> : spotsLabel !== null ? <scarce/> : null }
    expect(tripCardBody).toMatch(
      /trip\.bookingsClosed\s*\?\s*\(\s*<View\s+style=\{styles\.tripBadgeClosed\}>[\s\S]*?\)\s*:\s*spotsLabel\s*!==\s*null\s*\?\s*\(\s*<View\s+style=\{styles\.tripBadgeScarce\}>/,
    );
  });

  test("T-06b bookingsClosed badge label is 'Booking closed' (not 'Closed' or 'Sold out')", () => {
    expect(tripCardBody).toMatch(
      /<View\s+style=\{styles\.tripBadgeClosed\}>\s*<Text\s+style=\{styles\.tripBadgeLabel\}>Booking closed<\/Text>/,
    );
  });

  test("T-06c scarcity badge is mutually exclusive (no parallel render)", () => {
    // There must be exactly ONE conditional chain choosing between the two —
    // not two independent `{trip.bookingsClosed && ...}` + `{spotsLabel && ...}`
    // mounts that could both fire.
    const independentBookingMount = /\{trip\.bookingsClosed\s*&&\s*\(?\s*<View\s+style=\{styles\.tripBadgeClosed\}/g;
    const independentSpotsMount = /\{spotsLabel\s*&&\s*\(?\s*<View\s+style=\{styles\.tripBadgeScarce\}/g;
    expect(tripCardBody.match(independentBookingMount) ?? []).toHaveLength(0);
    expect(tripCardBody.match(independentSpotsMount) ?? []).toHaveLength(0);
  });

  test("T-06d card Pressable still wraps everything (booking-closed does NOT disable navigation)", () => {
    // Tapping a closed-bookings card MUST still navigate to /t/{slug} so the
    // visitor can see trip details (refund policy, past travelers, etc).
    // Pin the outer Pressable onPress wiring.
    expect(tripCardBody).toMatch(
      /<Pressable\s+onPress=\{\(\)\s*=>\s*onPress\(trip\)\}/,
    );
    // And there is no `disabled={trip.bookingsClosed}` short-circuit.
    expect(tripCardBody).not.toMatch(/disabled=\{trip\.bookingsClosed\}/);
  });
});
