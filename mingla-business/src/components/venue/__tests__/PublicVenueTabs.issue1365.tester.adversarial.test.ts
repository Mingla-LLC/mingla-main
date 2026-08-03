/**
 * Issue #1365 tester-owned adversarial state-isolation proof.
 *
 * Different angle from the implementor test: exercise a complete cross-venue
 * sequence where Venue A leaves a user-selected Reservations tab in memory,
 * then Venue B opens on Overview. Venue A's tab state must never leak into
 * Venue B, and callback rerenders on Venue B must not duplicate analytics.
 *
 * This imports the pure no-React state module, so it runs in CI without a
 * repo-root node_modules install.
 */

import { reconcileInitialVenueTab } from "@mingla/brand-rendering/publicVenueTabState";

describe("issue #1365 adversarial cross-venue tab isolation", () => {
  test("a new venue replaces stale tab state once and does not replay its view event", () => {
    const venueAInitial = reconcileInitialVenueTab("overview", null, "menu");
    expect(venueAInitial).toEqual({
      activeTab: "menu",
      lastInitialTab: "menu",
      shouldEmit: true,
    });

    // The visitor chooses Reservations at Venue A. A parent callback rerender
    // must preserve that user choice without reporting another initial view.
    const venueAUserChoice = reconcileInitialVenueTab(
      "reservations",
      venueAInitial.lastInitialTab,
      "menu",
    );
    expect(venueAUserChoice).toEqual({
      activeTab: "reservations",
      lastInitialTab: "menu",
      shouldEmit: false,
    });

    // Navigation to Venue B changes the route-owned initial tab. Its Overview
    // replaces Venue A's stale Reservations state and emits exactly once.
    const venueBInitial = reconcileInitialVenueTab(
      venueAUserChoice.activeTab,
      venueAUserChoice.lastInitialTab,
      "overview",
    );
    expect(venueBInitial).toEqual({
      activeTab: "overview",
      lastInitialTab: "overview",
      shouldEmit: true,
    });

    const venueBRerender = reconcileInitialVenueTab(
      venueBInitial.activeTab,
      venueBInitial.lastInitialTab,
      "overview",
    );
    expect(venueBRerender).toEqual({
      activeTab: "overview",
      lastInitialTab: "overview",
      shouldEmit: false,
    });
  });
});
