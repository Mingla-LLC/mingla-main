/**
 * META-ORCH-1148 sub-ORCH 2.0 — mobile scroll + bottom-nav clearance contract.
 *
 * Seth device-found: "On the mobile app ... all pages need to scroll and clear
 * the nav menu on the business app." Every Venue Suite module page must be
 * vertically scrollable AND clear the floating bottom nav + safe-area inset.
 *
 * The shell (VenueSuiteShell) is the scroll owner for the Settings + booking
 * ComingSoon modules (plain Views), and DELEGATES scrolling to
 * <VenueListingContent> for Overview (which owns its own ScrollView + clearance).
 * Wrapping Overview in a second outer ScrollView is the nested same-axis scroll
 * bug that broke scrolling on native — so `moduleSelfScrolls('overview')` MUST be
 * true (no outer wrap) and false for every other module (shell wraps + pads).
 *
 * Fails-on-revert: pinned against the venue-suite-foundation shell fix commit.
 *  - Revert `moduleSelfScrolls` to always-false → Overview double-wraps → T-A red.
 *  - Revert the clearance to a static `spacing.xxl` (48) → T-C/T-D red (48 < 64px
 *    nav + safe-area, the exact "content hidden behind nav" symptom).
 */

import {
  VENUE_SCROLL_NAV_CLEARANCE,
  moduleSelfScrolls,
  venueScrollBottomPad,
} from "../venueShellScroll";
import { VENUE_MODULES } from "../venueModules";
import type { VenueModule } from "../../../types/venueReservation";

const ALL_MODULES = Object.keys(VENUE_MODULES) as VenueModule[];

describe("META-ORCH-1148 — venue shell scroll + bottom-nav clearance", () => {
  test("T-A: ONLY Overview self-scrolls (so the shell never double-wraps the listing's own ScrollView)", () => {
    expect(moduleSelfScrolls("overview")).toBe(true);
    for (const m of ALL_MODULES.filter((x) => x !== "overview")) {
      expect(moduleSelfScrolls(m)).toBe(false);
    }
  });

  test("T-B: Settings + every booking module are shell-scrolled (NOT self-scrolling) — guarantees the shell supplies a scroll container", () => {
    // Settings + booking band render plain Views → must NOT claim self-scroll,
    // else they would render with no scroll container and be unscrollable.
    const shellOwned = ALL_MODULES.filter((m) => !moduleSelfScrolls(m));
    expect(shellOwned).toContain("settings");
    // At least the booking band must be present + shell-owned.
    expect(shellOwned.length).toBeGreaterThanOrEqual(2);
  });

  test("T-C: bottom padding = safe-area inset + the shared nav-clearance constant (last row clears the floating nav)", () => {
    expect(VENUE_SCROLL_NAV_CLEARANCE).toBe(120);
    expect(venueScrollBottomPad(0)).toBe(120);
    expect(venueScrollBottomPad(34)).toBe(154); // iPhone home-indicator inset
    expect(venueScrollBottomPad(48)).toBe(168);
  });

  test("T-D: clearance ALWAYS exceeds the BottomNav primitive height (64px) — no content hidden behind the nav, even with zero inset", () => {
    const BOTTOM_NAV_HEIGHT = 64;
    // Even on a device with no bottom safe-area inset, the pad clears the nav.
    expect(venueScrollBottomPad(0)).toBeGreaterThan(BOTTOM_NAV_HEIGHT);
    // The static `spacing.xxl` (48) the bug shipped with did NOT clear it.
    expect(venueScrollBottomPad(0)).toBeGreaterThan(48);
  });

  test("T-E: pad is monotonic in the inset (bigger safe-area → bigger clearance)", () => {
    expect(venueScrollBottomPad(20)).toBeLessThan(venueScrollBottomPad(40));
  });
});
